#!/usr/bin/env python3
"""FL-4162 step 9c — contradiction report over the reviewed packet.

Post-review interpretation only. It reads the agent-review packet
(manual_candidate_review.json) — never the hand corpus directly — and surfaces
the tensions a human must resolve before any ActorVisualProfile authoring:

  1. hand_vs_machine_guess   — the human's label contradicts the machine pre_guess
                               (verdict.contradictions, recorded during review).
  2. engine_topology_notes   — engine/overlay/anim tensions the reviewer annotated
                               (verdict.topology_note).
  3. glyph_exact_conflicts   — byte-identical layers (same whole_atlas_fingerprint)
                               that received DIFFERENT proposed role sets. Same
                               pixels must not map to two different roles.
  4. unresolved_cards        — cards the reviewer refused to propose (fail closed).
  5. composite_layers        — single layers carrying >1 role; each needs a family
                               topology contract before it can become a profile.

Authority: NONE. is_proposal: False. This is a navigation surface, not a decision.
Canon Law 16: a contradiction list is not closure.

Fail-closed (Canon Law 6): a missing/malformed packet raises; it never emits an
empty "no contradictions" report by silently swallowing a read error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
DEFAULT_PACKET = SM / "manual_candidate_review.json"
DEFAULT_OUT = SM / "contradiction_report.json"
SCHEMA = "contradiction_report/v1"


class ContradictionReportError(Exception):
    """FL-4162: contradiction report could not be built fail-closed."""


def load_packet(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ContradictionReportError(f"review packet missing: {path}")
    try:
        packet = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ContradictionReportError(f"malformed review packet {path}: {exc}") from exc
    if not isinstance(packet, dict) or not isinstance(packet.get("reviewed"), list):
        raise ContradictionReportError(f"packet {path} missing 'reviewed' list")
    return packet


def _roles(row: dict[str, Any]) -> list[str]:
    return list((row.get("agent_verdict") or {}).get("proposed_roles") or [])


def _roles_key(row: dict[str, Any]) -> str:
    return ";".join(sorted(_roles(row)))


def build_report(packet: dict[str, Any]) -> dict[str, Any]:
    rows = packet["reviewed"]

    hand_vs_machine: list[dict[str, Any]] = []
    engine_topology: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    composite: list[dict[str, Any]] = []

    by_fingerprint: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        verdict = row.get("agent_verdict") or {}
        card_id = row.get("card_id")

        contradictions = verdict.get("contradictions") or []
        if contradictions:
            hand_vs_machine.append({
                "card_id": card_id,
                "queue_class": row.get("queue_class"),
                "hand_corrected_label": row.get("hand_corrected_label"),
                "hand_pre_guess": row.get("hand_pre_guess"),
                "hand_pre_source": row.get("hand_pre_source"),
                "contradictions": contradictions,
            })

        note = (verdict.get("topology_note") or "").strip()
        if note:
            engine_topology.append({
                "card_id": card_id,
                "queue_class": row.get("queue_class"),
                "engine_fixed_role": row.get("engine_fixed_role"),
                "engine_is_overlay": row.get("engine_is_overlay"),
                "engine_overlay_ordinal": row.get("engine_overlay_ordinal"),
                "proposed_roles": _roles(row),
                "topology_note": note,
            })

        if verdict.get("unresolved"):
            unresolved.append({
                "card_id": card_id,
                "queue_class": row.get("queue_class"),
                "hand_corrected_label": row.get("hand_corrected_label"),
                "support_basis": verdict.get("support_basis"),
                "tentative_roles": _roles(row),
            })

        if len(_roles(row)) > 1:
            composite.append({
                "card_id": card_id,
                "family": row.get("family"),
                "raw_layer_index": row.get("raw_layer_index"),
                "queue_class": row.get("queue_class"),
                "proposed_roles": _roles(row),
                "supported": bool(verdict.get("supported")),
            })

        fp = row.get("whole_atlas_fingerprint")
        if fp:
            by_fingerprint[fp].append(row)

    # Same byte-identical layer, different proposed role sets → genuine conflict.
    glyph_exact_conflicts: list[dict[str, Any]] = []
    for fp, group in sorted(by_fingerprint.items()):
        if len(group) < 2:
            continue
        # Only compare rows that actually proposed something (skip pure unresolved).
        proposing = [r for r in group if _roles(r)]
        distinct = sorted({_roles_key(r) for r in proposing})
        if len(distinct) > 1:
            glyph_exact_conflicts.append({
                "whole_atlas_fingerprint": fp,
                "distinct_role_sets": distinct,
                "members": [
                    {"card_id": r.get("card_id"), "proposed_roles": _roles(r),
                     "queue_class": r.get("queue_class")}
                    for r in group
                ],
            })

    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": False,
        "surface_kind": "contradiction_report",
        "recorded_at": "2026-06-18",
        "source_packet": "docs/research/ascii/semantic_maps/manual_candidate_review.json",
        "non_authority_boundary": [
            "Post-review interpretation only.",
            "A contradiction list is not closure (Canon Law 16).",
            "Resolution requires human judgment before ActorVisualProfile authoring.",
        ],
        "summary": {
            "reviewed_rows": len(rows),
            "hand_vs_machine_guess": len(hand_vs_machine),
            "engine_topology_notes": len(engine_topology),
            "glyph_exact_conflicts": len(glyph_exact_conflicts),
            "unresolved_cards": len(unresolved),
            "composite_layers": len(composite),
        },
        "hand_vs_machine_guess": sorted(hand_vs_machine, key=lambda r: str(r["card_id"])),
        "engine_topology_notes": sorted(engine_topology, key=lambda r: str(r["card_id"])),
        "glyph_exact_conflicts": glyph_exact_conflicts,
        "unresolved_cards": sorted(unresolved, key=lambda r: str(r["card_id"])),
        "composite_layers": sorted(composite, key=lambda r: str(r["card_id"])),
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
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        packet = load_packet(args.packet)
        report = build_report(packet)
    except ContradictionReportError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    text = dump_json(report)
    if args.write:
        atomic_write_text(args.out, text)
        print(f"wrote {args.out}")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
