#!/usr/bin/env python3
"""
Self-containment audit for asciicker-pipeline-v2.

Hard-fails on:
- symlinks that resolve outside the repo root
- live/build/runtime/test files that reference absolute paths outside the repo

Warns on:
- historical docs/logs that still mention external absolute paths

Usage:
  python3 scripts/self_containment_audit.py
  python3 scripts/self_containment_audit.py --json
  python3 scripts/self_containment_audit.py --strict-docs
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "output",
}


def discover_submodule_dirs(root: Path) -> set[str]:
    """Return repo-relative submodule paths from .gitmodules."""
    gitmodules = root / ".gitmodules"
    if not gitmodules.is_file():
        return set()
    submodules: set[str] = set()
    for line in gitmodules.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if not stripped.startswith("path"):
            continue
        _key, sep, value = stripped.partition("=")
        if sep:
            submodules.add(value.strip().strip("/"))
    return submodules


SUBMODULE_DIRS = discover_submodule_dirs(REPO_ROOT)

# Symlinks that are allowed to point outside the repo (vendored from sibling repos)
VENDORED_SYMLINKS = {
    "docs/research/ascii/semantic_maps",
}

DOC_EXTS = {".md", ".txt", ".rst"}
TEXT_EXTS = {
    ".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".tsx",
    ".json", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".html",
    ".css", ".cpp", ".c", ".h", ".hpp", ".mk",
}

ABS_PATH_RE = re.compile(
    r"(?P<path>/(?:Users|Volumes|private|tmp|var|opt|home|Applications|Library)"
    r"(?:/[^\s\"'`<>()\[\]{}]+)+)"
)

NON_BLOCKING_PREFIXES = (
    "/tmp/",
    "/private/tmp/",
    "/var/folders/",
    "/Applications/",
    "/opt/",
    "/home/web_user",
    "/home/web_user/",
    "/Library/",
)


def is_non_blocking_path(raw: str) -> bool:
    return any(raw == prefix.rstrip("/") or raw.startswith(prefix) for prefix in NON_BLOCKING_PREFIXES)


@dataclass
class Finding:
    kind: str
    severity: str
    path: str
    detail: str


def is_inside_repo(path: Path) -> bool:
    try:
        resolved = path.resolve(strict=False)
    except Exception:
        return False
    return resolved == REPO_ROOT or REPO_ROOT in resolved.parents


def should_skip_dir(path: Path) -> bool:
    return path.name in SKIP_DIRS


def is_probably_text(path: Path) -> bool:
    if path.suffix.lower() in DOC_EXTS or path.suffix.lower() in TEXT_EXTS:
        return True
    if path.name in {"AGENTS.md", "CLAUDE.md", "Makefile", "Dockerfile"}:
        return True
    return False


def classify_path(path: Path) -> str:
    rel = path.relative_to(REPO_ROOT).as_posix()
    if rel.startswith("docs/") or path.suffix.lower() in DOC_EXTS or path.name.endswith(".md"):
        return "doc"
    if rel.startswith(".claude/") or rel.startswith(".mcp") or rel == ".mcp.json":
        return "local_config"
    if rel.startswith(("src/", "scripts/", "web/", "runtime/", "tests/", ".githooks/")):
        return "live"
    if path.suffix.lower() in {
        ".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".tsx",
        ".json", ".toml", ".yaml", ".yml", ".html", ".css", ".cpp", ".c",
        ".h", ".hpp", ".mk",
    }:
        return "live"
    return "other"


def iter_repo_paths(root: Path):
    for path in root.rglob("*"):
        parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS for part in parts):
            continue
        rel = Path(*parts).as_posix()
        if any(rel == submodule or rel.startswith(f"{submodule}/") for submodule in SUBMODULE_DIRS):
            continue
        yield path


def scan_symlinks() -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_repo_paths(REPO_ROOT):
        if not path.is_symlink():
            continue
        try:
            target = path.resolve(strict=False)
        except Exception as exc:
            findings.append(
                Finding(
                    kind="broken_symlink",
                    severity="error",
                    path=str(path.relative_to(REPO_ROOT)),
                    detail=f"failed to resolve symlink: {exc}",
                )
            )
            continue
        if not is_inside_repo(target):
            rel = str(path.relative_to(REPO_ROOT))
            if rel in VENDORED_SYMLINKS:
                continue
            findings.append(
                Finding(
                    kind="external_symlink",
                    severity="error",
                    path=rel,
                    detail=f"resolves outside repo: {target}",
                )
            )
    return findings


def normalize_match(candidate: str) -> str:
    return candidate.rstrip(".,:;")


def scan_text_files(strict_docs: bool) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_repo_paths(REPO_ROOT):
        if path.is_dir() or path.is_symlink() or not is_probably_text(path):
            continue
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                continue
        except OSError:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        category = classify_path(path)
        for match in ABS_PATH_RE.finditer(text):
            raw = normalize_match(match.group("path"))
            candidate = Path(raw)
            if is_inside_repo(candidate):
                continue
            rel = str(path.relative_to(REPO_ROOT))
            if category in {"doc", "local_config"} and not strict_docs:
                findings.append(
                    Finding(
                        kind=f"external_path_{category}",
                        severity="warning",
                        path=rel,
                        detail=f"references external absolute path: {raw}",
                    )
                )
            elif is_non_blocking_path(raw):
                findings.append(
                    Finding(
                        kind="external_path_env",
                        severity="warning",
                        path=rel,
                        detail=f"references non-repo environment path: {raw}",
                    )
                )
            elif category == "live":
                findings.append(
                    Finding(
                        kind="external_path_live",
                        severity="error",
                        path=rel,
                        detail=f"references external absolute path: {raw}",
                    )
                )
    return findings


def build_report(strict_docs: bool) -> dict:
    findings = scan_symlinks() + scan_text_files(strict_docs=strict_docs)
    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]
    return {
        "repo_root": str(REPO_ROOT),
        "strict_docs": strict_docs,
        "ok": len(errors) == 0,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": [asdict(f) for f in errors],
        "warnings": [asdict(f) for f in warnings],
    }


def print_human(report: dict) -> None:
    if report["ok"]:
        print("SELF-CONTAINMENT AUDIT: PASS")
    else:
        print("SELF-CONTAINMENT AUDIT: FAIL")
    print(f"repo: {report['repo_root']}")
    print(f"errors: {report['error_count']}")
    print(f"warnings: {report['warning_count']}")

    if report["errors"]:
        print("\nBlocking findings:")
        for item in report["errors"]:
            print(f"- [{item['kind']}] {item['path']}: {item['detail']}")

    if report["warnings"]:
        print("\nWarnings:")
        for item in report["warnings"][:20]:
            print(f"- [{item['kind']}] {item['path']}: {item['detail']}")
        remaining = len(report["warnings"]) - 20
        if remaining > 0:
            print(f"- ... {remaining} more warning(s)")

    if not report["ok"]:
        print(
            "\nFix blocking findings before committing or pushing. "
            "Historical doc references can be upgraded to blocking with --strict-docs."
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--strict-docs", action="store_true", help="treat doc references as blocking")
    args = parser.parse_args()

    report = build_report(strict_docs=args.strict_docs)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human(report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
