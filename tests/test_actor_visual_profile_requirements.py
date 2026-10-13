import json
import os
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import actor_visual_profile_requirements as req  # noqa: E402
import decision_capture as dc  # noqa: E402


PROV = {"tool": "test", "recorded_at": "2026-06-17T00:00:00", "anchor": "bigbee-0100.json"}


def _card(source_key="bigbee-0000-L2", role_label="NO. BEE ONLY"):
    return {
        "card_id": source_key,
        "source_key": source_key,
        "source_xp_path": "assets/sprites/bigbee-0000.xp",
        "source_final_sha256": "ecc9a16112ce48beaeb0e24beba2ccc7399c4efc50d32505f3fd54f8e8d76020",
        "family": "bigbee",
        "raw_layer_index": 2,
        "ahsw": [0, 0, 0, 0],
        "hand": {
            "status": "reject",
            "corrected_label": role_label,
            "note": role_label,
            "pre_source": "GLYPH_SIGNATURE",
            "pre_guess": "armor;mount_body_wolf",
        },
        "engine": {
            "fixed_role": "L2 base accumulator",
            "frame_topology": {"angles": 8, "anims": [1, 2], "frames_per_angle": 6},
        },
        "glyph_similarity": {"exact_matches": [], "near_matches": []},
        "cells": {"glyph_count": 39, "visible_glyph_set": [47, 60]},
        "groups": {"glyph_exact_group_id": "G0031"},
    }


def _decision(card, approved_role="mount_body; rider_torso", slot_candidates=None):
    rec = dc.build_decision_record(card, approved_role=approved_role, provenance=PROV)
    if slot_candidates is not None:
        rec["slot_candidates"] = slot_candidates
    return rec


def test_build_requirement_is_proposal_only_and_maps_candidates():
    card = _card()
    decision = _decision(card, slot_candidates=["mount_rear", "mount_rider"])
    result = req.build_requirement(decision, card)
    assert result["authority"] is False
    assert result["is_proposal"] is True
    assert result["requirement_id"] == "avp_req:bigbee-0000-L2"
    assert result["presentation_kind_candidates"] == ["idle_walk"]
    assert result["slot_candidates"] == ["mount_rear", "mount_rider"]
    assert "layers[].source_layer_index" in result["actor_visual_profile_fields_required_later"]
    assert "not_actor_visual_profile_source" in result["promotion_blockers"]
    assert "needs_family_topology_contract" in result["promotion_blockers"]
    assert "not_compiler_input" in result["promotion_blockers"]


def test_slots_must_come_from_reviewed_decision_fields():
    card = _card(source_key="wolfie-0100-L3", role_label="helmet")
    card["family"] = "wolfie"
    card["raw_layer_index"] = 3
    decision = _decision(card, approved_role="helmet")
    result = req.build_requirement(decision, card)
    assert result["slot_candidates"] == ["unresolved_slot"]
    assert "needs_reviewed_slot_candidates" in result["promotion_blockers"]
    assert "mount_rear" not in result["slot_candidates"]


def test_explicit_reviewed_slot_is_preserved_without_family_fallback():
    card = _card(source_key="wolfie-0100-L3", role_label="helmet")
    card["family"] = "wolfie"
    card["raw_layer_index"] = 3
    decision = _decision(card, approved_role="helmet", slot_candidates=["head"])
    result = req.build_requirement(decision, card)
    assert result["slot_candidates"] == ["head"]
    assert "needs_reviewed_slot_candidates" not in result["promotion_blockers"]


def test_packet_counts_families_and_keeps_non_authority_boundary():
    card = _card()
    packet = req.build_requirements_packet(
        {card["source_key"]: _decision(card, approved_role="bee_body")},
        {card["source_key"]: card},
    )
    assert packet["authority"] is False
    assert packet["is_proposal"] is True
    assert packet["summary"]["decision_rows"] == 1
    assert packet["summary"]["requirements"] == 1
    assert packet["summary"]["family_counts"] == {"bigbee": 1}
    assert "It does not create ActorVisualProfile rows." in packet["non_authority_boundary"]


def test_missing_cards_fail_closed():
    with pytest.raises(req.RequirementDerivationError, match="missing evidence cards"):
        req.build_requirements_packet({"missing-L2": {"source_key": "missing-L2"}}, {})


