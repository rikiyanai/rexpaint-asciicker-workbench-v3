"""Tests for U4: Compiler math (rig contracts → per-angle layer offsets).

These tests verify the ACTUAL feature: when compile_render_plan_row() processes
a profile with rig_definition_id, it must:
1. Look up the rig contract from rig_contracts dict
2. Map layer indices to socket names via layer_order
3. Populate offset_by_angle from socket's angle_offsets
4. Populate visible_at_angles from socket's visibility
5. FAIL HARD if rig_definition_id is set but contract not found
"""

import json
import logging
import sys
import tempfile
from pathlib import Path

import pytest

# Y9-2 is a subdirectory of the pipeline-v3 repo root (parents[1]).
Y9_2_ROOT = Path(__file__).resolve().parents[1] / "asciicker-Y9-2"
Y9_2_PIPELINE = Y9_2_ROOT / "scripts" / "pipeline"
POSITIVE_BUNDLE_PATH = Y9_2_ROOT / "assets" / "appearance_bundle" / "phase2-fixtures" / "positive.bundle.json"

for p in [str(Y9_2_ROOT), str(Y9_2_PIPELINE)]:
    if p not in sys.path:
        sys.path.append(p)

from render_plan_table import compile_render_plan_row, compile_render_plan_table
from src.pipeline_v2.actor_visual_profile import ActorVisualProfile, LayerAssignment, Region


def _load_positive_bundle_manifest() -> dict:
    """Load the source bundle manifest (positive.bundle.json)."""
    return json.loads(POSITIVE_BUNDLE_PATH.read_text(encoding="utf-8"))


def _make_profile(profile_id: str, rig_id: str | None, layers: list[tuple[str, int]]) -> ActorVisualProfile:
    """Create a test profile with specified layers.
    
    Args:
        profile_id: Profile identifier
        rig_id: rig_definition_id (or None)
        layers: List of (slot_name, layer_definition_id) tuples
    """
    layer_objs = [
        LayerAssignment(
            slot=slot,
            layer_definition_id=layer_id,
            xp_ref=f"assets/sprites/test_{slot}.xp",
            region=Region(x=0, y=0, w=8, h=8),
        )
        for slot, layer_id in layers
    ]
    return ActorVisualProfile(
        profile_id=profile_id,
        skin_definition_id=100,
        presentation_kind="idle_walk",
        domain="skin",
        layers=layer_objs,
        variation="default",
        rig_definition_id=rig_id,
    )


def _make_compiled_bundle_with_rig_contracts(rig_contracts: list) -> dict:
    """Create a minimal COMPILED bundle structure with rig_contracts."""
    return {
        "bundle_slug": "test_bundle",
        "catalog": {
            "presentation_kinds": [{"id": 600, "slug": "idle_walk"}],
            "skin_definitions": [{"id": 100, "slug": "human"}],
            "layer_definitions": [
                {"id": 700, "slug": "body"},
                {"id": 701, "slug": "weapon"},
                {"id": 702, "slug": "armor"},
                {"id": 760, "slug": "mount_rear"},
                {"id": 762, "slug": "mount_front"},
            ],
        },
        "rig_contracts": rig_contracts,
    }


