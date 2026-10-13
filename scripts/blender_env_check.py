#!/usr/bin/env python3
"""Detect Blender availability and version for rig authoring tools (U6b).

Outputs JSON to stdout always. Exit 0 always (caller decides on version_ok=false).

Success:  {"available": true, "blender_path": "/path/to/blender", "version": "4.1.0", "version_ok": true}
Missing:  {"available": false, "error": "blender not found in PATH", "version_ok": false}
Old ver:  {"available": true, "blender_path": "...", "version": "2.93.0", "version_ok": false,
           "error": "blender 2.93.0 < minimum 3.0.0"}
"""

import json
import re
import shutil
import subprocess
import sys
from typing import Optional


MIN_VERSION = "3.0.0"


def parse_blender_version(output: str) -> Optional[str]:
    """Parse Blender version string from --version output.
    
    Args:
        output: stdout from blender --version command
        
    Returns:
        Version string like "4.1.0" or None if not found
    """
    # First line typically contains "Blender X.Y.Z"
    first_line = output.split('\n')[0] if output else ""
    match = re.search(r'Blender\s+(\d+\.\d+\.\d+)', first_line)
    if match:
        return match.group(1)
    return None


def version_is_ok(version_str: str, min_version: str = MIN_VERSION) -> bool:
    """Check if Blender version meets minimum requirement.
    
    Args:
        version_str: Version string like "4.1.0"
        min_version: Minimum required version (default "3.0.0")
        
    Returns:
        True if version >= min_version
    """
    def parse_version_tuple(v: str):
        parts = v.split('.')
        return tuple(int(p) for p in parts[:3])
    
    try:
        version_tuple = parse_version_tuple(version_str)
        min_tuple = parse_version_tuple(min_version)
        return version_tuple >= min_tuple
    except (ValueError, IndexError):
        return False


def detect_blender() -> dict:
    """Detect Blender availability and version.
    
    Returns:
        Dict with keys: available, version_ok, and optionally blender_path, version, error
    """
    # Check if blender is in PATH
    blender_path = shutil.which("blender")
    
    if blender_path is None:
        return {
            "available": False,
            "error": "blender not found in PATH",
            "version_ok": False,
        }
    
    # Run blender --version
    try:
        result = subprocess.run(
            ["blender", "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        version_str = parse_blender_version(result.stdout)
        
        if version_str is None:
            return {
                "available": True,
                "blender_path": blender_path,
                "version": None,
                "version_ok": False,
                "error": f"could not parse version from output: {result.stdout[:200]}",
            }
        
        version_ok = version_is_ok(version_str)
        
        if not version_ok:
            return {
                "available": True,
                "blender_path": blender_path,
                "version": version_str,
                "version_ok": False,
                "error": f"blender {version_str} < minimum {MIN_VERSION}",
            }
        
        return {
            "available": True,
            "blender_path": blender_path,
            "version": version_str,
            "version_ok": True,
        }
        
    except subprocess.TimeoutExpired:
        return {
            "available": True,
            "blender_path": blender_path,
            "version": None,
            "version_ok": False,
            "error": "blender --version timed out after 15 seconds",
        }
    except FileNotFoundError:
        # Should not happen since we checked with shutil.which, but handle it
        return {
            "available": False,
            "error": f"blender not found at {blender_path}",
            "version_ok": False,
        }
    except OSError as e:
        return {
            "available": True,
            "blender_path": blender_path,
            "version": None,
            "version_ok": False,
            "error": f"failed to run blender: {e}",
        }


def main() -> int:
    """Main entry point. Output JSON to stdout, exit 0 always."""
    result = detect_blender()
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
