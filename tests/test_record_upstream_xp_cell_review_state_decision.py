"""Tests for fingerprint-bound FL-4162 queue-state decisions."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_cell_review_queue as queue  # noqa: E402
import record_upstream_xp_cell_review_state_decision as recorder  # noqa: E402


def _unit(state: str = "needs_cell_semantic_confirmation") -> dict:
    return {
        "review_unit_id": "xp-cell-unit:test",
        "decision_state": state,
        "source_layer_sha256": "a" * 64,
        "frame_geometry": {"frame_width": 2, "frame_height": 1, "angles": 1, "frames_per_angle": 1},
        "member_source_keys": ["player-0000-L2"],
        "representative_source_key": "player-0000-L2",
        "candidate_role_sets": ["weapon_sword"],
        "priority": 3,
        "exact_duplicate_layer_count": 1,
        "decision_record": None,
        "review_state_decision_record": None,
    }


def _doc() -> dict:
    return {
        "review_units": [_unit()],
        "coverage": {"decision_state_counts": {}, "decided_units": 0, "pending_units": 1},
        "freeze_gate": {"ready": False, "reason": "pending"},
    }


def test_review_state_decision_preserves_evidence_binding():
    row = recorder.build_decision(
        _unit(), "needs_cell_role_segmentation", "body context is visible",
        ["viewer:player-0000-L2"], "reviewer", "2026-07-14",
    )
    assert row["authority"] is False
    assert row["source_layer_sha256"] == "a" * 64
    assert row["source_decision_state"] == "needs_cell_semantic_confirmation"


def test_apply_review_state_decision_changes_only_queue_state():
    row = recorder.build_decision(
        _unit(), "needs_cell_role_segmentation", "body context is visible",
        ["viewer"], "reviewer", "2026-07-14",
    )
    doc = _doc()
    queue.apply_review_state_decisions(doc, {row["review_unit_id"]: row})
    unit = doc["review_units"][0]
    assert unit["decision_state"] == "needs_cell_role_segmentation"
    assert unit["source_decision_state"] == "needs_cell_semantic_confirmation"
    assert unit["decision_record"] is None
    assert doc["coverage"]["pending_units"] == 1


def test_review_state_fingerprint_mismatch_fails_closed():
    row = recorder.build_decision(
        _unit(), "needs_cell_role_segmentation", "body context is visible",
        ["viewer"], "reviewer", "2026-07-14",
    )
    row["source_layer_sha256"] = "b" * 64
    with pytest.raises(queue.ReviewQueueError, match="fingerprint mismatch"):
        queue.apply_review_state_decisions(_doc(), {row["review_unit_id"]: row})


def test_review_state_member_drift_fails_closed():
    row = recorder.build_decision(
        _unit(), "needs_source_contract", "source alias needs contract",
        ["viewer"], "reviewer", "2026-07-14",
    )
    row["member_source_keys"] = ["player-9999-L2"]
    with pytest.raises(queue.ReviewQueueError, match="member set mismatch"):
        queue.apply_review_state_decisions(_doc(), {row["review_unit_id"]: row})


def test_recorder_refuses_already_segmented_unit():
    with pytest.raises(queue.ReviewQueueError, match="refuses"):
        recorder.build_decision(
            _unit("needs_cell_role_segmentation"), "needs_source_contract",
            "invalid", ["viewer"], "reviewer", "2026-07-14",
        )


def test_review_state_loader_rejects_malformed_json(tmp_path: Path):
    path = tmp_path / "states.jsonl"
    path.write_text("{broken\n", encoding="utf-8")
    with pytest.raises(queue.ReviewQueueError, match="malformed JSON"):
        queue.load_review_state_decisions(path)


def test_atomic_write_replaces_complete_file(tmp_path: Path):
    path = tmp_path / "states.jsonl"
    row = recorder.build_decision(
        _unit(), "needs_cell_role_segmentation", "body context is visible",
        ["viewer"], "reviewer", "2026-07-14",
    )
    recorder.atomic_write(path, [row])
    assert json.loads(path.read_text(encoding="utf-8"))["review_unit_id"] == row["review_unit_id"]