def _make_id_maps() -> dict:
    """Create basic id_maps for testing."""
    return {
        "presentation_kinds": {"idle_walk": 600},
        "skin_definitions": {"human": 100},
        "layer_definitions": {
            "body": 700,
            "weapon": 701,
            "armor": 702,
            "mount_rear": 760,
            "mount_front": 762,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# TEST 1: Null rig → zero offsets, no error
# ─────────────────────────────────────────────────────────────────────────────
def test_null_rig_definition_id_produces_zero_offsets():
    """Feature: Profile with rig_definition_id=null gets zero offsets for all layers."""
    rig_contracts = {}  # Empty - no rig contracts
    
    profile = _make_profile(
        profile_id="test_null_rig",
        rig_id=None,
        layers=[("body", 700), ("weapon", 701)],
    )
    
    id_maps = _make_id_maps()
    row = compile_render_plan_row(profile, id_maps, rig_contracts)
    
    # Verify: ALL layers must have zero offsets
    for i, layer in enumerate(row.ordered_layers):
        assert layer["offset_by_angle"] == [[0, 0]] * 8, \
            f"Layer {i} ({layer['slot']}) should have zero offsets, got {layer['offset_by_angle']}"
        assert layer["visible_at_angles"] == [True] * 8, \
            f"Layer {i} ({layer['slot']}) should be visible at all angles"


# ─────────────────────────────────────────────────────────────────────────────
# TEST 2: Missing rig → FAIL HARD with ValueError naming profile and rig
# ─────────────────────────────────────────────────────────────────────────────
def test_missing_rig_contract_fails_hard_with_profile_id():
    """Feature: Profile with rig_definition_id that doesn't exist → ValueError with BOTH IDs."""
    rig_contracts = {}  # Empty - no rig contracts
    
    profile = _make_profile(
        profile_id="my_test_profile_needs_rig",
        rig_id="nonexistent_rig_xyz",
        layers=[("body", 700)],
    )
    
    id_maps = _make_id_maps()
    
    try:
        compile_render_plan_row(profile, id_maps, rig_contracts)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        error_msg = str(e)
        # Must name the missing rig
        assert "nonexistent_rig_xyz" in error_msg, \
            f"Error must name the missing rig, got: {error_msg}"
        # Must name the profile that needs it
        assert "my_test_profile_needs_rig" in error_msg, \
            f"Error must name the profile, got: {error_msg}"


# ─────────────────────────────────────────────────────────────────────────────
# TEST 3: angle_range visibility → visible_at_angles is angle-masked
# ─────────────────────────────────────────────────────────────────────────────
def test_angle_range_visibility_produces_masked_visible_at_angles():
    """Feature: Socket with visibility='angle_range' and visible_angles=[0,1,2] → [T,T,T,F,F,F,F,F]."""
    # Create a test rig contract with angle_range visibility
    test_contract = {
        "rig_definition_id": "test_angle_range",
        "version": 1,
        "layer_order": ["mount_rear_occlusion", "body", "weapon_grip"],
        "sockets": {
            "body": {
                "visibility": "angle_range",
                "visible_angles": [0, 1, 2],
                "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(8)],
            },
            "mount_rear_occlusion": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(8)],
            },
            "weapon_grip": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(8)],
            },
            "mount_saddle": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(8)],
            },
            "mount_front_occlusion": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": 0, "dy": 0} for i in range(8)],
            },
        },
    }
    
    profile = _make_profile(
        profile_id="test_angle_range",
        rig_id="test_angle_range",
        layers=[
            ("mount_rear", 760),
            ("body", 700),
            ("weapon", 701),
        ],
    )
    
    id_maps = _make_id_maps()
    rig_contracts = {"test_angle_range": test_contract}
    row = compile_render_plan_row(profile, id_maps, rig_contracts)
    
    # Layer 0: mount_rear_occlusion → always → all True
    assert row.ordered_layers[0]["visible_at_angles"] == [True] * 8
    
    # Layer 1: body → angle_range [0,1,2] → [T,T,T,F,F,F,F,F]
    body_layer = row.ordered_layers[1]
    assert body_layer["visible_at_angles"] == [True, True, True, False, False, False, False, False], \
        f"Body layer visible_at_angles should be [T,T,T,F,F,F,F,F], got {body_layer['visible_at_angles']}"
    
    # Layer 2: weapon_grip → always → all True
    assert row.ordered_layers[2]["visible_at_angles"] == [True] * 8


# ─────────────────────────────────────────────────────────────────────────────
# TEST 4: compile_render_plan_table loads rig_contracts from bundle
# ─────────────────────────────────────────────────────────────────────────────
def test_compile_render_plan_table_loads_rig_contracts_from_bundle():
    """Feature: compile_render_plan_table() extracts rig_contracts from bundle and passes to row compiler."""
    # Create a test rig contract
    test_contract = {
        "rig_definition_id": "test_rig",
        "version": 1,
        "layer_order": ["body"],
        "sockets": {
            "body": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": i, "dy": 0} for i in range(8)],
            },
            "mount_rear_occlusion": {"visibility": "always", "angle_offsets": []},
            "weapon_grip": {"visibility": "always", "angle_offsets": []},
            "mount_saddle": {"visibility": "always", "angle_offsets": []},
            "mount_front_occlusion": {"visibility": "always", "angle_offsets": []},
        },
    }
    
    bundle = _make_compiled_bundle_with_rig_contracts([test_contract])
    
    # Create a test profile directory
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        profile = _make_profile(
            profile_id="table_test_profile",
            rig_id="test_rig",
            layers=[("body", 700)],
        )
        profile.to_file(tmp_path / "table_test_profile.json")
        
        # Compile the table
        table = compile_render_plan_table(bundle, tmp_path)
        
        # Verify output structure
        assert "render_plans" in table
        assert len(table["render_plans"]) == 1
        
        render_plan = table["render_plans"][0]
        assert "ordered_layers" in render_plan
        assert len(render_plan["ordered_layers"]) == 1
        
        # Verify layer has the new fields
        layer = render_plan["ordered_layers"][0]
        assert "offset_by_angle" in layer, "Layer should have offset_by_angle field"
        assert "visible_at_angles" in layer, "Layer should have visible_at_angles field"
        assert len(layer["offset_by_angle"]) == 8, "offset_by_angle should have 8 entries"
        assert len(layer["visible_at_angles"]) == 8, "visible_at_angles should have 8 entries"


