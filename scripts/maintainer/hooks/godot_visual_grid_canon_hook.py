#!/usr/bin/env python3
"""PreToolUse content hook for FL-4377 visual-grid canon wording."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = PROJECT_ROOT / "scripts" / "validate_godot_visual_grid_canon.py"
WATCHED_SUFFIXES = (".md", ".py", ".gd", ".glsl", ".json")


def _content_from_payload(tool_name: str, tool_input: dict) -> tuple[str, str]:
    file_path = str(tool_input.get("file_path", ""))
    if not file_path.endswith(WATCHED_SUFFIXES):
        return file_path, ""
    if tool_name == "Write":
        return file_path, str(tool_input.get("content", ""))
    if tool_name == "Edit":
        return file_path, str(tool_input.get("new_string", ""))
    if tool_name == "MultiEdit":
        chunks: list[str] = []
        for edit in tool_input.get("edits", []):
            if isinstance(edit, dict):
                new_string = edit.get("new_string", "")
                if isinstance(new_string, str):
                    chunks.append(new_string)
        return file_path, "\n".join(chunks)
    return file_path, ""


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(data, dict):
        return 0
    tool_name = str(data.get("tool_name", ""))
    if tool_name not in {"Write", "Edit", "MultiEdit"}:
        return 0
    tool_input = data.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return 0
    file_path, content = _content_from_payload(tool_name, tool_input)
    if not content:
        return 0
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--stdin-content", "--label", file_path],
        cwd=PROJECT_ROOT,
        input=content,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode == 0:
        return 0
    msg = (
        "[maintainer:godot-visual-grid-canon] BLOCKED: FL-4377 requires the "
        "operator-receipted baseline/current PNG grid as the terrain/water/"
        "foliage/mountain review surface. Date-named clones cannot own the "
        "active baseline. Final dumps, HTML, rows, validators, screenshots, "
        "and sidecars are companion diagnostics only.\n"
        + result.stdout
    )
    sys.stderr.write(msg)
    print(json.dumps({"blocked": True, "message": msg}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
