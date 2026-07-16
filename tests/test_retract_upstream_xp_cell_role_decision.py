"""Tests for fail-closed retraction of false-clean FL-4162 decisions."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_cell_review_queue as queue  # noqa: E402
import retract_upstream_xp_cell_role_decision as retract  # noqa: E402


def _unit(state: str = "needs_cell_semantic_confirmation") -> dict:
    return {
        "review_unit_id": "xp-cell-unit:test",
        "decision_state": state,
        "source_layer_sha256": "a" * 64,
        "frame_geometry": {
            "frame_width": 2, "frame_height": 1,
            "angles": 1, "frames_per_angle": 1,
        },
        "member_source_keys": ["attack-0101-L2"],
        "representative_source_key": "attack-0101-L2",
        "candidate_role_sets": ["player_body"],
    }


def _decision() -> dict:
    return {
        "schema": "fl4162.upstream_xp_cell_role_decision.v2",
        "authority": False,
        "is_proposal": True,
        "review_unit_id": "xp-cell-unit:test",
        "source_layer_sha256": "a" * 64,
        "frame_geometry": _unit()["frame_geometry"],
        "member_source_keys": ["attack-0101-L2"],
        "cell_assignments": [
            [0, 0, 0, 0, 1, "seed_l2_base_accumulator", ["attack_body"]],
            [0, 0, 0, 1, 1, "no_visual_contribution", []],
        ],
        "review_provenance": {
            "reviewer": "old-reviewer",
            "decision": "false-clean body-only decision",
        },
    }


def test_retraction_preserves_removed_decision_provenance():
    active = _decision()
    state = retract.build_retraction_state_decision(
        _unit(), active, "sword visible in the raw cells", ["viewer"],
        "reviewer", "2026-07-15",
    )
    provenance = state["review_provenance"]
    assert state["target_decision_state"] == "needs_cell_role_segmentation"
    assert provenance["retracted_full_cell_decision_sha256"] == (
        retract.canonical_sha256(active)
    )
    assert provenance["retracted_semantic_sets"] == [["attack_body"]]
    assert provenance["retracted_review_provenance"]["reviewer"] == "old-reviewer"


def test_retraction_refuses_non_confirmation_source_state():
    with pytest.raises(queue.ReviewQueueError, match="semantic-confirmation"):
        retract.build_retraction_state_decision(
            _unit("needs_cell_role_segmentation"), _decision(), "wrong state",
            ["viewer"], "reviewer", "2026-07-15",
        )


def test_live_attack_false_clean_retraction_is_preserved():
    target_unit = "xp-cell-unit:fabbab1990b4ce7cc43b:56eaa4f87ee9"
    states = queue.load_review_state_decisions(retract.DEFAULT_REVIEW_STATES)
    state = states[target_unit]
    assert state["target_decision_state"] == "needs_cell_role_segmentation"
    assert state["review_provenance"]["retracted_full_cell_decision_sha256"] == (
        "259d43231e09281734ec80a90b3f45134733bf3a52393931b1075b045839aea2"
    )
    assert state["review_provenance"]["retracted_semantic_sets"] == [["attack_body"]]
    assert target_unit not in queue.load_decisions(retract.DEFAULT_DECISIONS)


def test_retraction_rejects_wrong_hash():
    with pytest.raises(queue.ReviewQueueError, match="SHA-256 mismatch"):
        retract.validate_expected_active_decision(
            _decision(), "0" * 64, ["attack_body"]
        )


def test_retraction_rejects_wrong_semantic_set():
    active = _decision()
    with pytest.raises(queue.ReviewQueueError, match="semantics mismatch"):
        retract.validate_expected_active_decision(
            active, retract.canonical_sha256(active), ["attack_weapon_sword"]
        )
