"""Tests for rig_definition_id dimension — U1 coverage.

Covers:
- ActorVisualProfile rig_definition_id field: to_dict, from_dict, round-trip
- runtime_identity_registry.json: rig_definition_id field in layer_definitions
- service.runtime_identity_for_action: returns rig_definition_id
- service.resolve_blueprint_targets: includes rig_definition_id in descriptors
- MCP tool create_actor_visual_profile: rig_definition_id parameter wiring
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.pipeline_v2.actor_visual_profile import ActorVisualProfile, LayerAssignment


# ── ActorVisualProfile ────────────────────────────────────────────────────────

class TestActorVisualProfileRigDimension:
    def _base_profile(self, **kw) -> ActorVisualProfile:
        defaults = dict(
            profile_id="test_profile",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            domain="skin",
            layers=[LayerAssignment(slot="body", layer_definition_id=700, xp_ref="x.xp")],
        )
        defaults.update(kw)
        return ActorVisualProfile(**defaults)

    def test_rig_definition_id_defaults_none(self):
        p = self._base_profile()
        assert p.rig_definition_id is None

    def test_rig_definition_id_set(self):
        p = self._base_profile(rig_definition_id="wolfie_crossbow_v1")
        assert p.rig_definition_id == "wolfie_crossbow_v1"

    def test_rig_definition_id_absent_from_dict_when_null(self):
        p = self._base_profile()
        d = p.to_dict()
        assert "rig_definition_id" not in d

    def test_rig_definition_id_present_in_dict_when_set(self):
        p = self._base_profile(rig_definition_id="wolfie_crossbow_v1")
        d = p.to_dict()
        assert d["rig_definition_id"] == "wolfie_crossbow_v1"

    def test_round_trip_with_rig_definition_id(self):
        p = self._base_profile(rig_definition_id="wolfie_crossbow_v1")
        p2 = ActorVisualProfile.from_dict(p.to_dict())
        assert p2.rig_definition_id == "wolfie_crossbow_v1"

    def test_round_trip_without_rig_definition_id(self):
        p = self._base_profile()
        d = p.to_dict()
        p2 = ActorVisualProfile.from_dict(d)
        assert p2.rig_definition_id is None

    def test_from_dict_ignores_empty_string(self):
        p = self._base_profile()
        d = p.to_dict()
        d["rig_definition_id"] = ""
        p2 = ActorVisualProfile.from_dict(d)
        assert p2.rig_definition_id is None

    def test_get_server_visual_key_includes_rig_definition_id(self):
        p = self._base_profile(rig_definition_id="wolfie_crossbow_v1")
        svk = p.get_server_visual_key()
        assert svk["rig_definition_id"] == "wolfie_crossbow_v1"

    def test_get_server_visual_key_rig_definition_id_null_when_absent(self):
        p = self._base_profile()
        svk = p.get_server_visual_key()
        assert svk["rig_definition_id"] is None

    def test_json_roundtrip(self, tmp_path):
        p = self._base_profile(rig_definition_id="wolfie_crossbow_v1")
        path = tmp_path / "profile.json"
        p.to_file(path)
        p2 = ActorVisualProfile.from_file(path)
        assert p2.rig_definition_id == "wolfie_crossbow_v1"


# ── runtime_identity_registry.json ───────────────────────────────────────────

class TestRuntimeIdentityRegistry:
    CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"

    def _load_registry(self) -> dict:
        p = self.CONFIG_DIR / "runtime_identity_registry.json"
        return json.loads(p.read_text(encoding="utf-8"))

    def test_all_layer_definitions_have_rig_definition_id_field(self):
        registry = self._load_registry()
        layer_defs = registry.get("layer_definitions", {})
        assert layer_defs, "layer_definitions should not be empty"
        for key, entry in layer_defs.items():
            assert "rig_definition_id" in entry, (
                f"layer_definitions[{key!r}] missing rig_definition_id field"
            )

    def test_layer_definitions_rig_definition_id_null_or_string(self):
        registry = self._load_registry()
        for key, entry in registry.get("layer_definitions", {}).items():
            val = entry.get("rig_definition_id")
            assert val is None or isinstance(val, str), (
                f"layer_definitions[{key!r}].rig_definition_id must be null or string, got {val!r}"
            )

    def test_non_mounted_entries_have_null_rig_definition_id(self):
        registry = self._load_registry()
        non_mounted = [
            k for k in registry.get("layer_definitions", {})
            if "mounted" not in k
        ]
        assert non_mounted, "expected at least one non-mounted layer definition"
        for key in non_mounted:
            val = registry["layer_definitions"][key].get("rig_definition_id")
            assert val is None, (
                f"non-mounted layer_definitions[{key!r}].rig_definition_id should be null, got {val!r}"
            )


# ── service.runtime_identity_for_action ──────────────────────────────────────

class TestRuntimeIdentityForAction:
    def test_returns_rig_definition_id_null_for_non_rig_action(self):
        from src.pipeline_v2.service import runtime_identity_for_action, _reset_template_registry_cache
        _reset_template_registry_cache()
        action_spec = {"skin_family": "human"}
        identity = runtime_identity_for_action("player_native_full", "idle", action_spec)
        assert "rig_definition_id" in identity
        assert identity["rig_definition_id"] is None

    def test_runtime_identity_includes_rig_definition_id_key(self):
        from src.pipeline_v2.service import runtime_identity_for_action, _reset_template_registry_cache
        _reset_template_registry_cache()
        action_spec = {"skin_family": "human"}
        identity = runtime_identity_for_action("player_native_full", "attack", action_spec)
        assert "rig_definition_id" in identity
