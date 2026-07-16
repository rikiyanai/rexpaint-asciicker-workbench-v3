"""Tests for manual coordinate-specific FL-4162 cell decisions."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_cell_review_queue as queue  # noqa: E402
import record_upstream_xp_coordinate_cell_decision as recorder  # noqa: E402


def _unit(state: str = "needs_cell_role_segmentation") -> dict:
    return {
        "review_unit_id": "xp-cell-unit:test",
        "decision_state": state,
        "source_layer_sha256": "a" * 64,
        "frame_geometry": {
            "frame_width": 3, "frame_height": 1,
            "angles": 1, "frames_per_angle": 1,
        },
        "member_source_keys": ["player-0001-L2"],
        "candidate_role_sets": ["player_body;player_weapon_sword"],
    }


def _record() -> dict:
    return {
        "source_key": "player-0001-L2",
        "source_xp": {"path": "assets/sprites/player-0001.xp"},
        "cell_values": [
            {"cell_type": "body_pixel", "render_operation": "seed_l2_base_accumulator"},
            {"cell_type": "transparent", "render_operation": "no_visual_contribution"},
        ],
        "cell_spans": [
            [0, 0, 0, 0, 2, 0],
            [0, 0, 0, 2, 1, 1],
        ],
        "coverage": {"raw_cells": 3},
    }


def _assignment() -> dict:
    return {
        "schema": recorder.INPUT_SCHEMA,
        "source_key": "player-0001-L2",
        "source_layer_sha256": "a" * 64,
        "semantic_spans": [
            [0, 0, 0, 0, 1, ["player_body"]],
            [0, 0, 0, 1, 1, ["player_body", "player_weapon_sword"]],
        ],
    }


def test_coordinate_decision_separates_render_operation_from_semantics():
    decision = recorder.build_decision(
        _unit(), _record(), _assignment(), "reviewed composite",
        ["viewer"], [], "reviewer", "2026-07-15",
    )
    assert decision["cell_assignments"] == [
        [0, 0, 0, 0, 1, "seed_l2_base_accumulator", ["player_body"]],
        [0, 0, 0, 1, 1, "seed_l2_base_accumulator", ["player_body", "player_weapon_sword"]],
        [0, 0, 0, 2, 1, "no_visual_contribution", []],
    ]


def test_coordinate_decision_rejects_missing_visible_cell():
    assignment = _assignment()
    assignment["semantic_spans"].pop()
    with pytest.raises(queue.ReviewQueueError, match="coverage mismatch"):
        recorder.build_decision(
            _unit(), _record(), assignment, "incomplete", ["viewer"], [],
            "reviewer", "2026-07-15",
        )


def test_coordinate_decision_rejects_overlap():
    assignment = _assignment()
    assignment["semantic_spans"].append([0, 0, 0, 0, 1, ["sword"]])
    with pytest.raises(queue.ReviewQueueError, match="overlaps"):
        recorder.build_decision(
            _unit(), _record(), assignment, "overlap", ["viewer"], [],
            "reviewer", "2026-07-15",
        )


def test_coordinate_decision_rejects_fingerprint_drift():
    assignment = _assignment()
    assignment["source_layer_sha256"] = "b" * 64
    with pytest.raises(queue.ReviewQueueError, match="fingerprint mismatch"):
        recorder.build_decision(
            _unit(), _record(), assignment, "drift", ["viewer"], [],
            "reviewer", "2026-07-15",
        )


def test_source_contract_unit_requires_exact_xp_path():
    assignment = _assignment()
    assignment["source_contract"] = {
        "source_xp_path": "assets/sprites/wrong.xp",
        "contract_decision": "explicit alias",
    }
    with pytest.raises(queue.ReviewQueueError, match="XP path mismatch"):
        recorder.build_decision(
            _unit("needs_source_contract"), _record(), assignment,
            "source contract", ["viewer"], [], "reviewer", "2026-07-15",
        )


def test_source_contract_unit_records_exact_xp_path():
    assignment = _assignment()
    assignment["source_contract"] = {
        "source_xp_path": "assets/sprites/player-0001.xp",
        "contract_decision": "explicit alias",
    }
    decision = recorder.build_decision(
        _unit("needs_source_contract"), _record(), assignment,
        "source contract", ["viewer"], [], "reviewer", "2026-07-15",
    )
    assert decision["review_provenance"]["source_contract"]["source_xp_path"].endswith(
        "player-0001.xp"
    )
