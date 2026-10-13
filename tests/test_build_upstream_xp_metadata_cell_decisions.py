"""Tests for source-reviewed L0/L1 cell semantics."""
from __future__ import annotations

import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_metadata_cell_decisions as metadata  # noqa: E402


def test_get_digit_matches_upstream_contract():
    assert metadata.get_digit(ord("0")) == 0
    assert metadata.get_digit(ord("9")) == 9
    assert metadata.get_digit(ord("A")) == 10
    assert metadata.get_digit(ord("Z")) == 35
    assert metadata.get_digit(ord("?")) == -1


def test_l0_roles_preserve_color_key_and_consumed_metadata_coordinates():
    geometry = {"frame_width": 3, "frame_height": 3, "frames_per_angle": 2}
    value = {"raw": {"glyph": 2}}
    roles = metadata._l0_roles((0, 0, 0, 0), value, geometry, {1})
    assert roles == ("per_cell_color_key", "view_angle_count", "frame_meta_position_marker")
    assert metadata._l0_roles((0, 0, 1, 0), value, geometry, {1}) == (
        "per_cell_color_key", "projection_y_reference", "frame_meta_position_marker"
    )


def test_assignment_compression_keeps_role_boundaries():
    assignments = metadata._compress_assignments({
        (0, 0, 0, 0): ("define_color_key", ("color",)),
        (0, 0, 0, 1): ("define_color_key", ("color",)),
        (0, 0, 0, 2): ("define_color_key", ("color", "angle")),
    })
    assert assignments == [
        [0, 0, 0, 0, 2, "define_color_key", ["color"]],
        [0, 0, 0, 2, 1, "define_color_key", ["color", "angle"]],
    ]
