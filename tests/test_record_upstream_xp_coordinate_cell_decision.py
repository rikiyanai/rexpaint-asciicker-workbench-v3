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
            {
                "cell_type": "body_pixel",
                "render_operation": "seed_l2_base_accumulator",
                "raw": {"glyph": 219, "fg": [1, 2, 3], "bg": [4, 5, 6]},
            },
            {
                "cell_type": "transparent",
                "render_operation": "no_visual_contribution",
                "raw": {"glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]},
            },
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


def test_whole_visible_source_contract_expands_only_visible_cells():
    assignment = recorder.build_whole_visible_assignment(
        _unit("needs_source_contract"),
        _record(),
        ["player_body"],
        "assets/sprites/player-0001.xp",
        "explicit source alias reviewed as one body layer",
    )
    assert assignment["semantic_spans"] == [
        [0, 0, 0, 0, 2, ["player_body"]],
    ]
    decision = recorder.build_decision(
        _unit("needs_source_contract"), _record(), assignment,
        "source contract", ["viewer"], [], "reviewer", "2026-07-16",
    )
    assert decision["cell_assignments"][-1] == [
        0, 0, 0, 2, 1, "no_visual_contribution", [],
    ]


def test_whole_visible_mode_refuses_segmentation_unit():
    with pytest.raises(queue.ReviewQueueError, match="source-contract-only"):
        recorder.build_whole_visible_assignment(
            _unit(), _record(), ["player_body"],
            "assets/sprites/player-0001.xp", "not allowed",
        )


def test_whole_visible_mode_rejects_source_path_drift():
    with pytest.raises(queue.ReviewQueueError, match="XP path mismatch"):
        recorder.build_whole_visible_assignment(
            _unit("needs_source_contract"), _record(), ["player_body"],
            "assets/sprites/wrong.xp", "wrong alias",
        )


def test_reviewed_uniform_mode_records_manually_confirmed_clean_mask():
    unit = _unit()
    unit["candidate_role_sets"] = ["armor"]
    assignment = recorder.build_reviewed_uniform_assignment(
        unit, _record(), ["player_armor_regular"]
    )
    assert assignment["assignment_method"] == "reviewed_uniform_visible"
    assert assignment["semantic_spans"] == [
        [0, 0, 0, 0, 2, ["player_armor_regular"]],
    ]


def test_reviewed_uniform_mode_refuses_composite_candidate():
    with pytest.raises(queue.ReviewQueueError, match="refuses composite"):
        recorder.build_reviewed_uniform_assignment(
            _unit(), _record(), ["player_body", "player_weapon_sword"]
        )


def _partition_record(source_key: str, second_glyph: int) -> dict:
    return {
        "source_key": source_key,
        "source_xp": {"path": f"assets/sprites/{source_key.rsplit('-L', 1)[0]}.xp"},
        "frame_geometry": {
            "frame_width": 3, "frame_height": 1,
            "angles": 1, "frames_per_angle": 1,
        },
        "cell_values": [
            {
                "cell_type": "overlay_pixel",
                "render_operation": "fold_overlay_into_l2",
                "raw": {"glyph": 219, "fg": [1, 2, 3], "bg": [4, 5, 6]},
            },
            {
                "cell_type": "overlay_pixel",
                "render_operation": "fold_overlay_into_l2",
                "raw": {"glyph": second_glyph, "fg": [7, 8, 9], "bg": [10, 11, 12]},
            },
            {
                "cell_type": "transparent",
                "render_operation": "no_visual_contribution",
                "raw": {"glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]},
            },
        ],
        "cell_spans": [
            [0, 0, 0, 0, 1, 0],
            [0, 0, 0, 1, 1, 1],
            [0, 0, 0, 2, 1, 2],
        ],
        "coverage": {"raw_cells": 3},
    }


def test_reference_partition_uses_reviewed_exact_cells_and_explicit_delta():
    target_unit = _unit("needs_source_contract")
    target_record = _partition_record("player-1010-L3", 221)
    reference_unit = _unit("needs_cell_semantic_confirmation")
    reference_unit["review_unit_id"] = "xp-cell-unit:reference"
    reference_unit["source_layer_sha256"] = "b" * 64
    reference_unit["member_source_keys"] = ["player-1011-L3"]
    reference_unit["candidate_role_sets"] = ["armor"]
    reference_record = _partition_record("player-1011-L3", 222)
    reference_decision = recorder.layerwide.build_decision(
        reference_unit, reference_record, ["player_armor_regular"],
        "clean armor reviewed", ["viewer"], [], "reviewer", "2026-07-15",
    )
    assignment = recorder.build_reference_partition_assignment(
        target_unit, target_record, reference_unit, reference_record,
        reference_decision, ["player_armor_regular"],
        ["player_armor_regular", "player_shield_context"],
        "assets/sprites/player-1010.xp", "armor variant authored for shield context",
    )
    assert assignment["semantic_spans"] == [
        [0, 0, 0, 0, 1, ["player_armor_regular"]],
        [
            0, 0, 0, 1, 1,
            ["player_armor_regular", "player_shield_context"],
        ],
    ]
    assert assignment["reference_partition"]["exact_raw_coordinates"] == 1
    assert assignment["reference_partition"]["delta_coordinates"] == 1
    decision = recorder.build_decision(
        target_unit, target_record, assignment, "reviewed context partition",
        ["comparison"], [], "reviewer", "2026-07-15",
    )
    assert decision["review_provenance"]["assignment_method"] == (
        "reviewed_exact_reference_partition"
    )
    assert decision["review_provenance"]["reference_partition"][
        "reference_source_key"
    ] == "player-1011-L3"


def test_reference_partition_fails_when_reference_decision_lacks_role():
    target_unit = _unit("needs_source_contract")
    target_record = _partition_record("player-1010-L3", 221)
    reference_unit = _unit("needs_cell_semantic_confirmation")
    reference_unit["review_unit_id"] = "xp-cell-unit:reference"
    reference_unit["source_layer_sha256"] = "b" * 64
    reference_unit["member_source_keys"] = ["player-1011-L3"]
    reference_record = _partition_record("player-1011-L3", 222)
    reference_decision = recorder.layerwide.build_decision(
        reference_unit, reference_record, ["wrong_role"],
        "wrong baseline", ["viewer"], [], "reviewer", "2026-07-15",
    )
    with pytest.raises(queue.ReviewQueueError, match="lacks exact semantics"):
        recorder.build_reference_partition_assignment(
            target_unit, target_record, reference_unit, reference_record,
            reference_decision, ["player_armor_regular"],
            ["player_shield_context"], "assets/sprites/player-1010.xp",
            "context contract",
        )


def test_real_player_nude_whole_visible_source_contract_check(tmp_path, capsys):
    import json

    decisions = (
        PIPELINE.parent
        / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract/cell_role_decisions.jsonl"
    )
    target_unit = "xp-cell-unit:30d31c1d7cf94fb471e4:de6b725b2d10"
    before_decision = tmp_path / "cell_role_decisions.jsonl"
    before_decision.write_text("".join(
        line for line in decisions.read_text(encoding="utf-8").splitlines(keepends=True)
        if json.loads(line).get("review_unit_id") != target_unit
    ), encoding="utf-8")
    rc = recorder.main([
        "--source-key", "player-nude-base-L2",
        "--whole-visible-semantic", "player_body",
        "--source-contract-path", "assets/sprites/player-nude.xp",
        "--source-contract-decision",
        "player-nude-base resolves to player-nude.xp and every visible L2 cell contributes player_body",
        "--decision", "reviewed full-atlas player nude body source contract",
        "--evidence-ref", "full-atlas comparison player-nude-base-L2 vs player-0000-L2",
        "--out", str(before_decision),
        "--check",
    ])
    assert rc == 0
    output = capsys.readouterr().out
    assert f'"recorded_unit": "{target_unit}"' in output
    assert '"decided_units": 114' in output
    assert '"pending_units": 89' in output
