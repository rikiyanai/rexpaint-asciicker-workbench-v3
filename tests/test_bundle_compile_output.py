#!/usr/bin/env python3
"""Tests for FL-3866 U5: render_plans.json integration into compile + verify.

Test scenarios:
- After compile_bundle() + write_bundle_outputs(), render_plans.json exists in out_dir
- render_plans.json and appearance_bundle.json share the same bundle_hash
- verify_compiled_outputs() fails with clear error when render_plans.json is absent
- verify_compiled_outputs() fails when render_plans.json.bundle_hash != appearance_bundle.json.bundle_hash
- verify_compiled_outputs() passes when both files present and hashes match
- render_plans.json is valid JSON with schema_version, render_plans array, bundle_hash keys
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

# Append Y9-2 root so scripts.pipeline resolves to the vendored copy.
# Using append (not insert) keeps pipeline-v3's scripts/ first in the
# namespace package, preventing conflicts with pipeline-v3 modules.
_Y9_2_ROOT = Path(__file__).resolve().parents[1] / "asciicker-Y9-2"
if str(_Y9_2_ROOT) not in sys.path:
    sys.path.append(str(_Y9_2_ROOT))

# Import from Y9-2 pipeline
from scripts.pipeline.appearance_bundle import compile_bundle, write_bundle_outputs, verify_compiled_outputs
from scripts.pipeline.render_plan_table import write_render_plan_table, verify_render_plan_table

REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_SRC = REPO_ROOT / "asciicker-Y9-2" / "assets" / "appearance_bundle" / "phase2-fixtures" / "positive.bundle.json"
SPRITES_ROOT = REPO_ROOT / "asciicker-Y9-2" / "assets" / "sprites"


@pytest.fixture
def temp_out_dir():
    """Create a temporary output directory for bundle compilation."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def compiled_bundle(temp_out_dir):
    """Compile bundle and write outputs to temp directory."""
    bundle, ids_lock, compile_report = compile_bundle(BUNDLE_SRC, SPRITES_ROOT)
    write_bundle_outputs(temp_out_dir, bundle, ids_lock, compile_report)
    return bundle, ids_lock, compile_report, temp_out_dir


class TestRenderPlansOutputPresence:
    """Test that render_plans.json is emitted alongside appearance_bundle.json."""

    def test_render_plans_json_exists_after_compile(self, compiled_bundle):
        """After compile_bundle() + write_bundle_outputs(), render_plans.json exists in out_dir."""
        bundle, ids_lock, compile_report, out_dir = compiled_bundle
        
        # Check if actor profiles exist (they determine if render_plans.json is written)
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        render_plans_path = out_dir / "render_plans.json"
        
        if has_profiles:
            assert render_plans_path.exists(), "render_plans.json should exist when actor profiles are present"
        else:
            # No profiles = no render_plans.json written, but compile_report should note this
            assert compile_report.get("render_plan_table", {}).get("note") is not None


class TestBundleHashConsistency:
    """Test that render_plans.json and appearance_bundle.json share the same bundle_hash."""

    def test_render_plans_and_bundle_share_hash(self, compiled_bundle):
        """render_plans.json and appearance_bundle.json share the same bundle_hash."""
        bundle, ids_lock, compile_report, out_dir = compiled_bundle
        
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        if not has_profiles:
            pytest.skip("No actor profiles present; render_plans.json not written")
        
        # Load both files
        bundle_path = out_dir / "appearance_bundle.json"
        render_plans_path = out_dir / "render_plans.json"
        
        bundle_data = json.loads(bundle_path.read_text(encoding="utf-8"))
        render_plans_data = json.loads(render_plans_path.read_text(encoding="utf-8"))
        
        # Both should have bundle_hash
        assert "bundle_hash" in render_plans_data, "render_plans.json should have bundle_hash field"
        
        # Hashes should match
        expected_hash = compile_report.get("bundle_hash")
        assert render_plans_data["bundle_hash"] == expected_hash, \
            f"render_plans.json bundle_hash should match compile_report bundle_hash"


class TestVerifyCompiledOutputs:
    """Test verify_compiled_outputs() behavior with render_plans.json."""

    def test_verify_fails_when_render_plans_absent(self, temp_out_dir):
        """verify_compiled_outputs() fails with clear error when render_plans.json is absent."""
        # Compile bundle and write outputs
        bundle, ids_lock, compile_report = compile_bundle(BUNDLE_SRC, SPRITES_ROOT)
        write_bundle_outputs(temp_out_dir, bundle, ids_lock, compile_report)
        
        # Check if render_plans.json was written (depends on actor profiles presence)
        render_plans_path = temp_out_dir / "render_plans.json"
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        if not has_profiles:
            pytest.skip("No actor profiles present; render_plans.json not written, cannot test absence")
        
        # Manually remove render_plans.json
        if render_plans_path.exists():
            render_plans_path.unlink()
        
        # Verify should fail
        mismatches = verify_compiled_outputs(BUNDLE_SRC, SPRITES_ROOT, temp_out_dir)
        
        # Should have mismatch about render_plans.json
        render_plans_errors = [m for m in mismatches if "render_plans" in m.lower()]
        assert len(render_plans_errors) > 0, \
            f"verify_compiled_outputs should report render_plans.json missing; got: {mismatches}"

    def test_verify_fails_on_bundle_hash_mismatch(self, compiled_bundle):
        """verify_compiled_outputs() fails when render_plans.json.bundle_hash != appearance_bundle.json.bundle_hash."""
        bundle, ids_lock, compile_report, out_dir = compiled_bundle
        
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        if not has_profiles:
            pytest.skip("No actor profiles present; render_plans.json not written")
        
        # Corrupt the bundle_hash in render_plans.json
        render_plans_path = out_dir / "render_plans.json"
        render_plans_data = json.loads(render_plans_path.read_text(encoding="utf-8"))
        render_plans_data["bundle_hash"] = "corrupted_hash_12345"
        render_plans_path.write_text(json.dumps(render_plans_data, indent=2), encoding="utf-8")
        
        # Verify should fail
        mismatches = verify_compiled_outputs(BUNDLE_SRC, SPRITES_ROOT, out_dir)
        
        # Should have mismatch about bundle_hash
        hash_errors = [m for m in mismatches if "bundle_hash" in m.lower() and "render_plans" in m.lower()]
        assert len(hash_errors) > 0, \
            f"verify_compiled_outputs should report bundle_hash mismatch; got: {mismatches}"

    def test_verify_passes_when_hashes_match(self, compiled_bundle):
        """verify_compiled_outputs() passes when both files present and hashes match."""
        bundle, ids_lock, compile_report, out_dir = compiled_bundle
        
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        if not has_profiles:
            pytest.skip("No actor profiles present; render_plans.json not written")
        
        # Verify should pass
        mismatches = verify_compiled_outputs(BUNDLE_SRC, SPRITES_ROOT, out_dir)
        
        assert len(mismatches) == 0, \
            f"verify_compiled_outputs should pass when hashes match; got mismatches: {mismatches}"


