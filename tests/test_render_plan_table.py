"""Tests for RenderPlanTable compiler."""

import json
import sys
import tempfile
from pathlib import Path

import pytest

# Add pipeline-v3 and Y9-2 to path for imports
PIPELINE_V3_ROOT = Path(__file__).resolve().parents[2] / "asciicker-pipeline-v3"
Y9_2_ROOT = Path(__file__).resolve().parents[2] / "asciicker-Y9-2"
Y9_2_SCRIPTS = Y9_2_ROOT / "scripts"
Y9_2_PIPELINE = Y9_2_SCRIPTS / "pipeline"

if str(PIPELINE_V3_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3_ROOT))
if str(Y9_2_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(Y9_2_SCRIPTS))
if str(Y9_2_PIPELINE) not in sys.path:
    sys.path.insert(0, str(Y9_2_PIPELINE))

# Import render_plan_table from Y9-2 scripts.pipeline
from render_plan_table import (
    COMPILER_VERSION,
    RENDER_PLAN_SCHEMA_VERSION,
    ServerVisualKey,
    RenderPlanRow,
    load_actor_profiles,
    load_id_maps,
    compile_render_plan_row,
    compile_render_plan_table,
    write_render_plan_table,
    verify_render_plan_table,
)
from src.pipeline_v2.actor_visual_profile import (
    ActorVisualProfile,
    LayerAssignment,
    MountComposition,
    Region,
)


@pytest.fixture
def sample_bundle():
    """Sample compiled appearance_bundle.json for testing."""
    return {
        "bundle_slug": "positive",
        "catalog": {
            "presentation_kinds": [
                {"id": 600, "slug": "idle_walk"},
                {"id": 601, "slug": "attack"},
                {"id": 602, "slug": "plydie"},
            ],
            "skin_definitions": [
                {"id": 100, "slug": "human"},
            ],
            "layer_definitions": [
                {"id": 700, "slug": "player_native_idle_only:idle"},
                {"id": 701, "slug": "player_native_full:attack"},
                {"id": 750, "slug": "weapon_crossbow"},
                {"id": 760, "slug": "wolf_mounted_rear"},
                {"id": 761, "slug": "wolf_mounted_rider"},
                {"id": 762, "slug": "wolf_mounted_front"},
            ],
            "item_definitions": [
                {"id": 2001, "slug": "crossbow"},
            ],
            "mount_definitions": [
                {"id": 300, "slug": "wolf"},
            ],
        },
    }


@pytest.fixture
def sample_profiles_dir(tmp_path):
    """Create temporary directory with sample ActorVisualProfile files."""
    # Profile 1: Human idle
    profile1 = ActorVisualProfile(
        profile_id="human_idle_default",
        skin_definition_id=100,
        presentation_kind="idle_walk",
        domain="skin",
        layers=[
            LayerAssignment(
                slot="body",
                layer_definition_id=700,
                xp_ref="assets/sprites/player_native_idle_only.xp",
                region=Region(x=0, y=0, w=8, h=8),
            )
        ],
        variation="default",
    )
    profile1.to_file(tmp_path / "01-human-idle-default.json")
    
    # Profile 2: Human attack with crossbow
    profile2 = ActorVisualProfile(
        profile_id="human_attack_crossbow",
        skin_definition_id=100,
        presentation_kind="attack",
        domain="skin",
        layers=[
            LayerAssignment(
                slot="body",
                layer_definition_id=701,
                xp_ref="assets/sprites/player_native_full.xp",
                region=Region(x=0, y=8, w=8, h=8),
            ),
            LayerAssignment(
                slot="weapon",
                layer_definition_id=750,
                xp_ref="assets/sprites/player_native_full.xp",
                item_definition_id=2001,
                region=Region(x=8, y=8, w=8, h=8),
            ),
        ],
        variation="crossbow_attack",
    )
    profile2.to_file(tmp_path / "02-human-attack-crossbow.json")
    
    # Profile 3: Wolf mounted idle
    profile3 = ActorVisualProfile(
        profile_id="wolf_mounted_idle",
        skin_definition_id=100,
        presentation_kind="idle_walk",
        domain="mount",
        layers=[
            LayerAssignment(
                slot="mount_rear",
                layer_definition_id=760,
                xp_ref="assets/sprites/mounted_native_full.xp",
                region=Region(x=0, y=0, w=16, h=8),
            ),
            LayerAssignment(
                slot="mount_rider",
                layer_definition_id=761,
                xp_ref="assets/sprites/mounted_native_full.xp",
                region=Region(x=16, y=0, w=8, h=8),
            ),
            LayerAssignment(
                slot="mount_front",
                layer_definition_id=762,
                xp_ref="assets/sprites/mounted_native_full.xp",
                item_definition_id=2001,
                region=Region(x=24, y=0, w=8, h=8),
            ),
        ],
        mount_composition=MountComposition(
            mount_definition_id=300,
            rear_layer_index=0,
            rider_layer_index=1,
            front_layer_index=2,
        ),
    )
    profile3.to_file(tmp_path / "03-wolf-mounted-idle.json")
    
    return tmp_path


