"""FL-4162 — family topology contracts classify every visible layer fail-closed."""
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import build_family_topology_contracts as tc  # noqa: E402


def _row(card_id, *, family="player", li=3, qc="clean_accept", fp=None,
         roles=None, supported=True, unresolved=False, is_overlay=True,
         engine_role=None):
    return {
        "card_id": card_id, "family": family, "raw_layer_index": li, "ahsw": [0, 1, 0, 0],
        "queue_class": qc, "whole_atlas_fingerprint": fp,
        "engine_is_overlay": is_overlay, "engine_fixed_role": engine_role,
        "agent_verdict": {
            "proposed_roles": roles if roles is not None else ["helmet"],
            "supported": supported, "unresolved": unresolved,
            "contradictions": [], "topology_note": "",
        },
    }


def test_classify_card_each_class():
    assert tc.classify_card(_row("a", roles=["helmet"])) == "owned"
    assert tc.classify_card(_row("b", roles=["armor", "shield"])) == "composite"
    assert tc.classify_card(
        _row("c", roles=["composite_source:armor_shield_context"])) == "rejected"
    assert tc.classify_card(
        _row("d", roles=["helmet"], supported=False, unresolved=True)) == "unresolved"


def test_classify_card_fails_closed_on_unclassifiable_verdict():
    # supported False but not unresolved, and no fragment role -> must not be guessed.
    with pytest.raises(tc.TopologyContractError, match="does not land"):
        tc.classify_card(_row("x", roles=["helmet"], supported=False, unresolved=False))


def test_build_and_validate_full_coverage():
    rows = [
        _row("player-0100-L2", li=2, is_overlay=False, engine_role="L2 base accumulator",
             roles=["player_body"]),
        _row("player-0100-L3", li=3, fp="FP1", roles=["player_helmet_regular"]),
        _row("player-0102-L3", li=3, fp="FP1", roles=["helmet"]),  # name conflict
        _row("player-0100-L4", li=4, roles=["armor", "shield"]),    # composite
        _row("wolfie-1000-L4", family="wolfie", li=4,
             roles=["composite_source:frag"]),                       # rejected
        _row("plydie-1101-L3", family="plydie", li=3, roles=["helmet"],
             supported=False, unresolved=True),                      # unresolved
    ]
    packet = {"reviewed": rows}
    doc = tc.build_contracts(packet)
    assert doc["summary"]["total_cards"] == 6
    assert doc["summary"]["class_counts"] == {
        "owned": 3, "composite": 1, "rejected": 1, "unresolved": 1}
    # Overlay role is variant-dependent: player L3 has two role names at one index.
    assert 3 in doc["contracts"]["player"]["overlay_role_binding"][
        "variant_dependent_overlay_indices"]
    # Pixel-identity name conflict is surfaced and left for a human pick.
    conflicts = doc["contracts"]["player"]["role_name_conflicts"]
    assert conflicts and conflicts[0]["resolution"] == "unresolved_canonical_name"
    # Independent validation passes with full coverage.
    result = tc.validate_contracts(doc, packet)
    assert result["ok"] is True
    assert result["covered_cards"] == 6
    assert doc["authority"] is False


def _decision(sk, fp, roles, owned_role=None):
    return {"source_key": sk, "whole_atlas_fingerprint": fp,
            "asserted_original_roles": sorted(roles),
            "owned_role": owned_role or ";".join(sorted(roles))}


def _composite_packet():
    return {"reviewed": [_row("attack-0001-L2", family="attack", li=2, is_overlay=False,
                              fp="FPC", roles=["attack_body", "attack_weapon_sword"])]}


def test_composite_owned_at_contract_happy_path():
    dec = {"attack-0001-L2": _decision("attack-0001-L2", "FPC",
                                       ["attack_body", "attack_weapon_sword"])}
    doc = tc.build_contracts(_composite_packet(), dec)
    card = doc["contracts"]["attack"]["per_card"][0]
    assert card["classification"] == "owned"
    assert card["composite_owned_at_contract"] is True
    assert card["owned_role"] == "attack_body;attack_weapon_sword"
    assert card["original_composite_roles"] == ["attack_body", "attack_weapon_sword"]
    assert doc["composite_owned_at_contract_count"] == 1


def test_composite_decision_fingerprint_mismatch_fails_closed():
    dec = {"attack-0001-L2": _decision("attack-0001-L2", "WRONGFP",
                                       ["attack_body", "attack_weapon_sword"])}
    with pytest.raises(tc.TopologyContractError, match="fingerprint mismatch"):
        tc.build_contracts(_composite_packet(), dec)


def test_composite_decision_role_drift_fails_closed():
    dec = {"attack-0001-L2": _decision("attack-0001-L2", "FPC", ["attack_body", "other_role"])}
    with pytest.raises(tc.TopologyContractError, match="asserted roles"):
        tc.build_contracts(_composite_packet(), dec)


def test_composite_decision_on_non_composite_fails_closed():
    # A single-role (owned) row may NOT be changed by this artifact (req 5/6).
    rows = {"reviewed": [_row("attack-0001-L2", family="attack", li=2, fp="FPC",
                              roles=["attack_body"])]}
    dec = {"attack-0001-L2": _decision("attack-0001-L2", "FPC", ["attack_body"])}
    with pytest.raises(tc.TopologyContractError, match="only composite rows"):
        tc.build_contracts(rows, dec)


def test_unconsumed_composite_decision_fails_closed():
    dec = {"attack-9999-L2": _decision("attack-9999-L2", "FPC",
                                       ["attack_body", "attack_weapon_sword"])}
    with pytest.raises(tc.TopologyContractError, match="not matched"):
        tc.build_contracts(_composite_packet(), dec)