def test_missing_cards_can_only_be_inspected_with_explicit_override():
    packet = req.build_requirements_packet(
        {"missing-L2": {"source_key": "missing-L2"}},
        {},
        allow_missing_cards=True,
    )
    assert packet["missing_cards"] == ["missing-L2"]
    with pytest.raises(req.RequirementDerivationError, match="missing evidence cards"):
        req.validate_packet(packet)


def test_fingerprint_mismatch_fails_closed():
    card = _card()
    decision = _decision(card)
    changed_card = _card(role_label="changed")
    with pytest.raises(req.RequirementDerivationError, match="source_card_fingerprint mismatch"):
        req.build_requirement(decision, changed_card)


def test_missing_decision_file_loads_empty(tmp_path):
    assert req.load_review_decisions(tmp_path / "missing.jsonl") == {}


def test_jsonl_loader_rejects_malformed_line(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text("{not-json}\n", encoding="utf-8")
    with pytest.raises(req.RequirementDerivationError, match="malformed JSONL"):
        req.load_review_decisions(path)


def test_cli_allow_empty_writes_empty_packet(tmp_path):
    cards = tmp_path / "cards.jsonl"
    decisions = tmp_path / "decisions.jsonl"
    out = tmp_path / "requirements.json"
    cards.write_text(json.dumps(_card(), sort_keys=True) + "\n", encoding="utf-8")
    exit_code = req.main([
        "--cards", str(cards),
        "--decisions", str(decisions),
        "--out", str(out),
        "--allow-empty",
        "--write",
    ])
    assert exit_code == 0
    packet = json.loads(out.read_text(encoding="utf-8"))
    assert packet["summary"]["decision_rows"] == 0
    assert packet["summary"]["requirements"] == 0


def test_role_name_conflict_blocks_byte_identical_layers_with_different_names():
    """FL-4162 step 7: two byte-identical layers (same whole_atlas_fingerprint) that
    got different role NAMES are a canonical-name conflict — both carry the
    role_name_conflict_unresolved blocker; a layer with a unique fingerprint does
    not."""
    a = _card(source_key="player-0100-L3", role_label="helmet")
    a["family"] = "player"; a["raw_layer_index"] = 3
    a["cells"]["whole_atlas_fingerprint"] = "FP_SHARED"
    b = _card(source_key="player-0102-L3", role_label="helmet")
    b["family"] = "player"; b["raw_layer_index"] = 3
    b["cells"]["whole_atlas_fingerprint"] = "FP_SHARED"
    c = _card(source_key="player-0103-L3", role_label="helmet")
    c["family"] = "player"; c["raw_layer_index"] = 3
    c["cells"]["whole_atlas_fingerprint"] = "FP_UNIQUE"

    decisions = {
        "player-0100-L3": _decision(a, approved_role="player_helmet_regular"),
        "player-0102-L3": _decision(b, approved_role="helmet"),  # same pixels, other name
        "player-0103-L3": _decision(c, approved_role="helmet"),
    }
    cards = {"player-0100-L3": a, "player-0102-L3": b, "player-0103-L3": c}

    conflicted = req.conflicted_source_keys(decisions, cards)
    assert conflicted == {"player-0100-L3", "player-0102-L3"}

    packet = req.build_requirements_packet(decisions, cards)
    by_key = {r["source_key"]: r for r in packet["requirements"]}
    assert "role_name_conflict_unresolved" in by_key["player-0100-L3"]["promotion_blockers"]
    assert "role_name_conflict_unresolved" in by_key["player-0102-L3"]["promotion_blockers"]
    assert "role_name_conflict_unresolved" not in by_key["player-0103-L3"]["promotion_blockers"]
    assert packet["summary"]["role_name_conflict_unresolved"] == 2


def test_atomic_write_failure_preserves_original_and_cleans_tmp(tmp_path, monkeypatch):
    out = tmp_path / "requirements.json"
    out.write_text("original\n", encoding="utf-8")
    before = out.read_text(encoding="utf-8")

    def fail_replace(src, dst):
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError):
        req.atomic_write_text(out, "new\n")

    assert out.read_text(encoding="utf-8") == before
    assert list(tmp_path.glob("requirements*.tmp")) == []
