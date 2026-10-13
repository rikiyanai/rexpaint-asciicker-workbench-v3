#!/usr/bin/env python3
"""PreToolUse:Bash hook for FL-4359 spent-lane commit guard."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GIT_COMMIT_RE = re.compile(r"\bgit\s+(?:-[^\s]+\s+)*commit\b")


def _command_from_stdin() -> str:
    raw = sys.stdin.read()
    if not raw.strip():
        return ""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, EOFError):
        return ""
    if not isinstance(data, dict):
        return ""
    if data.get("tool_name") != "Bash":
        return ""
    tool_input = data.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return ""
    return str(tool_input.get("command", ""))


def main() -> None:
    cmd = _command_from_stdin()
    if not cmd or not GIT_COMMIT_RE.search(cmd):
        sys.exit(0)

    proc = subprocess.run(
        ["python3", "scripts/fl4359_spent_lane_guard.py", "check"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode == 0:
        sys.exit(0)
    message = (
        "[maintainer:fl4359-spent-lane] BLOCKED: FL-4359 probe/render "
        "source commit skipped the failed-attempt/reference guard.\n"
        + proc.stdout
        + proc.stderr
    ).strip()
    sys.stderr.write(message + "\n")
    print(json.dumps({"blocked": True, "message": message}))
    sys.exit(2)


if __name__ == "__main__":
    main()