class TestRenderPlansSchema:
    """Test render_plans.json schema structure."""

    def test_render_plans_has_required_keys(self, compiled_bundle):
        """render_plans.json is valid JSON with schema_version, render_plans array, bundle_hash keys."""
        bundle, ids_lock, compile_report, out_dir = compiled_bundle
        
        actor_profiles_dir = REPO_ROOT / "config" / "actor_visual_profiles"
        has_profiles = actor_profiles_dir.exists() and any(actor_profiles_dir.glob("*.json"))
        
        if not has_profiles:
            pytest.skip("No actor profiles present; render_plans.json not written")
        
        render_plans_path = out_dir / "render_plans.json"
        render_plans_data = json.loads(render_plans_path.read_text(encoding="utf-8"))
        
        # Check required keys
        assert "schema_version" in render_plans_data, "render_plans.json should have schema_version"
        assert "render_plans" in render_plans_data, "render_plans.json should have render_plans array"
        assert isinstance(render_plans_data["render_plans"], list), "render_plans should be an array"
        assert "bundle_hash" in render_plans_data, "render_plans.json should have bundle_hash"
        
        # Check schema_version is 1 (or whatever version is used)
        assert isinstance(render_plans_data["schema_version"], int), "schema_version should be an integer"


class TestRenderPlanTableFunctions:
    """Test render_plan_table.py functions directly."""

    def test_write_render_plan_table_accepts_bundle_hash(self, temp_out_dir):
        """write_render_plan_table() accepts bundle_hash param and embeds it."""
        # Create a minimal render plan table
        render_plan_table = {
            "schema_version": 1,
            "render_plans": [],
            "profile_count": 0,
        }
        
        # Write with bundle_hash
        test_hash = "test_bundle_hash_abc123"
        write_render_plan_table(render_plan_table, temp_out_dir, test_hash)
        
        # Read back and verify
        render_plans_path = temp_out_dir / "render_plans.json"
        render_plans_data = json.loads(render_plans_path.read_text(encoding="utf-8"))
        
        assert render_plans_data["bundle_hash"] == test_hash, \
            "write_render_plan_table should embed bundle_hash when provided"

    def test_verify_render_plan_table_checks_bundle_hash(self, temp_out_dir):
        """verify_render_plan_table() checks bundle_hash consistency."""
        # Create a minimal render plan table
        render_plan_table = {
            "schema_version": 1,
            "render_plans": [],
            "profile_count": 0,
            "bundle_hash": "correct_hash",
        }
        
        # Write with correct hash
        write_render_plan_table(render_plan_table, temp_out_dir, "correct_hash")
        
        # Create a fake actor profiles dir for verification
        fake_profiles_dir = temp_out_dir / "fake_profiles"
        fake_profiles_dir.mkdir()
        
        # Verify with matching hash should pass (but may fail on fresh compile if profiles are empty)
        bundle = {"catalog": {}, "bundle_slug": "test", "rig_contracts": []}
        mismatches = verify_render_plan_table(
            temp_out_dir, bundle, fake_profiles_dir, "correct_hash"
        )
        
        # Should not have bundle_hash mismatch error (may have other errors for empty profiles)
        hash_errors = [m for m in mismatches if "bundle_hash" in m.lower()]
        assert len(hash_errors) == 0, f"Should not have hash mismatch; got: {mismatches}"
        
        # Corrupt the bundle_hash and verify again
        render_plans_path = temp_out_dir / "render_plans.json"
        render_plans_data = json.loads(render_plans_path.read_text(encoding="utf-8"))
        render_plans_data["bundle_hash"] = "wrong_hash"
        render_plans_path.write_text(json.dumps(render_plans_data, indent=2), encoding="utf-8")
        
        # Verify with wrong hash should fail
        mismatches = verify_render_plan_table(
            temp_out_dir, bundle, fake_profiles_dir, "correct_hash"
        )
        
        hash_errors = [m for m in mismatches if "bundle_hash" in m.lower()]
        assert len(hash_errors) > 0, f"Should have hash mismatch error; got: {mismatches}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