class TestServerVisualKey:
    """Test ServerVisualKey dataclass."""

    def test_to_dict(self):
        key = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="crossbow_attack",
            slot_state={"body": 701, "weapon": 2001},
            mount_state={"is_mounted": False},
        )
        d = key.to_dict()
        assert d["skin_definition_id"] == 100
        assert d["presentation_kind_id"] == 601
        assert d["variation"] == "crossbow_attack"
        assert d["slot_state"]["weapon"] == 2001
        assert d["mount_state"]["is_mounted"] is False

    def test_canonical_key_deterministic(self):
        key1 = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="crossbow_attack",
            slot_state={"body": 701, "weapon": 2001},
            mount_state={"is_mounted": False},
        )
        key2 = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="crossbow_attack",
            slot_state={"body": 701, "weapon": 2001},
            mount_state={"is_mounted": False},
        )
        assert key1.canonical_key() == key2.canonical_key()

    def test_canonical_key_different_for_different_keys(self):
        key1 = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="default",
            slot_state={"body": 701},
            mount_state={"is_mounted": False},
        )
        key2 = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="crossbow_attack",
            slot_state={"body": 701},
            mount_state={"is_mounted": False},
        )
        assert key1.canonical_key() != key2.canonical_key()

    def test_from_profile_basic(self, sample_bundle):
        profile = ActorVisualProfile(
            profile_id="test_profile",
            skin_definition_id=100,
            presentation_kind="attack",
            domain="skin",
            layers=[
                LayerAssignment(slot="body", layer_definition_id=701, xp_ref="p.xp"),
                LayerAssignment(
                    slot="weapon",
                    layer_definition_id=750,
                    xp_ref="w.xp",
                    item_definition_id=2001,
                ),
            ],
            variation="crossbow_attack",
        )
        id_maps = load_id_maps(sample_bundle)
        key = ServerVisualKey.from_profile(profile, id_maps)
        
        assert key.skin_definition_id == 100
        assert key.presentation_kind_id == 601  # attack -> 601
        assert key.variation == "crossbow_attack"
        assert key.slot_state["body"] == 701
        assert key.slot_state["weapon"] == 2001
        assert key.mount_state["is_mounted"] is False

    def test_from_profile_mounted(self, sample_bundle):
        profile = ActorVisualProfile(
            profile_id="wolf_mounted",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            domain="mount",
            layers=[
                LayerAssignment(slot="mount_rear", layer_definition_id=760, xp_ref="m.xp"),
                LayerAssignment(slot="mount_rider", layer_definition_id=761, xp_ref="m.xp"),
            ],
            mount_composition=MountComposition(
                mount_definition_id=300,
                rear_layer_index=0,
                rider_layer_index=1,
            ),
        )
        id_maps = load_id_maps(sample_bundle)
        key = ServerVisualKey.from_profile(profile, id_maps)
        
        assert key.mount_state["is_mounted"] is True
        assert key.mount_state["mount_definition_id"] == 300


