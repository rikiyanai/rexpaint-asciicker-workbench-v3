#!/usr/bin/env python3
"""Hook installer — generate and verify maintainer hook configurations.

Outputs hook JSON snippets matching the actual ~/.claude/settings.json
nested format (matcher → hooks array). Can also verify installation.

Usage:
    python3 scripts/maintainer/install_hooks.py              # Print hook configs
    python3 scripts/maintainer/install_hooks.py --verify      # Check if hooks are installed
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_HOOKS_DIR = _PROJECT_ROOT / "scripts" / "maintainer" / "hooks"

# Hook definitions — mirrors exactly the structure in ~/.claude/settings.json.
# The 3 common hooks (command_handoff, startup_gate, claim_guard_transcript)
# are registered once under the "*" wildcard matcher — no per-tool duplication.
HOOKS = {
    "session_start": {
        "hook_type": "SessionStart",
        "matcher": None,
        "script": str(_HOOKS_DIR / "session_start_hook.py"),
        "status_message": "Maintainer: start-of-session checks...",
        "description": "Run start-of-session protocol (conductor + hooks + maintainer tests)",
        "verify_fragment": "session_start_hook",
    },
    "claim_guard": {
        "hook_type": "PreToolUse",
        "matcher": "Bash",
        "script": str(_HOOKS_DIR / "claim_guard_hook.py"),
        "status_message": "Maintainer: claim guard...",
        "description": "Warn on unsupported claims in git commit messages",
        "verify_fragment": "claim_guard_hook",
    },
    "worktree_ban": {
        "hook_type": "PreToolUse",
        "matcher": "Bash",
        "script": str(_HOOKS_DIR / "worktree_ban_hook.py"),
        "status_message": "Maintainer: worktree ban...",
        "description": "Block git worktree creation in this repo",
        "verify_fragment": "worktree_ban_hook",
    },
    "fl4260_user_action_guard": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_PROJECT_ROOT / "scripts" / "fl4260_user_action_guard.py") + " --hook",
        "status_message": "Maintainer: ASCIIID user-action guard...",
        "description": "Block proof commands that bypass visible ASCIIID mouse and keyboard actions",
        "verify_fragment": "fl4260_user_action_guard",
    },
    "asciiid_computer_use_guard": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_HOOKS_DIR / "asciiid_computer_use_guard_hook.py"),
        "status_message": "Maintainer: ASCIIID Computer Use guard...",
        "description": "Block Computer Use during ASCIIID work and redirect to owned capture/action surfaces",
        "verify_fragment": "asciiid_computer_use_guard_hook",
    },
    "fl4588_html_user_action_guard": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_PROJECT_ROOT / "scripts" / "fl4588_html_user_action_guard.py") + " --hook",
        "status_message": "Maintainer: ASCIIID HTML user-action guard...",
        "description": "Block synthetic DOM mutation and direct service mutation in ASCIIID browser testing",
        "verify_fragment": "fl4588_html_user_action_guard",
    },
    "fl4359_spent_lane_guard_bash": {
        "hook_type": "PreToolUse",
        "matcher": "Bash",
        "script": str(_HOOKS_DIR / "fl4359_spent_lane_guard_hook.py"),
        "status_message": "Maintainer: FL-4359 spent-lane guard...",
        "description": "Block FL-4359 source commits that skip failed-attempt and reference checks",
        "verify_fragment": "fl4359_spent_lane_guard_hook",
    },
    "claim_guard_content_write": {
        "hook_type": "PreToolUse",
        "matcher": "Write",
        "script": str(_HOOKS_DIR / "claim_guard_content_hook.py"),
        "status_message": "Maintainer: claim guard content...",
        "description": "Block unsupported status claims in written file content",
        "verify_fragment": "claim_guard_content_hook",
    },
    "claim_guard_content_edit": {
        "hook_type": "PreToolUse",
        "matcher": "Edit",
        "script": str(_HOOKS_DIR / "claim_guard_content_hook.py"),
        "status_message": "Maintainer: claim guard content...",
        "description": "Block unsupported status claims in edited file content",
        "verify_fragment": "claim_guard_content_hook",
    },
    "claim_guard_content_multiedit": {
        "hook_type": "PreToolUse",
        "matcher": "MultiEdit",
        "script": str(_HOOKS_DIR / "claim_guard_content_hook.py"),
        "status_message": "Maintainer: claim guard content...",
        "description": "Block unsupported status claims in multi-edit file content",
        "verify_fragment": "claim_guard_content_hook",
    },
    "godot_visual_grid_canon_write": {
        "hook_type": "PreToolUse",
        "matcher": "Write",
        "script": str(_HOOKS_DIR / "godot_visual_grid_canon_hook.py"),
        "status_message": "Maintainer: Godot visual grid canon...",
        "description": "Block terrain/water/foliage/mountain proof wording that promotes non-grid dump surfaces",
        "verify_fragment": "godot_visual_grid_canon_hook",
    },
    "godot_visual_grid_canon_edit": {
        "hook_type": "PreToolUse",
        "matcher": "Edit",
        "script": str(_HOOKS_DIR / "godot_visual_grid_canon_hook.py"),
        "status_message": "Maintainer: Godot visual grid canon...",
        "description": "Block terrain/water/foliage/mountain proof wording that promotes non-grid dump surfaces",
        "verify_fragment": "godot_visual_grid_canon_hook",
    },
    "godot_visual_grid_canon_multiedit": {
        "hook_type": "PreToolUse",
        "matcher": "MultiEdit",
        "script": str(_HOOKS_DIR / "godot_visual_grid_canon_hook.py"),
        "status_message": "Maintainer: Godot visual grid canon...",
        "description": "Block terrain/water/foliage/mountain proof wording that promotes non-grid dump surfaces",
        "verify_fragment": "godot_visual_grid_canon_hook",
    },
    "search_pattern_warning_bash": {
        "hook_type": "PreToolUse",
        "matcher": "Bash",
        "script": str(_HOOKS_DIR / "search_pattern_warning_hook.py"),
        "status_message": "Maintainer: search pattern warning...",
        "description": "Warn when shell searches use the wrong query surface",
        "verify_fragment": "search_pattern_warning_hook",
    },
    "search_pattern_warning_read": {
        "hook_type": "PreToolUse",
        "matcher": "Read",
        "script": str(_HOOKS_DIR / "search_pattern_warning_hook.py"),
        "status_message": "Maintainer: search pattern warning...",
        "description": "Warn when reads use the wrong query surface",
        "verify_fragment": "search_pattern_warning_hook",
    },
    "search_pattern_warning_grep": {
        "hook_type": "PreToolUse",
        "matcher": "Grep",
        "script": str(_HOOKS_DIR / "search_pattern_warning_hook.py"),
        "status_message": "Maintainer: search pattern warning...",
        "description": "Warn when grep searches use the wrong query surface",
        "verify_fragment": "search_pattern_warning_hook",
    },
    "search_pattern_warning_glob": {
        "hook_type": "PreToolUse",
        "matcher": "Glob",
        "script": str(_HOOKS_DIR / "search_pattern_warning_hook.py"),
        "status_message": "Maintainer: search pattern warning...",
        "description": "Warn when glob searches use the wrong query surface",
        "verify_fragment": "search_pattern_warning_hook",
    },
    "search_pattern_warning_search": {
        "hook_type": "PreToolUse",
        "matcher": "Search",
        "script": str(_HOOKS_DIR / "search_pattern_warning_hook.py"),
        "status_message": "Maintainer: search pattern warning...",
        "description": "Warn when search tools use the wrong query surface",
        "verify_fragment": "search_pattern_warning_hook",
    },
    "skill_gate": {
        "hook_type": "PreToolUse",
        "matcher": "Bash",
        "script": str(_HOOKS_DIR / "skill_gate_hook.py"),
        "status_message": "Skill gate: checking required skills...",
        "description": "Block execute-phase if required skills are missing from .agents/skills/",
        "verify_fragment": "skill_gate_hook",
    },
    "command_handoff_catchall": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_HOOKS_DIR / "command_handoff_hook.py"),
        "status_message": "Maintainer: command handoff...",
        "description": "Write per-command handoff artifact for all tools",
        "verify_fragment": "command_handoff_hook",
    },
    "startup_gate_catchall": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_HOOKS_DIR / "startup_gate_hook.py"),
        "status_message": "Maintainer: startup gate...",
        "description": "Enforce start-of-session checks before any tool use",
        "verify_fragment": "startup_gate_hook",
    },
    "claim_guard_transcript_catchall": {
        "hook_type": "PreToolUse",
        "matcher": "*",
        "script": str(_HOOKS_DIR / "claim_guard_transcript_hook.py"),
        "status_message": "Maintainer: claim guard (transcript)...",
        "description": "Block tool use when recent assistant output has unsupported claims",
        "verify_fragment": "claim_guard_transcript_hook",
    },
    "session_end": {
        "hook_type": "Stop",
        "matcher": None,
        "script": str(_HOOKS_DIR / "session_end_hook.py"),
        "status_message": "Maintainer: session-end scan...",
        "description": "Run janitor + audit + goal sanity at session end",
        "verify_fragment": "session_end_hook",
    },
}


def print_hook_configs():
    """Print hook configurations as JSON snippets for manual installation."""
    print("# Maintainer Hook Configurations")
    print("# Add these entries to the appropriate arrays in ~/.claude/settings.json\n")

    for name, hook in HOOKS.items():
        print(f"## {name}")
        print(f"# {hook['description']}")
        print(f"# Hook type: {hook['hook_type']}", end="")
        if hook["matcher"]:
            print(f", matcher: {hook['matcher']}")
        else:
            print()

        entry = {
            "type": "command",
            "command": f"python3 {hook['script']}",
            "statusMessage": hook["status_message"],
        }

        if hook["matcher"]:
            print(f"# Add to hooks.{hook['hook_type']} -> matcher: {hook['matcher']} -> hooks array:")
        else:
            print(f"# Add to hooks.{hook['hook_type']} -> hooks array:")

        print(json.dumps(entry, indent=2))
        print()


def verify_hooks(*, verbose: bool = True):
    """Check if hooks are present in ~/.claude/settings.json."""
    settings_path = Path.home() / ".claude" / "settings.json"
    if not settings_path.exists():
        if verbose:
            print("~/.claude/settings.json not found")
        return False

    try:
        settings = json.loads(settings_path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        if verbose:
            print(f"Could not read settings: {e}")
        return False

    hooks_config = settings.get("hooks", {})
    found = 0
    total = len(HOOKS)

    for name, hook_def in HOOKS.items():
        hook_type = hook_def["hook_type"]
        matcher = hook_def["matcher"]
        fragment = hook_def["verify_fragment"]
        type_list = hooks_config.get(hook_type, [])

        is_installed = False
        for group in type_list:
            if not isinstance(group, dict):
                continue
            group_matcher = group.get("matcher")
            if matcher and group_matcher != matcher:
                continue
            inner_hooks = group.get("hooks", [])
            for h in inner_hooks:
                if isinstance(h, dict) and fragment in h.get("command", ""):
                    is_installed = True
                    break
            if is_installed:
                break

        status = "installed" if is_installed else "MISSING"
        if verbose:
            print(f"  [{status}] {name} ({hook_type})")
        if is_installed:
            found += 1

    if verbose:
        print(f"\n{found}/{total} hooks installed")
    return found == total


def apply_hooks(*, verbose: bool = True) -> bool:
    """Install missing maintainer hooks into ~/.claude/settings.json."""
    settings_path = Path.home() / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            if verbose:
                print(f"Could not read settings: {e}")
            return False
        if not isinstance(settings, dict):
            settings = {}
    else:
        settings = {}

    hooks_config = settings.setdefault("hooks", {})
    if not isinstance(hooks_config, dict):
        hooks_config = {}
        settings["hooks"] = hooks_config

    # FL-4260 / FL-4548 delete-first migration: remove the earlier permissive
    # duplicate. It allowed backend map load, camera forcing, TERM++ opening,
    # and observe-render setup. The strict wildcard guard above is the sole
    # owner for Claude and Codex proof-action enforcement.
    for hook_type, type_list in list(hooks_config.items()):
        if not isinstance(type_list, list):
            continue
        kept_groups = []
        for group in type_list:
            if not isinstance(group, dict):
                kept_groups.append(group)
                continue
            inner = group.get("hooks", [])
            if isinstance(inner, list):
                group["hooks"] = [
                    hook for hook in inner
                    if not (
                        isinstance(hook, dict)
                        and "proof_bypass_guard_hook.py" in hook.get("command", "")
                    )
                ]
            if group.get("hooks"):
                kept_groups.append(group)
        hooks_config[hook_type] = kept_groups

    added = 0
    for hook_def in HOOKS.values():
        hook_type = hook_def["hook_type"]
        matcher = hook_def["matcher"]
        fragment = hook_def["verify_fragment"]
        type_list = hooks_config.setdefault(hook_type, [])
        if not isinstance(type_list, list):
            type_list = []
            hooks_config[hook_type] = type_list

        group = None
        for candidate in type_list:
            if not isinstance(candidate, dict):
                continue
            group_matcher = candidate.get("matcher")
            if matcher is None:
                if group_matcher in (None, ""):
                    group = candidate
                    break
            elif group_matcher == matcher:
                group = candidate
                break

        if group is None:
            group = {"hooks": []}
            if matcher is not None:
                group["matcher"] = matcher
            type_list.append(group)

        inner_hooks = group.get("hooks")
        if not isinstance(inner_hooks, list):
            inner_hooks = []
            group["hooks"] = inner_hooks

        already_installed = False
        for inner in inner_hooks:
            if isinstance(inner, dict) and fragment in str(inner.get("command", "")):
                already_installed = True
                break
        if already_installed:
            continue

        inner_hooks.append({
            "type": "command",
            "command": f"python3 {hook_def['script']}",
            "statusMessage": hook_def["status_message"],
        })
        added += 1

    settings_path.write_text(json.dumps(settings, indent=2) + "\n")
    if verbose:
        print(f"Applied {added} hook(s) into {settings_path}")
    return verify_hooks(verbose=verbose)


def main():
    parser = argparse.ArgumentParser(
        description="Hook installer for maintainer tools"
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Install any missing maintainer hooks into ~/.claude/settings.json"
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="Check if hooks are installed in ~/.claude/settings.json"
    )
    args = parser.parse_args()

    if args.apply:
        ok = apply_hooks()
        sys.exit(0 if ok else 1)
    elif args.verify:
        ok = verify_hooks()
        sys.exit(0 if ok else 1)
    else:
        print_hook_configs()


if __name__ == "__main__":
    main()
