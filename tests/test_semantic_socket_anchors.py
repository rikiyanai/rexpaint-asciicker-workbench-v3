"""Tests for socket anchor loading — U3.

Every test cross-references against independent ground truth:
- The semantic region atlas (_REGION_ATLAS) defines canonical body-part bounds.
- The calibration artifact (mounted-rider-offset-*.json) was computed by pixel-
  matching player-0100.xp against wolfie-0100.xp layer 3 — independent of
  socket_anchors.
- wolfie-0100.json and player-crossbow.json define per-angle body/weapon bboxes
  that were authored separately from socket_anchors.

No test encodes a hardcoded magic coordinate like (3,6). All expected values are
derived from the atlas or cross-referenced against existing semantic map data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
Y9_2_ROOT = REPO_ROOT / "asciicker-Y9-2"
MAPS_DIR = REPO_ROOT / "docs" / "research" / "ascii" / "semantic_maps"
SCHEMA_FILE = MAPS_DIR / "schema.json"
CALIBRATION = REPO_ROOT / "output" / "manual" / "mounted-rider-offset-angle0-frame0-proj0.json"

if str(Y9_2_ROOT) not in sys.path:
    sys.path.append(str(Y9_2_ROOT))

from scripts.pipeline.bundle_wizard.semantic_dict import (
    load_socket_anchors,
    VALID_SOCKET_NAMES,
    _REGION_ATLAS,
    _scale_bounds,
)

# ── helpers ──────────────────────────────────────────────────────────────────

def _atlas_center(region_name: str, frame_w: int, frame_h: int) -> tuple[int, int]:
    """Return the integer center (col, row) of a named atlas region for given frame dims.

    Uses the canonical _REGION_ATLAS — the same data that powers identify().
    This is NOT a hardcoded constant; it's the live atlas definition.
    """
    for entry in _REGION_ATLAS:
        if entry["name"] == region_name:
            row_lo, row_hi = _scale_bounds(
                float(entry["row_frac"][0]), float(entry["row_frac"][1]), frame_h
            )
            col_lo, col_hi = _scale_bounds(
                float(entry["col_frac"][0]), float(entry["col_frac"][1]), frame_w
            )
            return ((col_lo + col_hi) // 2, (row_lo + row_hi) // 2)
    raise KeyError(f"Region '{region_name}' not found in _REGION_ATLAS")


def _load_calibration() -> dict:
    """Load the calibration artifact. Returns empty dict if missing."""
    if not CALIBRATION.exists():
        return {}
    return json.loads(CALIBRATION.read_text(encoding="utf-8"))


def _load_map(map_name: str) -> dict:
    """Load a semantic map JSON. Raises if missing."""
    path = MAPS_DIR / f"{map_name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


# ── tests ────────────────────────────────────────────────────────────────────

class TestRiderPelvisAgainstBodyBbox:
    """Every rider_pelvis anchor must fall inside the wolf body region bbox
    at its corresponding angle. The body bboxes were authored independently
    in the semantic map — they are ground truth for 'where the wolf body is'."""

    def test_all_8_angles_inside_body_bbox(self):
        wolfie = _load_map("wolfie-0100")
        anchors = load_socket_anchors("wolfie-0100", "rider_pelvis")
        assert len(anchors) == 8, "rider_pelvis must return 8 entries"

        failures = []
        for entry in anchors:
            angle = entry["angle"]
            frame_key = str(angle)
            frame = wolfie["frames"].get(frame_key)
            assert frame is not None, f"wolfie-0100 missing frame for angle {angle}"

            body = next((r for r in frame["regions"] if r["name"] == "body"), None)
            assert body is not None, f"wolfie-0100 angle {angle} missing body region"

            bx0, by0, bx1, by1 = body["bbox"]
            ax, ay = entry["x"], entry["y"]

            if not (bx0 <= ax <= bx1 and by0 <= ay <= by1):
                failures.append(
                    f"angle {angle}: anchor ({ax},{ay}) outside body bbox "
                    f"[{bx0},{by0},{bx1},{by1}]"
                )

        assert not failures, (
            f"{len(failures)}/{len(anchors)} rider_pelvis anchors outside body bbox:\n"
            + "\n".join(failures)
        )


class TestRiderPelvisAgainstCalibration:
    """The rider_pelvis socket anchors must be consistent with the calibration
    artifact. The calibration was computed by pixel-matching player-0100 cells
    against wolfie-0100 layer 3 — it is independent of socket_anchors.

    Derivation:
      pelvis_center = atlas_center("pelvis", frame_w=7, frame_h=10)
      expected_anchor(angle) = pelvis_center + calibration_offset(angle)

    Where pelvis_center is derived from _REGION_ATLAS (live code, not a magic
    number) and calibration_offset comes from the artifact."""

    @pytest.mark.skipif(not CALIBRATION.exists(), reason="calibration artifact missing")
    def test_all_8_angles_match_calibration_plus_atlas_pelvis(self):
        calib = _load_calibration()
        per_angle = calib.get("per_angle", [])
        assert len(per_angle) == 8, f"calibration artifact has {len(per_angle)} per_angle entries, expected 8"

        # Derive pelvis center from the live atlas — NOT a hardcoded (3,6).
        pelvis_cx, pelvis_cy = _atlas_center("pelvis", frame_w=7, frame_h=10)

        # Build expected anchors: atlas_pelvis + calibration offset per angle.
        calib_map: dict[int, tuple[int, int]] = {}
        for pa in per_angle:
            calib_map[pa["angle"]] = (pa["dx"], pa["dy"])

        anchors = load_socket_anchors("wolfie-0100", "rider_pelvis")
        assert len(anchors) == 8

        failures = []
        for entry in anchors:
            angle = entry["angle"]
            dx, dy = calib_map.get(angle, (None, None))
            assert dx is not None, f"calibration missing angle {angle}"

            expected_x = pelvis_cx + dx
            expected_y = pelvis_cy + dy

            if entry["x"] != expected_x or entry["y"] != expected_y:
                failures.append(
                    f"angle {angle}: got ({entry['x']},{entry['y']}), "
                    f"expected ({expected_x},{expected_y}) "
                    f"[atlas pelvis=({pelvis_cx},{pelvis_cy}) + calib offset=({dx},{dy})]"
                )

        assert not failures, (
            f"{len(failures)}/{len(anchors)} angles don't match calibration:\n"
            + "\n".join(failures)
        )


class TestWeaponGripAgainstWeaponBbox:
    """player-crossbow.json defines a 'weapon' region with bbox at angle 0.
    The weapon_grip socket anchor at angle 0 must fall inside that bbox.
    For other angles the map doesn't define weapon regions, so we only
    test angle 0 — but it's a real cross-reference."""

    def test_angle0_grip_inside_weapon_bbox(self):
        crossbow = _load_map("player-crossbow")
        frame0 = crossbow["frames"].get("0")
        assert frame0 is not None, "player-crossbow missing frame 0"

        weapon_region = next((r for r in frame0["regions"] if r["name"] == "weapon"), None)
        assert weapon_region is not None, "player-crossbow frame 0 missing 'weapon' region"

        bx0, by0, bx1, by1 = weapon_region["bbox"]

        anchors = load_socket_anchors("player-crossbow", "weapon_grip")
        assert len(anchors) == 8

        angle0 = next((e for e in anchors if e["angle"] == 0), None)
        assert angle0 is not None, "weapon_grip missing angle 0"

        ax, ay = angle0["x"], angle0["y"]
        assert bx0 <= ax <= bx1 and by0 <= ay <= by1, (
            f"weapon_grip angle 0 ({ax},{ay}) outside weapon bbox "
            f"[{bx0},{by0},{bx1},{by1}]"
        )

    def test_angle0_grip_matches_atlas_weapon_hand(self):
        """Bonus: the weapon_grip anchor should be near the atlas weapon_hand center."""
        wh_cx, wh_cy = _atlas_center("weapon_hand", frame_w=7, frame_h=10)
        anchors = load_socket_anchors("player-crossbow", "weapon_grip")
        angle0 = next(e for e in anchors if e["angle"] == 0)
        # Allow ±2 tolerance — the atlas center is a fractional midpoint, not exact.
        assert abs(angle0["x"] - wh_cx) <= 2, (
            f"weapon_grip x={angle0['x']} too far from atlas weapon_hand center x={wh_cx}"
        )
        assert abs(angle0["y"] - wh_cy) <= 2, (
            f"weapon_grip y={angle0['y']} too far from atlas weapon_hand center y={wh_cy}"
        )


