#!/usr/bin/env python3
"""Rig seam visual proof fixture — U7.

Defines the proof procedure for wolfie + crossbow alignment at 8 angles.
Headed screenshot capture requires Y9-2 game session (not automated here).
These tests validate the data prerequisites for proof, not the visual output.

Mark: @pytest.mark.rig_seam_proof
Tests run without Blender and without a headed session.
"""

import json
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
Y9_2_ROOT = REPO_ROOT / "asciicker-Y9-2"
BUNDLE_CURRENT = Y9_2_ROOT / "assets" / "appearance_bundle" / "current"
RENDER_PLANS_PATH = BUNDLE_CURRENT / "render_plans.json"
RIG_CONTRACT_ID = "wolfie_crossbow_v1"


@pytest.fixture(scope="module")
def render_plans_data():
    """Compile render_plans.json if needed and load it."""
    # Compile if render_plans.json doesn't exist
    if not RENDER_PLANS_PATH.exists():
        bundle_src = Y9_2_ROOT / "assets" / "appearance_bundle" / "phase2-fixtures" / "positive.bundle.json"
        sprites_root = Y9_2_ROOT / "assets" / "sprites"
        
        result = subprocess.run(
            [
                "python3", "-m", "scripts.pipeline.appearance_bundle",
                "compile",
                "--bundle-src", str(bundle_src),
                "--sprites-root", str(sprites_root),
                "--out-dir", str(BUNDLE_CURRENT),
            ],
            cwd=Y9_2_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode != 0:
            pytest.fail(f"Bundle compile failed: {result.stderr}")
    
    # Load render_plans.json
    if not RENDER_PLANS_PATH.exists():
        pytest.fail(f"render_plans.json not found at {RENDER_PLANS_PATH}")
    
    return json.loads(RENDER_PLANS_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def bundle_data():
    """Load appearance_bundle.json."""
    bundle_path = BUNDLE_CURRENT / "appearance_bundle.json"
    if not bundle_path.exists():
        pytest.fail(f"appearance_bundle.json not found at {bundle_path}")
    return json.loads(bundle_path.read_text(encoding="utf-8"))


class TestRenderPlansExists:
    """Test that render_plans.json exists and is valid."""

    def test_render_plans_json_exists(self, render_plans_data):
        """render_plans.json exists in asciicker-Y9-2/assets/appearance_bundle/current/."""
        assert RENDER_PLANS_PATH.exists(), f"render_plans.json not found at {RENDER_PLANS_PATH}"

    def test_render_plans_has_required_keys(self, render_plans_data):
        """render_plans.json has schema_version, render_plans array, bundle_hash."""
        assert "schema_version" in render_plans_data
        assert "render_plans" in render_plans_data
        assert isinstance(render_plans_data["render_plans"], list)
        assert "bundle_hash" in render_plans_data


class TestRigEnabledRows:
    """Test that rig-enabled rows exist in render_plans.json."""

    def test_has_rig_enabled_rows(self, render_plans_data):
        """render_plans.json contains at least one row with rig_definition_id."""
        rig_rows = [
            r for r in render_plans_data["render_plans"]
            if r.get("server_visual_key", {}).get("rig_definition_id")
        ]
        assert len(rig_rows) > 0, "No rig-enabled rows found in render_plans.json"

    def test_wolfie_crossbow_v1_row_exists(self, render_plans_data):
        """render_plans.json contains a row with rig_definition_id='wolfie_crossbow_v1'."""
        rig_rows = [
            r for r in render_plans_data["render_plans"]
            if r.get("server_visual_key", {}).get("rig_definition_id") == RIG_CONTRACT_ID
        ]
        assert len(rig_rows) > 0, f"No rows found with rig_definition_id='{RIG_CONTRACT_ID}'"

    def test_rig_row_has_offset_by_angle(self, render_plans_data):
        """Rig-enabled row has offset_by_angle populated on at least one layer (non-empty, 8 entries)."""
        rig_rows = [
            r for r in render_plans_data["render_plans"]
            if r.get("server_visual_key", {}).get("rig_definition_id") == RIG_CONTRACT_ID
        ]
        assert len(rig_rows) > 0
        
        row = rig_rows[0]
        ordered_layers = row.get("ordered_layers", [])
        assert len(ordered_layers) > 0, "Rig-enabled row has no ordered_layers"
        
        # At least one layer should have offset_by_angle with 8 entries
        has_offsets = False
        for layer in ordered_layers:
            offsets = layer.get("offset_by_angle")
            if offsets and isinstance(offsets, list) and len(offsets) == 8:
                has_offsets = True
                # Verify each offset is a [dx, dy] pair
                for offset in offsets:
                    assert isinstance(offset, list) and len(offset) == 2, \
                        f"offset_by_angle entry should be [dx, dy], got {offset}"
                break
        
        assert has_offsets, "No layer has offset_by_angle with 8 entries"


class TestRigContractStructure:
    """Test wolfie_crossbow_v1 rig contract structure."""

    def test_rig_contract_exists(self, bundle_data):
        """wolfie_crossbow_v1 rig contract exists in appearance_bundle.json."""
        rig_contracts = bundle_data.get("rig_contracts", [])
        contract = next((c for c in rig_contracts if c.get("rig_definition_id") == RIG_CONTRACT_ID), None)
        assert contract is not None, f"rig_contract '{RIG_CONTRACT_ID}' not found"

    def test_rider_pelvis_offset_angle_0(self, bundle_data):
        """wolfie_crossbow_v1 contract rider_pelvis offset at angle 0 = [1, 0] (from calibration)."""
        rig_contracts = bundle_data.get("rig_contracts", [])
        contract = next((c for c in rig_contracts if c.get("rig_definition_id") == RIG_CONTRACT_ID), None)
        assert contract is not None
        
        sockets = contract.get("sockets", {})
        rider_pelvis = sockets.get("rider_pelvis", {})
        angle_offsets = rider_pelvis.get("angle_offsets", [])
        
        # Find angle 0 offset
        angle_0_offset = next((e for e in angle_offsets if e.get("angle") == 0), None)
        assert angle_0_offset is not None, "rider_pelvis has no angle 0 offset"
        
        # From calibration: dx=1, dy=0
        assert angle_0_offset.get("dx") == 1, f"rider_pelvis angle 0 dx should be 1, got {angle_0_offset.get('dx')}"
        assert angle_0_offset.get("dy") == 0, f"rider_pelvis angle 0 dy should be 0, got {angle_0_offset.get('dy')}"

    def test_all_five_sockets_present(self, bundle_data):
        """All 5 socket types present in the contract."""
        required_sockets = {
            "rider_pelvis",
            "mount_saddle",
            "weapon_grip",
            "mount_rear_occlusion",
            "mount_front_occlusion",
        }
        
        rig_contracts = bundle_data.get("rig_contracts", [])
        contract = next((c for c in rig_contracts if c.get("rig_definition_id") == RIG_CONTRACT_ID), None)
        assert contract is not None
        
        sockets = contract.get("sockets", {})
        present_sockets = set(sockets.keys())
        
        missing = required_sockets - present_sockets
        assert len(missing) == 0, f"Missing required sockets: {missing}"
        
        extra = present_sockets - required_sockets
        assert len(extra) == 0, f"Unknown sockets: {extra}"

    def test_layer_order_correct(self, bundle_data):
        """layer_order has mount_rear_occlusion before body before weapon_grip before mount_front_occlusion."""
        rig_contracts = bundle_data.get("rig_contracts", [])
        contract = next((c for c in rig_contracts if c.get("rig_definition_id") == RIG_CONTRACT_ID), None)
        assert contract is not None
        
        layer_order = contract.get("layer_order", [])
        
        # Required order: mount_rear_occlusion < body < weapon_grip < mount_front_occlusion
        required_order = ["mount_rear_occlusion", "body", "weapon_grip", "mount_front_occlusion"]
        
        # Check that all required sockets are in layer_order
        for socket in required_order:
            assert socket in layer_order, f"layer_order missing '{socket}'"
        
        # Check order
        indices = {socket: layer_order.index(socket) for socket in required_order}
        assert indices["mount_rear_occlusion"] < indices["body"], \
            "mount_rear_occlusion should come before body"
        assert indices["body"] < indices["weapon_grip"], \
            "body should come before weapon_grip"
        assert indices["weapon_grip"] < indices["mount_front_occlusion"], \
            "weapon_grip should come before mount_front_occlusion"


class TestRenderPlanRowCount:
    """Test render plan row counts for reporting."""

    def test_total_row_count(self, render_plans_data):
        """Report total render plan row count."""
        total_rows = len(render_plans_data["render_plans"])
        print(f"\nTotal render plan rows: {total_rows}")
        assert total_rows > 0, "No render plan rows found"

    def test_rig_enabled_row_count(self, render_plans_data):
        """Report rig-enabled row count."""
        rig_rows = [
            r for r in render_plans_data["render_plans"]
            if r.get("server_visual_key", {}).get("rig_definition_id")
        ]
        print(f"\nRig-enabled render plan rows: {len(rig_rows)}")
        # At least one rig row should exist (wolfie_crossbow_proof_idle)
        assert len(rig_rows) >= 1, "Expected at least 1 rig-enabled row"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
