#!/usr/bin/env python3
"""FL-4162 step 10a — compiler authorability report (report-only, no authoring).

The FIRST compiler-enforcement surface. It reads the committed proposal artifacts
(family topology contracts + ActorVisualProfile requirements) as READ-ONLY inputs
and decides, fail-closed, which of the 343 visible layers are content-authorable vs
blocked — mapping every block to the Step 10 plan's rejection classes.

It does NOT author ActorVisualProfile rows, does NOT modify the engine compiler,
and does NOT prove runtime visuals. A "content-clean" verdict is NOT closure
(Canon Law 16): it means a layer carries no content-level blocker, and is still
gated by the universal phase gates below.

Two tiers (this is the honest model — collapsing them hides real readiness):

  PHASE GATES (apply to ALL 343 layers, gate the whole step):
    the compiler is not wired, slots were never reviewed, there is no reachable
    server-state join, no semantic-mask coverage, and no runtime proof. Until these
    clear, NOTHING is runtime-authorable regardless of content status.

  CONTENT BLOCKERS (per-layer, discriminating):
    unowned/unresolved layer, role-name conflict (pixel identity, two names),
    composite layer needing a family contract, and proposals derived from a
    non-accept hand status (lower confidence, need a human upgrade).

Fail-closed (Canon Law 6): every topology layer must be decided exactly once; a
layer whose classification is unknown, or coverage != the contracts' card counts,
raises rather than passing silently.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
DEFAULT_CONTRACTS = SM / "family_topology_contracts.json"
DEFAULT_REQUIREMENTS = SM / "actor_visual_profile_requirements.json"
DEFAULT_OUT = SM / "compiler_authorability_report.json"
SCHEMA = "compiler_authorability_report/v1"

PHASE_GATES = (
    "not_actor_visual_profile_source",
    "not_compiler_input",
    "needs_reachable_server_state_join",
    "needs_family_topology_contract",
    "needs_semantic_mask_coverage",
    "needs_runtime_visual_proof",
    "needs_reviewed_slot_candidates",
)
# requirement promotion_blocker -> (content reason code, Step 10 plan rejection class)
CONTENT_BLOCKER_MAP = {
    "role_name_conflict_unresolved": ("role_name_conflict", "3_role_name_conflict"),
    "composite_layer_requires_family_contract":
        ("composite_needs_family_contract", "4_topology_mismatch"),
    "decision_from_non_accept_hand_status":
        ("proposal_from_non_accept_hand_status", None),  # content confidence, not a hard class
    "decision_authority_flags_invalid":
        ("decision_authority_flags_invalid", None),
}
# topology classification -> content reason (Step 10 plan class 2: unowned visible layer)
CLASS_BLOCKER = {
    "unresolved": ("unowned_or_unresolved_layer", "2_unowned_visible_layer"),
    "rejected": ("rejected_fragment_not_owner", "2_unowned_visible_layer"),
}
CLASSES = ("owned", "composite", "rejected", "unresolved")


class AuthorabilityReportError(Exception):
    """FL-4162: authorability report could not be built fail-closed."""


def _load_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise AuthorabilityReportError(f"required {label} missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise AuthorabilityReportError(f"malformed {label} {path}: {exc}") from exc


def build_report(contracts_doc: dict[str, Any], requirements_doc: dict[str, Any]) -> dict[str, Any]:
    blockers_by_key: dict[str, set[str]] = {
        str(r["source_key"]): set(r.get("promotion_blockers") or [])
        for r in requirements_doc.get("requirements", [])
    }

    layers: list[dict[str, Any]] = []
    reason_counts = Counter()
    plan_class_counts = Counter()
    family_clean = Counter()
    family_total = Counter()
    content_clean = 0

    contracts = contracts_doc.get("contracts") or {}
    if not contracts:
        raise AuthorabilityReportError("topology contracts document has no contracts")

    for family, contract in sorted(contracts.items()):
        declared = contract.get("card_count")
        seen = 0
        for card in contract["per_card"]:
            cid = str(card["card_id"])
            cls = card.get("classification")
            if cls not in CLASSES:
                raise AuthorabilityReportError(f"{cid}: unknown classification {cls!r}")
            seen += 1
            family_total[family] += 1

            content_blockers: list[dict[str, Any]] = []
            if cls in CLASS_BLOCKER:
                reason, plan_class = CLASS_BLOCKER[cls]
                content_blockers.append({"reason": reason, "plan_rejection_class": plan_class})
            # FL-4162: the contract is the SINGLE owner of composite-vs-owned. When a
            # reviewed composite-ownership decision owned this card at the contract
            # boundary, the requirements doc's composite blocker is superseded (Law 1).
            owned_at_contract = bool(card.get("composite_owned_at_contract"))
            for blk in sorted(blockers_by_key.get(cid, set()) & set(CONTENT_BLOCKER_MAP)):
                if blk == "composite_layer_requires_family_contract" and owned_at_contract:
                    continue
                reason, plan_class = CONTENT_BLOCKER_MAP[blk]
                content_blockers.append({"reason": reason, "plan_rejection_class": plan_class})

            authorable = (cls == "owned") and not content_blockers
            if authorable:
                content_clean += 1
                family_clean[family] += 1
            for cb in content_blockers:
                reason_counts[cb["reason"]] += 1
                if cb["plan_rejection_class"]:
                    plan_class_counts[cb["plan_rejection_class"]] += 1

            layer_record = {
                "card_id": cid,
                "family": family,
                "classification": cls,
                "content_status": "content_clean" if authorable else "content_blocked",
                "content_blockers": content_blockers,
                "phase_gated": True,
            }
            # FL-4162: carry the contract's composite-ownership decision downstream so
            # the entries builder authors the single owned_role (not the multi-role list).
            if card.get("composite_owned_at_contract"):
                layer_record["composite_owned_at_contract"] = True
                layer_record["owned_role"] = card.get("owned_role")
                layer_record["original_composite_roles"] = card.get("original_composite_roles")
            layers.append(layer_record)
        if declared is not None and seen != declared:
            raise AuthorabilityReportError(
                f"{family}: covered {seen} layers but contract declares {declared}"
            )

    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": False,
        "surface_kind": "compiler_authorability_report",
        "recorded_at": "2026-06-18",
        "phase": "step_10a_report_only",
        "source_inputs": {
            "contracts": "docs/research/ascii/semantic_maps/family_topology_contracts.json",
            "requirements": "docs/research/ascii/semantic_maps/actor_visual_profile_requirements.json",
        },
        "non_authority_boundary": [
            "Report-only. Reads contracts/requirements; authors nothing.",
            "content_clean is NOT closure (Canon Law 16); it is gated by phase gates.",
            "No engine compiler change, no ActorVisualProfile rows, no runtime claim.",
        ],
        "phase_gates": list(PHASE_GATES),
        "phase_gates_note": (
            "These apply to ALL layers: the compiler is not wired, slots were never "
            "reviewed, there is no server-state join, no semantic-mask coverage, and "
            "no runtime proof. Nothing is runtime-authorable until they clear."
        ),
        "summary": {
            "total_layers": len(layers),
            "content_clean": content_clean,
            "content_blocked": len(layers) - content_clean,
            "content_blocked_by_reason": dict(reason_counts.most_common()),
            "blocked_by_plan_rejection_class": dict(sorted(plan_class_counts.items())),
            "per_family": {
                fam: {"total": family_total[fam], "content_clean": family_clean.get(fam, 0)}
                for fam in sorted(family_total)
            },
        },
        "layers": layers,
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
    parser.add_argument("--contracts", type=Path, default=DEFAULT_CONTRACTS)
    parser.add_argument("--requirements", type=Path, default=DEFAULT_REQUIREMENTS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        contracts = _load_json(args.contracts, "topology contracts")
        requirements = _load_json(args.requirements, "requirements")
        report = build_report(contracts, requirements)
    except AuthorabilityReportError as exc:
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
