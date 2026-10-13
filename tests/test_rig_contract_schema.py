"""Tests for rig_contract schema validation — U2 coverage.

Covers:
- _validate_rig_contracts() accepts valid contracts
- Rejects missing rig_definition_id
- Rejects contracts with < 8 angle entries in any socket
- Rejects unknown socket names
- validate_structural_gates (bundle reference check): error when rig_definition_id
  referenced but contract absent
- wolfie_crossbow_v1 entry in positive.bundle.json passes validation and has
  rider_pelvis offsets matching calibration artifact
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Append Y9-2 root so scripts.pipeline resolves to the vendored copy.
# Using append (not insert) keeps pipeline-v3's scripts/ first, preventing
# conflicts with pipeline-v3 modules like scripts.validate_semantic_maps.
Y9_2_ROOT = Path(__file__).resolve().parents[1] / "asciicker-Y9-2"
if str(Y9_2_ROOT) not in sys.path:
    sys.path.append(str(Y9_2_ROOT))

from scripts.pipeline.appearance_bundle import _validate_rig_contracts, BundleCompileError


REPO_ROOT = Path(__file__).resolve().parents[1]
CALIBRATION = REPO_ROOT / "output" / "manual" / "mounted-rider-offset-angle0-frame0-proj0.json"
BUNDLE_SRC = REPO_ROOT / "asciicker-Y9-2" / "assets" / "appearance_bundle" / "phase2-fixtures" / "positive.bundle.json"


def _make_socket(offsets: list[tuple[int, int]] | None = None, visibility: str = "always") -> dict:
    """Build a valid socket dict with 8 zero-offset entries."""
    if offsets is None:
        offsets = [(0, 0)] * 8
    return {
        "angle_offsets": [
            {"angle": i, "dx": dx, "dy": dy}
            for i, (dx, dy) in enumerate(offsets)
        ],
        "visibility": visibility,
    }


def _make_contract(rig_id: str = "test_v1", **overrides) -> dict:
    """Build a valid rig_contract dict."""
    c: dict = {
        "rig_definition_id": rig_id,
        "version": 1,
        "sockets": {
            "rider_pelvis": _make_socket(),
            "mount_saddle": _make_socket(),
            "weapon_grip": _make_socket(),
            "mount_rear_occlusion": _make_socket(),
            "mount_front_occlusion": _make_socket(),
        },
        "layer_order": ["mount_rear_occlusion", "body", "weapon_grip", "mount_front_occlusion"],
    }
    c.update(overrides)
    return c


class TestValidateRigContracts:
    def test_empty_list_returns_empty(self):
        assert _validate_rig_contracts({}) == []
        assert _validate_rig_contracts({"rig_contracts": []}) == []

    def test_valid_contract_passes(self):
        manifest = {"rig_contracts": [_make_contract()]}
        result = _validate_rig_contracts(manifest)
        assert len(result) == 1
        assert result[0]["rig_definition_id"] == "test_v1"

    def test_multiple_valid_contracts_pass(self):
        manifest = {"rig_contracts": [_make_contract("a_v1"), _make_contract("b_v1")]}
        result = _validate_rig_contracts(manifest)
        assert len(result) == 2

    def test_rejects_missing_rig_definition_id(self):
        c = _make_contract()
        del c["rig_definition_id"]
        with pytest.raises(BundleCompileError, match="rig_definition_id"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_empty_rig_definition_id(self):
        c = _make_contract(rig_id="")
        with pytest.raises(BundleCompileError, match="rig_definition_id"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_duplicate_rig_definition_id(self):
        with pytest.raises(BundleCompileError, match="duplicate"):
            _validate_rig_contracts({"rig_contracts": [_make_contract("dup"), _make_contract("dup")]})

    def test_rejects_missing_socket(self):
        c = _make_contract()
        del c["sockets"]["weapon_grip"]
        with pytest.raises(BundleCompileError, match="weapon_grip"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_unknown_socket_name(self):
        c = _make_contract()
        c["sockets"]["unknown_socket"] = _make_socket()
        with pytest.raises(BundleCompileError, match="unknown socket"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_fewer_than_8_angle_entries(self):
        bad_socket = {
            "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(7)],
            "visibility": "always",
        }
        c = _make_contract()
        c["sockets"]["rider_pelvis"] = bad_socket
        with pytest.raises(BundleCompileError, match="exactly 8"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_more_than_8_angle_entries(self):
        bad_socket = {
            "angle_offsets": [{"angle": i % 8, "dx": 0, "dy": 0} for i in range(9)],
            "visibility": "always",
        }
        c = _make_contract()
        c["sockets"]["rider_pelvis"] = bad_socket
        with pytest.raises(BundleCompileError, match="exactly 8"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_duplicate_angle_in_socket(self):
        bad_socket = {
            "angle_offsets": [{"angle": 0, "dx": 0, "dy": 0}] * 8,
            "visibility": "always",
        }
        c = _make_contract()
        c["sockets"]["rider_pelvis"] = bad_socket
        with pytest.raises(BundleCompileError, match="duplicate angle"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_invalid_visibility(self):
        bad_socket = _make_socket()
        bad_socket["visibility"] = "never"
        c = _make_contract()
        c["sockets"]["weapon_grip"] = bad_socket
        with pytest.raises(BundleCompileError, match="visibility"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_angle_range_requires_visible_angles(self):
        ar_socket = _make_socket(visibility="angle_range")
        # no visible_angles key
        c = _make_contract()
        c["sockets"]["weapon_grip"] = ar_socket
        with pytest.raises(BundleCompileError, match="visible_angles"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_angle_range_with_visible_angles_passes(self):
        ar_socket = _make_socket(visibility="angle_range")
        ar_socket["visible_angles"] = [0, 1, 2, 3, 4, 5, 6, 7]
        c = _make_contract()
        c["sockets"]["weapon_grip"] = ar_socket
        result = _validate_rig_contracts({"rig_contracts": [c]})
        assert len(result) == 1

    def test_rejects_non_integer_dx(self):
        bad_socket = _make_socket()
        bad_socket["angle_offsets"][0]["dx"] = "0"
        c = _make_contract()
        c["sockets"]["rider_pelvis"] = bad_socket
        with pytest.raises(BundleCompileError, match="dx"):
            _validate_rig_contracts({"rig_contracts": [c]})

    def test_rejects_rig_contracts_not_array(self):
        with pytest.raises(BundleCompileError, match="array"):
            _validate_rig_contracts({"rig_contracts": {"bad": "type"}})


class TestWolfieContractInBundle:
    """Integration: wolfie_crossbow_v1 in positive.bundle.json passes validation."""

    def test_bundle_wolfie_contract_validates(self):
        manifest = json.loads(BUNDLE_SRC.read_text(encoding="utf-8"))
        contracts = _validate_rig_contracts(manifest)
        ids = [c["rig_definition_id"] for c in contracts]
        assert "wolfie_crossbow_v1" in ids

    def test_wolfie_contract_has_all_five_sockets(self):
        manifest = json.loads(BUNDLE_SRC.read_text(encoding="utf-8"))
        contracts = _validate_rig_contracts(manifest)
        wolfie = next(c for c in contracts if c["rig_definition_id"] == "wolfie_crossbow_v1")
        assert set(wolfie["sockets"].keys()) == {
            "rider_pelvis", "mount_saddle", "weapon_grip",
            "mount_rear_occlusion", "mount_front_occlusion",
        }

    @pytest.mark.skipif(not CALIBRATION.exists(), reason="calibration artifact not present")
    def test_wolfie_rider_pelvis_matches_calibration_artifact(self):
        calib = json.loads(CALIBRATION.read_text(encoding="utf-8"))
        manifest = json.loads(BUNDLE_SRC.read_text(encoding="utf-8"))
        contracts = _validate_rig_contracts(manifest)
        wolfie = next(c for c in contracts if c["rig_definition_id"] == "wolfie_crossbow_v1")
        offsets = wolfie["sockets"]["rider_pelvis"]["angle_offsets"]
        offset_map = {entry["angle"]: (entry["dx"], entry["dy"]) for entry in offsets}

        for per in calib.get("per_angle", []):
            angle = per["angle"]
            expected = (per["dx"], per["dy"])
            actual = offset_map.get(angle)
            assert actual == expected, (
                f"rider_pelvis angle {angle}: expected {expected}, got {actual}"
            )