def test_missing_composite_decision_keeps_blocker():
    doc = tc.build_contracts(_composite_packet(), {})
    card = doc["contracts"]["attack"]["per_card"][0]
    assert card["classification"] == "composite"
    assert "composite_owned_at_contract" not in card


def test_load_composite_decisions_requires_authority_false(tmp_path):
    import json as _json
    p = tmp_path / "dec.json"
    p.write_text(_json.dumps({"authority": True, "decisions": []}))
    with pytest.raises(tc.TopologyContractError, match="authority:false"):
        tc.load_composite_decisions(p)
    # Absent file -> empty mapping (missing decision keeps the composite blocker).
    assert tc.load_composite_decisions(tmp_path / "nope.json") == {}


def test_validate_fails_closed_when_a_card_is_dropped():
    rows = [
        _row("player-0100-L3", li=3, roles=["helmet"]),
        _row("player-0102-L3", li=3, roles=["helmet"]),
    ]
    packet = {"reviewed": rows}
    doc = tc.build_contracts(packet)
    # Simulate a contract that silently dropped a covered card.
    doc["contracts"]["player"]["per_card"] = doc["contracts"]["player"]["per_card"][:1]
    with pytest.raises(tc.TopologyContractError, match="validation FAILED"):
        tc.validate_contracts(doc, packet)


# --- FL-4162 Surface A: owned->composite reconciliation (fingerprint-bound) ---
def _recon(sk, fp, current, corrected, status="accept"):
    return {"source_key": sk, "whole_atlas_fingerprint": fp,
            "asserted_current_role": current, "corrected_roles": corrected,
            "original_hand_status": status}


def _owned_single_role_packet():
    # wolack-0001-L3 hand-recorded as a single 'wolack_weapon_sword' role (owned-class).
    return {"reviewed": [_row("wolack-0001-L3", family="wolack", li=3, fp="WFP",
                              roles=["wolack_weapon_sword"])]}


def test_owned_to_composite_reconciliation_happy_path():
    rec = {"wolack-0001-L3": _recon("wolack-0001-L3", "WFP", "wolack_weapon_sword",
                                    ["mount_body_wolf", "rider_torso", "sword"])}
    doc = tc.build_contracts(_owned_single_role_packet(), {}, rec)
    card = doc["contracts"]["wolack"]["per_card"][0]
    assert card["classification"] == "composite"
    assert card["proposed_roles"] == ["mount_body_wolf", "rider_torso", "sword"]
    assert card["owned_to_composite_reconciled"] is True
    assert card["original_reviewed_role"] == "wolack_weapon_sword"      # provenance kept


def test_reconciliation_fingerprint_mismatch_fails_closed():
    rec = {"wolack-0001-L3": _recon("wolack-0001-L3", "WRONG", "wolack_weapon_sword",
                                    ["mount_body_wolf", "rider_torso", "sword"])}
    with pytest.raises(tc.TopologyContractError, match="fingerprint mismatch"):
        tc.build_contracts(_owned_single_role_packet(), {}, rec)


def test_reconciliation_wrong_current_role_fails_closed():
    rec = {"wolack-0001-L3": _recon("wolack-0001-L3", "WFP", "NOT_THE_ROLE",
                                    ["mount_body_wolf", "rider_torso", "sword"])}
    with pytest.raises(tc.TopologyContractError, match="asserted_current_role"):
        tc.build_contracts(_owned_single_role_packet(), {}, rec)


def test_reconciliation_on_multi_role_card_fails_closed():
    rows = {"reviewed": [_row("wolack-0011-L3", family="wolack", li=3, fp="WFP",
                              roles=["mount_body_wolf", "rider_torso", "sword"])]}
    rec = {"wolack-0011-L3": _recon("wolack-0011-L3", "WFP", "mount_body_wolf",
                                    ["mount_body_wolf", "rider_torso", "sword"])}
    with pytest.raises(tc.TopologyContractError, match="only a single-role card"):
        tc.build_contracts(rows, {}, rec)


def test_unconsumed_reconciliation_fails_closed():
    rec = {"nonexistent-L3": _recon("nonexistent-L3", "WFP", "x", ["a", "b"])}
    with pytest.raises(tc.TopologyContractError, match="not matched"):
        tc.build_contracts(_owned_single_role_packet(), {}, rec)


def test_reconciled_card_then_takes_composite_decision():
    """The reconciled composite is eligible for a composite-ownership decision: the
    full chain owned -> composite -> owned_at_contract (what wolack-0001-L3 needs)."""
    rec = {"wolack-0001-L3": _recon("wolack-0001-L3", "WFP", "wolack_weapon_sword",
                                    ["mount_body_wolf", "rider_torso", "sword"])}
    dec = {"wolack-0001-L3": _decision("wolack-0001-L3", "WFP",
                                       ["mount_body_wolf", "rider_torso", "sword"])}
    doc = tc.build_contracts(_owned_single_role_packet(), dec, rec)
    card = doc["contracts"]["wolack"]["per_card"][0]
    assert card["classification"] == "owned"
    assert card["composite_owned_at_contract"] is True
    assert card["owned_to_composite_reconciled"] is True
    assert card["owned_role"] == "mount_body_wolf;rider_torso;sword"


def test_load_reconciliations_requires_authority_false(tmp_path):
    import json as _json
    p = tmp_path / "recon.json"
    p.write_text(_json.dumps({"authority": True, "reconciliations": []}))
    with pytest.raises(tc.TopologyContractError, match="authority:false"):
        tc.load_owned_composite_reconciliations(p)
    assert tc.load_owned_composite_reconciliations(tmp_path / "nope.json") == {}
