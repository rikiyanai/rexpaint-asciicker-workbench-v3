#!/usr/bin/env python3
"""Adapt the Y9-2 multiplayer canon guard to this repository layout.

The pipeline repository contains a nested Y9-2 checkout for assets and
references, but its root is not a multiplayer repository.  Keep the startup
front door present without making the nested checkout's authority mandatory
for pipeline-only work.  If the root later becomes a canonical multiplayer
checkout, delegate to the authoritative guard and preserve its fail-closed
behavior.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any


AUTHORITATIVE_GUARD_REL = Path(
    "asciicker-Y9-2/scripts/multiplayer_canon_guard.py"
)
PIPELINE_FAILURE_LOG_REL = Path("docs/PLAYWRIGHT_FAILURE_LOG.md")
CANONICAL_FAILURE_LOG_REL = Path("docs/FAILURE_LOG.md")
CANONICAL_SPEC_REL = Path("docs/plans/2026-03-22-multiplayer-canonical-spec.md")


def _is_pipeline_layout(repo_root: Path) -> bool:
    """Return whether the root has v3's explicit pipeline failure surface."""
    return (
        (repo_root / PIPELINE_FAILURE_LOG_REL).is_file()
        and not (repo_root / CANONICAL_FAILURE_LOG_REL).exists()
        and not (repo_root / CANONICAL_SPEC_REL).exists()
    )


def _load_authoritative_guard(repo_root: Path) -> ModuleType | None:
    path = repo_root / AUTHORITATIVE_GUARD_REL
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("y9_multiplayer_canon_guard", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check(repo_root: Path) -> tuple[bool, list[str], list[str], bool]:
    """Return ``(ok, violations, notes, applicable)`` for ``repo_root``."""
    repo_root = repo_root.resolve()
    if _is_pipeline_layout(repo_root):
        return (
            True,
            [],
            [
                "multiplayer canon not applicable to pipeline root",
                f"pipeline failure log present: {repo_root / PIPELINE_FAILURE_LOG_REL}",
            ],
            False,
        )

    guard = _load_authoritative_guard(repo_root)
    if guard is None:
        return (
            False,
            [
                "canonical multiplayer guard unavailable for a non-pipeline layout",
                f"expected: {repo_root / AUTHORITATIVE_GUARD_REL}",
            ],
            [],
            True,
        )

    ok, violations, notes = guard.check_multiplayer_canon(repo_root)
    return ok, violations, notes, True


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check the multiplayer canon rule.")
    parser.add_argument("--repo-root", default=".", help="Repository root to validate.")
    parser.add_argument("--json", action="store_true", help="Emit JSON result.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    repo_root = Path(args.repo_root).expanduser().resolve()
    ok, violations, notes, applicable = check(repo_root)
    payload: dict[str, Any] = {
        "ok": ok,
        "applicable": applicable,
        "repo_root": str(repo_root),
        "violations": violations,
        "notes": notes,
    }

    if args.json:
        print(json.dumps(payload, indent=2))
    elif ok:
        print("multiplayer-canon-guard: PASS")
        for note in notes:
            print(f"  {note}")
    else:
        print("multiplayer-canon-guard: BLOCKED")
        for violation in violations:
            print(f"  {violation}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
