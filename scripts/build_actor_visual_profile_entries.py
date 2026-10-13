#!/usr/bin/env python3
"""FL-4162 step 10b — report-backed ActorVisualProfile entry authoring (proposal).

Authors a PROPOSED ActorVisualProfile layer entry for every layer the Step 10a
authorability report marked `content_clean`, and emits an explicit blocked record
(with cause) for every other layer. The authorability report is the SINGLE OWNER
of the clean/blocked decision — this tool never re-derives it, it consumes it.

"Report-backed" is the whole contract: a layer is authored here IFF the report says
content_clean. If this tool would author a blocked layer, or skip a clean one, it
fails closed (Canon Law 6). The authored entries are `authority:false` /
`is_proposal:true`: they are NOT runtime visual truth. Even a content_clean layer
still carries the report's universal phase gates (compiler unwired, slots
unreviewed, no server-state join, no runtime proof), so nothing here is closure
(Canon Law 16). Closure remains the headed runtime proof (step 14).

Variant honesty: an ActorVisualProfile is per source-XP variant (stem). A variant
is `profile_complete` only if EVERY one of its visible layers is content_clean. The
summary reports how many variants clear that bar — far fewer than the clean-layer
count, because one blocked layer blocks the whole variant.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
DEFAULT_REPORT = SM / "compiler_authorability_report.json"
DEFAULT_REQUIREMENTS = SM / "actor_visual_profile_requirements.json"
DEFAULT_OUT = SM / "actor_visual_profile_entries.json"
SCHEMA = "actor_visual_profile_entries/v1"
_STEM = re.compile(r"(.+)-L\d+$")


class EntryAuthoringError(Exception):
    """FL-4162: report-backed authoring could not proceed fail-closed."""


def _load_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise EntryAuthoringError(f"required {label} missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise EntryAuthoringError(f"malformed {label} {path}: {exc}") from exc


def _variant_stem(card_id: str) -> str:
    m = _STEM.match(card_id)
    if not m:
        raise EntryAuthoringError(f"cannot parse variant stem from card_id {card_id!r}")
    return m.group(1)


def build_entries(report: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any]:
    layers = report.get("layers")
    if not layers:
        raise EntryAuthoringError("authorability report has no layers")
    phase_gates = list(report.get("phase_gates") or [])
    req_by_key = {
        str(r["source_key"]): r for r in requirements.get("requirements", [])
    }

    authored: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    variant_stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {"layers_total": 0, "content_clean": 0, "content_blocked": 0}
    )

    for layer in layers:
        cid = str(layer["card_id"])
        status = layer.get("content_status")
        stem = _variant_stem(cid)
        variant_stats[stem]["layers_total"] += 1

        if status == "content_clean":
            variant_stats[stem]["content_clean"] += 1
            req = req_by_key.get(cid)
            if req is None:
                raise EntryAuthoringError(
                    f"{cid}: content_clean but has no requirement row to author from"
                )
            # Defensive: a clean layer must not actually carry a content blocker.
            if layer.get("content_blockers"):
                raise EntryAuthoringError(
                    f"{cid}: marked content_clean yet has content_blockers — report inconsistent"
                )
            # FL-4162: a composite layer owned at the contract boundary authors its
            # single reviewed owned_role; its original composite roles are kept as
            # provenance. Otherwise a content_clean layer must carry exactly one role.
            composite_owned = bool(layer.get("composite_owned_at_contract"))
            if composite_owned:
                owned_role = layer.get("owned_role")
                if not owned_role:
                    raise EntryAuthoringError(
                        f"{cid}: composite_owned_at_contract but report carries no owned_role"
                    )
                roles = [owned_role]
            else:
                roles = list(req.get("composite_roles") or [])
            if len(roles) != 1:
                raise EntryAuthoringError(
                    f"{cid}: content_clean layer must have exactly one role, got {roles}"
                )
            layer_entry = {
                "role": roles[0],
                "source_layer_index": req.get("raw_layer_index"),
                "xp_ref": req.get("source_xp_path"),
            }
            if composite_owned:
                layer_entry["composite_owned_at_contract"] = True
                layer_entry["original_composite_roles"] = layer.get("original_composite_roles")
            authored.append({
                "entry_id": f"avp_entry:{cid}",
                "authority": False,
                "is_proposal": True,
                "profile_variant": stem,
                "source_key": cid,
                "family": req.get("family"),
                "presentation_kind_candidates": req.get("presentation_kind_candidates"),
                "slot_candidates": req.get("slot_candidates"),
                "layer": layer_entry,
                "review_decision_ref": req.get("review_decision_ref", {}),
                "remaining_phase_gates": phase_gates,
            })
        elif status == "content_blocked":
            variant_stats[stem]["content_blocked"] += 1
            causes = layer.get("content_blockers") or []
            if not causes:
                raise EntryAuthoringError(
                    f"{cid}: content_blocked but no cause given — report inconsistent"
                )
            blocked.append({
                "source_key": cid,
                "family": layer.get("family"),
                "classification": layer.get("classification"),
                "blocked_causes": causes,
            })
        else:
            raise EntryAuthoringError(f"{cid}: unknown content_status {status!r}")

    # Fail-closed cross-check: authored set == report content_clean set, exactly.
    report_clean = {str(l["card_id"]) for l in layers if l.get("content_status") == "content_clean"}
    authored_keys = {e["source_key"] for e in authored}
    if authored_keys != report_clean:
        raise EntryAuthoringError(
            "authored set does not equal report content_clean set: "
            f"missing={sorted(report_clean - authored_keys)} "
            f"extra={sorted(authored_keys - report_clean)}"
        )

    complete = sorted(
        s for s, v in variant_stats.items() if v["content_blocked"] == 0
    )
    variant_completeness = {
        s: {**v, "profile_complete": v["content_blocked"] == 0}
        for s, v in sorted(variant_stats.items())
    }

    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "surface_kind": "actor_visual_profile_entries",
        "recorded_at": "2026-06-22",
        "phase": "step_10b_report_backed_authoring",
        "source_inputs": {
            "authorability_report":
                "docs/research/ascii/semantic_maps/compiler_authorability_report.json",
            "requirements":
                "docs/research/ascii/semantic_maps/actor_visual_profile_requirements.json",
        },
        "non_authority_boundary": [
            "Authored entries are proposals, NOT runtime visual truth.",
            "Every authored layer still carries the report's phase gates.",
            "A content_clean layer is not closure (Canon Law 16).",
            "Closure remains the headed runtime proof (step 14).",
        ],
        "remaining_phase_gates": phase_gates,
        "summary": {
            "total_layers": len(layers),
            "authored_entries": len(authored),
            "blocked_layers": len(blocked),
            "distinct_variants": len(variant_stats),
            "profile_complete_variants": len(complete),
            "profile_complete_variant_list": complete,
        },
        "authored_entries": sorted(authored, key=lambda e: e["source_key"]),
        "blocked_layers": sorted(blocked, key=lambda b: b["source_key"]),
        "variant_completeness": variant_completeness,
    }


def dump_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=True, sort_keys=True) + "\n"


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd_tmp, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp", prefix=path.stem)
    try:
        with os.fdopen(fd_tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--requirements", type=Path, default=DEFAULT_REQUIREMENTS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        report = _load_json(args.report, "authorability report")
        requirements = _load_json(args.requirements, "requirements")
        entries = build_entries(report, requirements)
    except EntryAuthoringError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    text = dump_json(entries)
    if args.write:
        atomic_write_text(args.out, text)
        print(f"wrote {args.out}")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
