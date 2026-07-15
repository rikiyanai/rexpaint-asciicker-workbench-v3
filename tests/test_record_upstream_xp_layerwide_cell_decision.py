"""Tests for manual layer-wide FL-4162 cell decisions."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import record_upstream_xp_layerwide_cell_decision as recorder  # noqa: E402
import build_upstream_xp_cell_review_queue as queue  # noqa: E402


def _unit(state: str = "needs_cell_semantic_confirmation") -> dict:
    return {
        "review_unit_id": "xp-cell-unit:test",
        "decision_state": state,
        "source_layer_sha256": "a" * 64,
        "frame_geometry": {
            "frame_width": 2, "frame_height": 1,
            "angles": 1, "frames_per_angle": 1,
        },
        "member_source_keys": ["player-0000-L2"],
        "candidate_role_sets": ["player_body"],
    }


def _record() -> dict:
    return {
        "source_key": "player-0000-L2",
        "frame_geometry": _unit()["frame_geometry"],
        "coverage": {"raw_cells": 2},
        "cell_values": [
            {
                "raw": {"glyph": 64, "fg": [1, 2, 3], "bg": [4, 5, 6]},
                "cell_type": "body_pixel",
                "render_operation": "seed_l2_base_accumulator",
            },
            {
                "raw": {"glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]},
                "cell_type": "transparent",
                "render_operation": "no_visual_contribution",
            },
        ],
        "cell_spans": [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 1, 1]],
    }


def test_layerwide_decision_separates_render_from_semantics():
    decision = recorder.build_decision(
        _unit(), _record(), ["player_body"], "reviewed body",
        ["viewer:player-0000-L2"], [], "reviewer", "2026-07-15",
    )
    assert decision["cell_assignments"] == [
        [0, 0, 0, 0, 1, "seed_l2_base_accumulator", ["player_body"]],
        [0, 0, 0, 1, 1, "no_visual_contribution", []],
    ]


def test_layerwide_decision_refuses_segmentation_unit():
    with pytest.raises(queue.ReviewQueueError, match="refuses needs_cell_role_segmentation"):
        recorder.build_decision(
            _unit("needs_cell_role_segmentation"), _record(), ["body", "shield"],
            "not allowed", ["viewer"], [], "reviewer", "2026-07-15",
        )