class TestRenderPlanRow:
    """Test RenderPlanRow dataclass."""

    def test_to_dict(self):
        key = ServerVisualKey(
            skin_definition_id=100,
            presentation_kind_id=601,
            variation="default",
            slot_state={"body": 701},
            mount_state={"is_mounted": False},
        )
        row = RenderPlanRow(
            server_visual_key=key,
            ordered_layers=[
                {"slot": "body", "layer_definition_id": 701, "xp_ref": "p.xp"}
            ],
            profile_id="test_profile",
            render_order=[0],
        )
        d = row.to_dict()
        assert d["server_visual_key"]["skin_definition_id"] == 100
        assert len(d["ordered_layers"]) == 1
        assert d["profile_id"] == "test_profile"
        assert d["render_order"] == [0]


class TestLoadIdMaps:
    """Test load_id_maps function."""

    def test_extract_all_maps(self, sample_bundle):
        id_maps = load_id_maps(sample_bundle)
        
        assert "presentation_kinds" in id_maps
        assert "skin_definitions" in id_maps
        assert "layer_definitions" in id_maps
        assert "item_definitions" in id_maps
        assert "mount_definitions" in id_maps
        
        assert id_maps["presentation_kinds"]["idle_walk"] == 600
        assert id_maps["presentation_kinds"]["attack"] == 601
        assert id_maps["skin_definitions"]["human"] == 100
        assert id_maps["item_definitions"]["crossbow"] == 2001


class TestCompileRenderPlanRow:
    """Test compile_render_plan_row function."""

    def test_compile_simple_profile(self, sample_bundle):
        profile = ActorVisualProfile(
            profile_id="human_idle",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            domain="skin",
            layers=[
                LayerAssignment(
                    slot="body",
                    layer_definition_id=700,
                    xp_ref="player.xp",
                    region=Region(x=0, y=0, w=8, h=8),
                )
            ],
        )
        id_maps = load_id_maps(sample_bundle)
        row = compile_render_plan_row(profile, id_maps)
        
        assert row.profile_id == "human_idle"
        assert row.server_visual_key.skin_definition_id == 100
        assert row.server_visual_key.presentation_kind_id == 600
        assert len(row.ordered_layers) == 1
        assert row.ordered_layers[0]["slot"] == "body"
        assert row.ordered_layers[0]["region"]["x"] == 0
        assert row.render_order == [0]

    def test_compile_profile_with_region(self, sample_bundle):
        profile = ActorVisualProfile(
            profile_id="armed_human",
            skin_definition_id=100,
            presentation_kind="attack",
            domain="skin",
            layers=[
                LayerAssignment(slot="body", layer_definition_id=701, xp_ref="p.xp"),
                LayerAssignment(
                    slot="weapon",
                    layer_definition_id=750,
                    xp_ref="w.xp",
                    item_definition_id=2001,
                    region=Region(x=8, y=8, w=8, h=8),
                ),
            ],
            variation="crossbow_attack",
        )
        id_maps = load_id_maps(sample_bundle)
        row = compile_render_plan_row(profile, id_maps)
        
        assert len(row.ordered_layers) == 2
        assert row.ordered_layers[1]["item_definition_id"] == 2001
        assert row.ordered_layers[1]["region"]["x"] == 8


class TestCompileRenderPlanTable:
    """Test compile_render_plan_table function."""

    def test_compile_table(self, sample_bundle, sample_profiles_dir):
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        
        assert table["schema_version"] == RENDER_PLAN_SCHEMA_VERSION
        assert table["generated_by"] == COMPILER_VERSION
        assert table["bundle_slug"] == "positive"
        assert len(table["render_plans"]) == 3
        assert table["profile_count"] == 3
        assert table["key_space_coverage"]["total_keys"] == 3
        assert table["key_space_coverage"]["covered_keys"] == 3

    def test_compile_table_includes_all_profiles(self, sample_bundle, sample_profiles_dir):
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        
        profile_ids = {row["profile_id"] for row in table["render_plans"]}
        assert "human_idle_default" in profile_ids
        assert "human_attack_crossbow" in profile_ids
        assert "wolf_mounted_idle" in profile_ids

    def test_compile_table_mounted_profile(self, sample_bundle, sample_profiles_dir):
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        
        mounted_row = next(
            row for row in table["render_plans"]
            if row["profile_id"] == "wolf_mounted_idle"
        )
        
        assert mounted_row["server_visual_key"]["mount_state"]["is_mounted"] is True
        assert len(mounted_row["ordered_layers"]) == 3
        assert mounted_row["ordered_layers"][0]["slot"] == "mount_rear"
        assert mounted_row["ordered_layers"][1]["slot"] == "mount_rider"
        assert mounted_row["ordered_layers"][2]["slot"] == "mount_front"


