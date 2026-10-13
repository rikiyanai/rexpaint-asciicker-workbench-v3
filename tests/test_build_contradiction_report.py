"""FL-4162 — contradiction report aggregates verdict tensions fail-closed."""
import json
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import build_contradiction_report as cr  # noqa: E402


def _row(card_id, *, family="player", li=3, qc="clean_accept", fp=None,
         roles=None, supported=True, unresolved=False, contradictions=None,
         topology_note="", pre_guess="", engine_role=None, is_overlay=True):
    return {
        "card_id": card_id, "family": family, "raw_layer_index": li,
        "queue_class": qc, "hand_corrected_label": "x", "hand_pre_guess": pre_guess,
        "hand_pre_source": "GLYPH_SIGNATURE", "engine_fixed_role": engine_role,
        "engine_is_overlay": is_overlay, "engine_overlay_ordinal": li - 2,
        "whole_atlas_fingerprint": fp,
        "agent_verdict": {
            "proposed_roles": roles if roles is not None else ["helmet"],
            "supported": supported, "unresolved": unresolved,
            "contradictions": contradictions or [],
            "topology_note": topology_note,
        },
    }


def _packet(rows):
    return {"reviewed": rows}


def test_missing_packet_fails_closed(tmp_path):
    with pytest.raises(cr.ContradictionReportError, match="missing"):
        cr.load_packet(tmp_path / "nope.json")


def test_malformed_packet_fails_closed(tmp_path):
    p = tmp_path / "manual_candidate_review.json"
    p.write_text("{ not json", encoding="utf-8")
    with pytest.raises(cr.ContradictionReportError, match="malformed"):
        cr.load_packet(p)


def test_packet_without_reviewed_list_fails_closed(tmp_path):
    p = tmp_path / "manual_candidate_review.json"
    p.write_text(json.dumps({"schema": "x"}), encoding="utf-8")
    with pytest.raises(cr.ContradictionReportError, match="reviewed"):
        cr.load_packet(p)


def test_glyph_exact_conflict_same_pixels_different_roles():
    rows = [
        _row("player-0100-L3", fp="FP1", roles=["player_helmet_regular"]),
        _row("player-0102-L3", fp="FP1", roles=["helmet"]),
        _row("player-0103-L3", fp="FP2", roles=["helmet"]),  # alone, no conflict
    ]
    report = cr.build_report(_packet(rows))
    assert report["summary"]["glyph_exact_conflicts"] == 1
    conflict = report["glyph_exact_conflicts"][0]
    assert conflict["whole_atlas_fingerprint"] == "FP1"
    assert conflict["distinct_role_sets"] == ["helmet", "player_helmet_regular"]


def test_identical_roles_on_identical_pixels_is_not_a_conflict():
    rows = [
        _row("a-L3", fp="FP1", roles=["helmet"]),
        _row("b-L3", fp="FP1", roles=["helmet"]),
    ]
    report = cr.build_report(_packet(rows))
    assert report["summary"]["glyph_exact_conflicts"] == 0


def test_hand_vs_machine_and_unresolved_and_composite_aggregate():
    rows = [
        _row("c1-L2", contradictions=["pre_guess 'armor' contradicted by hand"],
             pre_guess="armor"),
        _row("c2-L3", unresolved=True, supported=False, roles=["helmet"]),
        _row("c3-L4", roles=["armor", "shield"]),  # composite
        _row("c4-L4", topology_note="overlay ordinal 2; anim variant"),
    ]
    report = cr.build_report(_packet(rows))
    s = report["summary"]
    assert s["hand_vs_machine_guess"] == 1
    assert s["unresolved_cards"] == 1
    assert s["composite_layers"] == 1
    assert s["engine_topology_notes"] == 1
    assert report["authority"] is False
    assert report["is_proposal"] is False
