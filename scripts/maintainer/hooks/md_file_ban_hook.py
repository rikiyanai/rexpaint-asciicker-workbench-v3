#!/usr/bin/env python3
"""PreToolUse hook — BLOCK creation of stray .md / .txt files.

Policy (per user directive, 2026-06-02; extended to .txt 2026-06-28):
  Allowed markdown/text writes:
    1. Any path under docs/agent/ (e.g. docs/agent/agents.md, docs/agent/notes.txt)
    2. Files whose basename is README.md (case-insensitive)
    3. Files whose basename is AGENTS.md (case-insensitive)
  NOTE: the README.md / AGENTS.md basename exceptions apply to .md ONLY. A .txt
  file (including README.txt / AGENTS.txt) is allowed ONLY under docs/agent/.

  Everything else is BLOCKED. This includes:
    - Loose summary docs at repo root (CAMERA_FIX_SUMMARY.md, etc.)
    - Throwaway plan/status/summary docs anywhere else in the tree
    - Any .md or .txt file under /tmp/, scripts/, godot_project/, etc.

  Other doc locations that exist today (docs/plans, docs/audits, docs/research,
  docs/solutions, docs/agent, etc.) remain readable / editable — this hook ONLY
  blocks *creation of new files*. Edits to existing markdown go through.

Hook interface:
  stdin: {"tool_name": "...", "tool_input": {...}}
  stdout: JSON {"blocked": true, "message": "..."} when blocking
  exit 0: allow; exit 2: block.
"""
from __future__ import annotations

import json
import os
import sys

ALLOWED_BASENAMES = {"readme.md", "agents.md"}
ALLOWED_DIR_PREFIX = "docs/agent/"
# Per-user auto-memory directory lives outside the repo at
# ~/.claude/projects/<slug>/memory/. The harness owns this surface; the
# md-file-ban policy targets repo doc hygiene, not user memory.
import re as _re
_AUTO_MEMORY_RE = _re.compile(r"/\.claude/projects/[^/]+/memory/[^/]+\.md$", _re.IGNORECASE)


def _normalize(path: str) -> str:
    """Return a forward-slash, repo-relative-ish path for matching."""
    if not path:
        return ""
    p = path.replace("\\", "/")
    # Strip a known repo prefix if absolute path is inside the project.
    cwd = os.getcwd().replace("\\", "/")
    if p.startswith(cwd + "/"):
        p = p[len(cwd) + 1:]
    # Drop a single leading "./"
    if p.startswith("./"):
        p = p[2:]
    return p


def _is_banned_ext(path: str) -> bool:
    # .md and .txt are both restricted surfaces. User directive 2026-06-28: .txt is
    # banned outside docs/agent/ (the README.md / AGENTS.md basename exceptions in
    # _is_allowed apply to .md only, so README.txt / AGENTS.txt stay blocked).
    p = path.lower()
    return p.endswith(".md") or p.endswith(".txt")


def _is_allowed(path: str) -> bool:
    # Auto-memory paths (~/.claude/projects/<slug>/memory/*.md) are always
    # allowed — the harness owns that surface.
    if _AUTO_MEMORY_RE.search(path.replace("\\", "/")):
        return True
    rel = _normalize(path)
    base = os.path.basename(rel).lower()
    if base in ALLOWED_BASENAMES:
        return True
    if rel.lower().startswith(ALLOWED_DIR_PREFIX):
        return True
    return False


def _path_from_tool(tool_name: str, tool_input: dict) -> str:
    if not isinstance(tool_input, dict):
        return ""
    if tool_name in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        return str(tool_input.get("file_path", ""))
    return ""


def _file_exists(path: str) -> bool:
    if not path:
        return False
    try:
        return os.path.exists(path)
    except OSError:
        return False


def _block_msg(path: str) -> str:
    return (
        f"[maintainer:md-file-ban] BLOCKED: refusing to create new markdown/text file '{path}'.\n"
        "Policy: only README.md, AGENTS.md, or files under docs/agent/ may be CREATED.\n"
        "  .txt files are allowed ONLY under docs/agent/ (no README.txt/AGENTS.txt exception).\n"
        "Edits to existing .md/.txt files are allowed. To capture notes elsewhere:\n"
        "  - Update an existing doc (docs/plans/, docs/audits/, docs/solutions/, etc.)\n"
        "  - Log a FAILURE_LOG entry via:  python3 scripts/analyze_runs.py fl add ...\n"
        "  - Save an ad-hoc script via:    python3 scripts/analyze_runs.py fl adhoc ...\n"
        "If you genuinely need a new markdown surface, ask the user to whitelist it first."
    )


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)
    if not isinstance(data, dict):
        sys.exit(0)

    tool_name = str(data.get("tool_name", "")).strip()
    if tool_name not in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    path = _path_from_tool(tool_name, tool_input)
    if not path or not _is_banned_ext(path):
        sys.exit(0)

    # Edit/MultiEdit/NotebookEdit on an EXISTING markdown file is fine —
    # we are only blocking *creation* of new stray docs.
    if tool_name in ("Edit", "MultiEdit", "NotebookEdit") and _file_exists(path):
        sys.exit(0)

    # Write may create or overwrite; if it already exists, treat as edit.
    if tool_name == "Write" and _file_exists(path):
        sys.exit(0)

    if _is_allowed(path):
        sys.exit(0)

    msg = _block_msg(path)
    sys.stderr.write(msg + "\n")
    print(json.dumps({"blocked": True, "message": msg}))
    sys.exit(2)


if __name__ == "__main__":
    main()
