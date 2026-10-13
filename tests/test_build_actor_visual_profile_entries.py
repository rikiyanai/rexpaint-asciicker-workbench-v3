"""FL-4162 step 10b — report-backed authoring stays inside the clean set, fail-closed."""
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import build_actor_visual_profile_entries as e  # noqa: E402


def _layer(card_id, status, *, blockers=None, family="player", cls="owned"):
    return {
        "card_id": card_id, "family": family, "classification": cls,
        "content_status": status, "content_blockers": blockers or [],
    }


def _report(layers, phase_gates=("not_compiler_input", "needs_runtime_visual_proof")):
    return {"layers": layers, "phase_gates": list(phase_gates)}


def _req(card_id, *, roles=("helmet",), li=3, family="player", xp="x.xp"):
    return {
        "source_key": card_id, "family": family, "raw_layer_index": li,
        "composite_roles": list(roles), "source_xp_path": xp,
        "presentation_kind_candidates": ["idle_walk"], "slot_candidates": ["head"],
        "review_decision_ref": {"source_card_fingerprint": "fp"},
    }


def test_authors_exactly_the_content_clean_set():
    report = _report([
        _layer("player-0000-L3", "content_clean"),
        _layer("player-0000-L4", "content_blocked",
               blockers=[{"reason": "role_name_conflict", "plan_rejection_class": "3"}]),
    ])
    reqs = {"requirements": [_req("player-0000-L3")]}
    doc = e.build_entries(report, reqs)
    assert doc["summary"]["authored_entries"] == 1
    assert doc["summary"]["blocked_layers"] == 1
    assert doc["authored_entries"][0]["authority"] is False
    assert doc["authored_entries"][0]["is_proposal"] is True
    assert doc["authored_entries"][0]["layer"]["role"] == "helmet"
    # phase gates ride along on the authored entry — not closure.
    assert "needs_runtime_visual_proof" in doc["authored_entries"][0]["remaining_phase_gates"]


def test_variant_complete_only_when_every_layer_clean():
    report = _report([
        _layer("player-0000-L3", "content_clean"),
        _layer("player-0000-L4", "content_clean"),
        _layer("player-0001-L3", "content_clean"),
        _layer("player-0001-L4", "content_blocked",
               blockers=[{"reason": "x", "plan_rejection_class": None}]),
    ])
    reqs = {"requirements": [
        _req("player-0000-L3", li=3), _req("player-0000-L4", li=4), _req("player-0001-L3", li=3),
    ]}
    doc = e.build_entries(report, reqs)
    assert doc["summary"]["profile_complete_variants"] == 1
    assert doc["summary"]["profile_complete_variant_list"] == ["player-0000"]
    assert doc["variant_completeness"]["player-0000"]["profile_complete"] is True
    assert doc["variant_completeness"]["player-0001"]["profile_complete"] is False


def test_clean_without_requirement_fails_closed():
    report = _report([_layer("player-0000-L3", "content_clean")])
    with pytest.raises(e.EntryAuthoringError, match="no requirement row to author from"):
        e.build_entries(report, {"requirements": []})


def test_clean_but_carries_blocker_is_report_inconsistency():
    report = _report([_layer("player-0000-L3", "content_clean",
                             blockers=[{"reason": "x", "plan_rejection_class": None}])])
    with pytest.raises(e.EntryAuthoringError, match="report inconsistent"):
        e.build_entries(report, {"requirements": [_req("player-0000-L3")]})


def test_clean_with_composite_role_fails_closed():
    report = _report([_layer("player-0000-L3", "content_clean")])
    reqs = {"requirements": [_req("player-0000-L3", roles=("armor", "shield"))]}
    with pytest.raises(e.EntryAuthoringError, match="exactly one role"):
        e.build_entries(report, reqs)


def test_blocked_without_cause_fails_closed():
    report = _report([_layer("player-0000-L3", "content_blocked", blockers=[])])
    with pytest.raises(e.EntryAuthoringError, match="no cause given"):
        e.build_entries(report, {"requirements": []})


def test_unknown_status_fails_closed():
    report = _report([_layer("player-0000-L3", "maybe")])
    with pytest.raises(e.EntryAuthoringError, match="unknown content_status"):
        e.build_entries(report, {"requirements": []})


def test_missing_input_fails_closed(tmp_path):
    with pytest.raises(e.EntryAuthoringError, match="required authorability report missing"):
        e._load_json(tmp_path / "nope.json", "authorability report")