# ─────────────────────────────────────────────────────────────────────────────
# TEST 5: Layer count mismatch → extra layers get zero offsets + warning
# ─────────────────────────────────────────────────────────────────────────────
def test_extra_layers_beyond_layer_order_get_zero_offsets_with_warning():
    """Feature: Profile with more layers than layer_order → extra layers get zero offsets + warning."""
    test_contract = {
        "rig_definition_id": "test_short_layer_order",
        "version": 1,
        "layer_order": ["body"],  # Only 1 layer in contract
        "sockets": {
            "body": {
                "visibility": "always",
                "angle_offsets": [{"angle": i, "dx": i, "dy": 0} for i in range(8)],
            },
            "mount_rear_occlusion": {"visibility": "always", "angle_offsets": []},
            "weapon_grip": {"visibility": "always", "angle_offsets": []},
            "mount_saddle": {"visibility": "always", "angle_offsets": []},
            "mount_front_occlusion": {"visibility": "always", "angle_offsets": []},
        },
    }
    
    # Profile has 3 layers, contract only has 1 in layer_order
    profile = _make_profile(
        profile_id="test_extra_layers",
        rig_id="test_short_layer_order",
        layers=[
            ("body", 700),    # layer 0 → assigned to body socket
            ("weapon", 701),  # layer 1 → NOT in layer_order → zero offsets
            ("armor", 702),   # layer 2 → NOT in layer_order → zero offsets
        ],
    )
    
    id_maps = _make_id_maps()
    rig_contracts = {"test_short_layer_order": test_contract}
    
    import io
    log_capture = io.StringIO()
    handler = logging.StreamHandler(log_capture)
    logger = logging.getLogger("render_plan_table")
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    
    row = compile_render_plan_row(profile, id_maps, rig_contracts)
    
    logger.removeHandler(handler)
    log_output = log_capture.getvalue()
    
    # Layer 0: body socket → has offsets
    assert row.ordered_layers[0]["offset_by_angle"] == [[i, 0] for i in range(8)]
    
    # Layers 1, 2: NOT in layer_order → zero offsets
    for i in [1, 2]:
        assert row.ordered_layers[i]["offset_by_angle"] == [[0, 0]] * 8, \
            f"Layer {i} should have zero offsets"
    
    # Should have warnings for unassigned layers
    assert "not assigned" in log_output.lower() or "layer_order" in log_output.lower(), \
        f"Should log warning about unassigned layers, got: {log_output}"


# ─────────────────────────────────────────────────────────────────────────────
# TEST 6: Bundle data audit — layer_order vs socket names
# ─────────────────────────────────────────────────────────────────────────────
def test_positive_bundle_rig_contract_structure():
    """AUDIT TEST: Verify the structure of wolfie_crossbow_v1 in positive.bundle.json.
    
    This test DOCUMENTS the actual data structure to identify any mismatches.
    """
    manifest = _load_positive_bundle_manifest()
    
    # rig_contracts is at top level in source manifest
    rig_contracts = manifest.get("rig_contracts", [])
    assert len(rig_contracts) > 0, "positive.bundle.json should have rig_contracts"
    
    contract = rig_contracts[0]
    assert contract["rig_definition_id"] == "wolfie_crossbow_v1"
    
    layer_order = contract["layer_order"]
    socket_names = set(contract["sockets"].keys())
    
    # Document the structure
    print(f"\n=== wolfie_crossbow_v1 structure ===")
    print(f"layer_order: {layer_order}")
    print(f"sockets: {sorted(socket_names)}")
    
    # Check for mismatches
    mismatches = []
    for idx, layer_name in enumerate(layer_order):
        if layer_name not in socket_names:
            mismatches.append(f"layer_order[{idx}]='{layer_name}' not in sockets")
    
    if mismatches:
        print(f"\n⚠️  MISMATCHES FOUND:")
        for m in mismatches:
            print(f"   {m}")
        print(f"\n   This means the compiler will NOT find matching sockets for these layers.")
        print(f"   Fix: Rename sockets to match layer_order entries, or vice versa.")
    
    # rider_pelvis should have the dx offsets [1,0,0,1,2,2,3,3]
    rider_pelvis = contract["sockets"]["rider_pelvis"]
    offsets = sorted(rider_pelvis["angle_offsets"], key=lambda e: e["angle"])
    dx_values = [o["dx"] for o in offsets]
    print(f"\nrider_pelvis dx by angle: {dx_values}")
    assert dx_values == [1, 0, 0, 1, 2, 2, 3, 3], f"Expected [1,0,0,1,2,2,3,3], got {dx_values}"