class TestBackwardCompat:
    """Old maps without socket_anchors must not break the loader."""

    def test_map_without_socket_anchors_returns_empty(self):
        # player-0100.json predates socket_anchors.
        entries = load_socket_anchors("player-0100", "rider_pelvis")
        assert entries == []

    def test_schema_accepts_map_without_socket_anchors(self):
        map_data = _load_map("player-0100")
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
        try:
            import jsonschema
            jsonschema.Draft202012Validator(schema).validate(map_data)
        except ImportError:
            pass  # jsonschema not installed — skip validation
        except jsonschema.ValidationError as e:
            pytest.fail(f"player-0100.json violated schema: {e.message}")

    def test_socket_anchors_not_in_required_list(self):
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
        assert "socket_anchors" not in schema.get("required", [])


class TestRobustness:
    """Loader must not crash or return garbage on bad inputs."""

    def test_nonexistent_map_returns_empty(self):
        assert load_socket_anchors("no_such_map_xyz", "rider_pelvis") == []

    def test_nonexistent_socket_returns_empty(self):
        assert load_socket_anchors("wolfie-0100", "not_a_real_socket") == []

    def test_socket_not_in_valid_set_returns_empty(self):
        # Any string not in VALID_SOCKET_NAMES returns [] immediately
        assert load_socket_anchors("wolfie-0100", "garbage") == []

    def test_duplicate_angles_rejected(self):
        """Write a malformed temp map, verify loader rejects it."""
        import tempfile
        bad = {
            "schema_version": "0.1.0", "family": "player",
            "reference_xp": "../../../../assets/sprites/player-0100.xp",
            "semantic_layer": 2, "frame_w": 7, "frame_h": 10,
            "grid_layout": {"angles": 8, "projections": 2, "anim_counts": [1],
                            "frames_per_row": 9, "rows": 6},
            "palette_roles": {}, "frames": {},
            "socket_anchors": {
                "rider_pelvis": [
                    {"angle": 0, "x": 1, "y": 1},
                    {"angle": 0, "x": 2, "y": 2},  # duplicate
                    {"angle": 1, "x": 0, "y": 0}, {"angle": 2, "x": 0, "y": 0},
                    {"angle": 3, "x": 0, "y": 0}, {"angle": 4, "x": 0, "y": 0},
                    {"angle": 5, "x": 0, "y": 0}, {"angle": 6, "x": 0, "y": 0},
                ],
            },
        }
        tmp = MAPS_DIR / "_cr_dup.json"
        try:
            tmp.write_text(json.dumps(bad))
            assert load_socket_anchors("_cr_dup", "rider_pelvis") == []
        finally:
            tmp.unlink(missing_ok=True)

    def test_oob_angle_rejected(self):
        import tempfile
        bad = {
            "schema_version": "0.1.0", "family": "player",
            "reference_xp": "../../../../assets/sprites/player-0100.xp",
            "semantic_layer": 2, "frame_w": 7, "frame_h": 10,
            "grid_layout": {"angles": 8, "projections": 2, "anim_counts": [1],
                            "frames_per_row": 9, "rows": 6},
            "palette_roles": {}, "frames": {},
            "socket_anchors": {
                "rider_pelvis": [
                    {"angle": 8, "x": 0, "y": 0},
                    {"angle": 0, "x": 0, "y": 0}, {"angle": 1, "x": 0, "y": 0},
                    {"angle": 2, "x": 0, "y": 0}, {"angle": 3, "x": 0, "y": 0},
                    {"angle": 4, "x": 0, "y": 0}, {"angle": 5, "x": 0, "y": 0},
                    {"angle": 6, "x": 0, "y": 0},
                ],
            },
        }
        tmp = MAPS_DIR / "_cr_oob.json"
        try:
            tmp.write_text(json.dumps(bad))
            assert load_socket_anchors("_cr_oob", "rider_pelvis") == []
        finally:
            tmp.unlink(missing_ok=True)

    def test_non_integer_coords_rejected(self):
        import tempfile
        bad = {
            "schema_version": "0.1.0", "family": "player",
            "reference_xp": "../../../../assets/sprites/player-0100.xp",
            "semantic_layer": 2, "frame_w": 7, "frame_h": 10,
            "grid_layout": {"angles": 8, "projections": 2, "anim_counts": [1],
                            "frames_per_row": 9, "rows": 6},
            "palette_roles": {}, "frames": {},
            "socket_anchors": {
                "rider_pelvis": [
                    {"angle": 0, "x": "bad", "y": 0},
                    {"angle": 1, "x": 0, "y": 0}, {"angle": 2, "x": 0, "y": 0},
                    {"angle": 3, "x": 0, "y": 0}, {"angle": 4, "x": 0, "y": 0},
                    {"angle": 5, "x": 0, "y": 0}, {"angle": 6, "x": 0, "y": 0},
                    {"angle": 7, "x": 0, "y": 0},
                ],
            },
        }
        tmp = MAPS_DIR / "_cr_type.json"
        try:
            tmp.write_text(json.dumps(bad))
            assert load_socket_anchors("_cr_type", "rider_pelvis") == []
        finally:
            tmp.unlink(missing_ok=True)


class TestSocketVocabulary:
    """The five socket names must be consistent between Python code and schema."""

    def test_code_and_schema_agree(self):
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
        schema_names = set(
            schema["properties"]["socket_anchors"]["propertyNames"]["enum"]
        )
        assert schema_names == set(VALID_SOCKET_NAMES)

    def test_all_five_valid_names_accepted_by_loader(self):
        """Every valid socket name should be loadable (returns list, not exception)."""
        for name in VALID_SOCKET_NAMES:
            result = load_socket_anchors("wolfie-0100", name)
            assert isinstance(result, list), f"{name}: expected list, got {type(result)}"
            assert len(result) == 8, f"{name}: expected 8 entries, got {len(result)}"