class TestWriteRenderPlanTable:
    """Test write_render_plan_table function."""

    def test_write_file(self, sample_bundle, sample_profiles_dir, tmp_path):
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        write_render_plan_table(table, tmp_path)
        
        output_path = tmp_path / "render_plans.json"
        assert output_path.exists()
        
        # Verify content
        loaded = json.loads(output_path.read_text(encoding="utf-8"))
        assert loaded["schema_version"] == RENDER_PLAN_SCHEMA_VERSION
        assert len(loaded["render_plans"]) == 3


class TestVerifyRenderPlanTable:
    """Test verify_render_plan_table function."""

    def test_verify_passes(self, sample_bundle, sample_profiles_dir, tmp_path):
        # Compile and write
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        write_render_plan_table(table, tmp_path)
        
        # Verify
        mismatches = verify_render_plan_table(tmp_path, sample_bundle, sample_profiles_dir)
        assert len(mismatches) == 0

    def test_verify_fails_missing_file(self, sample_bundle, sample_profiles_dir, tmp_path):
        # Don't write file
        mismatches = verify_render_plan_table(tmp_path, sample_bundle, sample_profiles_dir)
        assert len(mismatches) == 1
        assert "render_plans.json not found" in mismatches[0]

    def test_verify_fails_stale_content(self, sample_bundle, sample_profiles_dir, tmp_path):
        # Write stale content
        stale_table = {
            "schema_version": 1,
            "render_plans": [],
            "profile_count": 0,
        }
        write_render_plan_table(stale_table, tmp_path)
        
        # Verify should detect mismatch
        mismatches = verify_render_plan_table(tmp_path, sample_bundle, sample_profiles_dir)
        assert len(mismatches) > 0


class TestIntegration:
    """Integration tests for complete RenderPlanTable workflow."""

    def test_full_compile_workflow(self, sample_bundle, sample_profiles_dir, tmp_path):
        """Test complete compile -> write -> verify workflow."""
        # Compile
        table = compile_render_plan_table(sample_bundle, sample_profiles_dir)
        
        # Write
        write_render_plan_table(table, tmp_path)
        
        # Verify
        mismatches = verify_render_plan_table(tmp_path, sample_bundle, sample_profiles_dir)
        assert len(mismatches) == 0
        
        # Load and inspect
        output_path = tmp_path / "render_plans.json"
        loaded = json.loads(output_path.read_text(encoding="utf-8"))
        
        assert loaded["schema_version"] == 1
        assert loaded["bundle_slug"] == "positive"
        assert len(loaded["render_plans"]) == 3
        
        # Check specific rows
        human_crossbow = next(
            row for row in loaded["render_plans"]
            if row["profile_id"] == "human_attack_crossbow"
        )
        assert human_crossbow["server_visual_key"]["variation"] == "crossbow_attack"
        assert len(human_crossbow["ordered_layers"]) == 2
        assert human_crossbow["ordered_layers"][1]["slot"] == "weapon"

    def test_no_duplicate_keys(self, sample_bundle, sample_profiles_dir):
        """Test that duplicate profiles raise error."""
        # Create duplicate profile
        duplicate_dir = sample_profiles_dir / "duplicates"
        duplicate_dir.mkdir()
        
        # Copy profile twice with different names
        profile = ActorVisualProfile(
            profile_id="duplicate_test",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            domain="skin",
            layers=[LayerAssignment(slot="body", layer_definition_id=700, xp_ref="x.xp")],
        )
        profile.to_file(duplicate_dir / "copy1.json")
        profile.to_file(duplicate_dir / "copy2.json")
        
        # Should raise ValueError for duplicate key
        with pytest.raises(ValueError, match="Duplicate ServerVisualKey"):
            compile_render_plan_table(sample_bundle, duplicate_dir)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
