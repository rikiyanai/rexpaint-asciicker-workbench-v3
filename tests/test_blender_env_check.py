#!/usr/bin/env python3
"""Tests for U6b: Blender environment bootstrap.

Test scenarios:
- parse_blender_version parses version strings correctly
- version_is_ok compares versions correctly
- Integration test: subprocess.run blender_env_check.py returns valid JSON
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Load blender_env_check via direct file path to avoid polluting the 'scripts'
# namespace package (which would shadow Y9-2's scripts.pipeline in other tests).
REPO_ROOT = Path(__file__).resolve().parents[1]
_bec_spec = importlib.util.spec_from_file_location(
    "blender_env_check", REPO_ROOT / "scripts" / "blender_env_check.py"
)
_bec = importlib.util.module_from_spec(_bec_spec)
_bec_spec.loader.exec_module(_bec)
detect_blender = _bec.detect_blender
parse_blender_version = _bec.parse_blender_version
version_is_ok = _bec.version_is_ok


class TestParseBlenderVersion:
    """Test parse_blender_version() function."""

    def test_parse_blender_version_4_1_0(self):
        """parse_blender_version("Blender 4.1.0 (hash123 2024-01-01)") == "4.1.0"."""
        output = "Blender 4.1.0 (hash123 2024-01-01)"
        assert parse_blender_version(output) == "4.1.0"

    def test_parse_blender_version_2_93_5(self):
        """parse_blender_version("Blender 2.93.5 ...") == "2.93.5"."""
        output = "Blender 2.93.5 (master 2021-01-01)"
        assert parse_blender_version(output) == "2.93.5"

    def test_parse_blender_version_garbage(self):
        """parse_blender_version("garbage") is None."""
        output = "garbage"
        assert parse_blender_version(output) is None

    def test_parse_blender_version_empty(self):
        """parse_blender_version("") is None."""
        assert parse_blender_version("") is None

    def test_parse_blender_version_multiline(self):
        """parse_blender_version handles multiline output."""
        output = """Blender 3.6.5 (master 2023-10-01)
        Build date: 2023-10-01
        Some other info"""
        assert parse_blender_version(output) == "3.6.5"


class TestVersionIsOk:
    """Test version_is_ok() function."""

    def test_version_is_ok_4_1_0(self):
        """version_is_ok("4.1.0") is True."""
        assert version_is_ok("4.1.0") is True

    def test_version_is_ok_2_93_0(self):
        """version_is_ok("2.93.0") is False."""
        assert version_is_ok("2.93.0") is False

    def test_version_is_ok_3_0_0_exact(self):
        """version_is_ok("3.0.0") is True (exact min OK)."""
        assert version_is_ok("3.0.0") is True

    def test_version_is_ok_3_0_1(self):
        """version_is_ok("3.0.1") is True."""
        assert version_is_ok("3.0.1") is True

    def test_version_is_ok_3_1_0(self):
        """version_is_ok("3.1.0") is True."""
        assert version_is_ok("3.1.0") is True

    def test_version_is_ok_2_99_9(self):
        """version_is_ok("2.99.9") is False."""
        assert version_is_ok("2.99.9") is False

    def test_version_is_ok_custom_min(self):
        """version_is_ok with custom min_version."""
        assert version_is_ok("4.0.0", min_version="4.0.0") is True
        assert version_is_ok("3.9.0", min_version="4.0.0") is False


class TestBlenderEnvCheckIntegration:
    """Integration tests for blender_env_check.py script."""

    def test_blender_env_check_subprocess(self):
        """Integration: subprocess.run(["python3", "scripts/blender_env_check.py"], ...) →
        JSON with keys {available, version_ok}. (Run regardless; blender is available on this host.)"""
        script_path = REPO_ROOT / "scripts" / "blender_env_check.py"
        
        result = subprocess.run(
            ["python3", str(script_path)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        # Should exit 0
        assert result.returncode == 0, f"blender_env_check.py should exit 0; stderr: {result.stderr}"
        
        # Should output valid JSON
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            pytest.fail(f"blender_env_check.py output is not valid JSON: {e}\nstdout: {result.stdout}")
        
        # Should have required keys
        assert "available" in data, "Output should have 'available' key"
        assert "version_ok" in data, "Output should have 'version_ok' key"
        assert isinstance(data["available"], bool), "'available' should be a boolean"
        assert isinstance(data["version_ok"], bool), "'version_ok' should be a boolean"

    def test_blender_env_check_available_has_version(self):
        """If available=True: version_ok is bool, version is a string like "X.Y.Z"."""
        script_path = REPO_ROOT / "scripts" / "blender_env_check.py"
        
        result = subprocess.run(
            ["python3", str(script_path)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        data = json.loads(result.stdout)
        
        if data["available"]:
            # Should have version string
            assert "version" in data, "Should have 'version' key when available=True"
            if data["version"] is not None:
                assert isinstance(data["version"], str), "'version' should be a string"
                # Should look like "X.Y.Z"
                import re
                assert re.match(r'\d+\.\d+\.\d+', data["version"]), \
                    f"version should be like 'X.Y.Z', got: {data['version']}"

    def test_blender_env_check_available_ok_no_error(self):
        """If available=True and version_ok=True: no "error" key in output (or error is absent/None)."""
        script_path = REPO_ROOT / "scripts" / "blender_env_check.py"
        
        result = subprocess.run(
            ["python3", str(script_path)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        data = json.loads(result.stdout)
        
        if data["available"] and data["version_ok"]:
            # Should not have error key, or it should be None
            error = data.get("error")
            assert error is None, f"Should not have error when version_ok=True; got: {error}"


class TestDetectBlender:
    """Unit tests for detect_blender() function."""

    def test_detect_blender_returns_dict(self):
        """detect_blender() returns a dict with required keys."""
        result = detect_blender()
        
        assert isinstance(result, dict), "detect_blender() should return a dict"
        assert "available" in result, "Should have 'available' key"
        assert "version_ok" in result, "Should have 'version_ok' key"

    def test_detect_blender_available_type(self):
        """detect_blender()['available'] is a boolean."""
        result = detect_blender()
        assert isinstance(result["available"], bool)

    def test_detect_blender_version_ok_type(self):
        """detect_blender()['version_ok'] is a boolean."""
        result = detect_blender()
        assert isinstance(result["version_ok"], bool)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
