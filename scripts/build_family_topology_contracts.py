#!/usr/bin/env python3
"""FL-4162 step 9d — family topology contracts derived from the reviewed packet.

One contract per actor family (player, attack, plydie, bigbee, wolfie, wolack).
A contract is a PROPOSAL surface (authority:false). It records, per family:

  * layer_structure   — L0/L1 are upstream metadata (not in the card corpus, which
                        starts at the L2 base). L2 is the engine-fixed base
                        accumulator. L3..Lmax are overlays.
  * overlay_role_binding — the canonical truth that an overlay's ROLE is bound by
                        the AHSW variant, NOT by its layer index. The same overlay
                        index carries different roles across variants; a contract
                        that pins "L4 = crossbow" would be wrong. Evidence: the
                        per-index observed role spread.
  * per_card          — every visible raw layer classified into EXACTLY ONE of:
                        owned | composite | rejected | unresolved.
  * role_name_conflicts — byte-identical layers (pixel identity) that received two
                        different role NAMES in the hand corpus (e.g. helmet vs
                        player_helmet_regular). Pixel identity is code-level proof
                        they are the same role; the canonical NAME is a human pick,
                        recorded here as unresolved-canonical, never auto-chosen.

Classification rule (card-level, from the recorded agent verdict — never re-derived
from glyphs, per [[feedback_no_glyph_classifier_from_cooccurrence]]):
  unresolved              -> verdict.unresolved is True
  rejected (fragment)     -> a proposed role starts with 'composite_source:'
                             (a non-standalone context fragment, not an owner)
  composite               -> supported with >1 proposed role
  owned                   -> supported with exactly 1 proposed role

Authority: NONE. This does not author ActorVisualProfile rows or feed a compiler.
Canon Law 16: a contract proposal is not closure.

Fail-closed (Canon Law 6): if any visible card fails to land in exactly one of the
four classes, build_contracts raises. validate_contracts re-checks completeness
against the packet independently and raises on any gap.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import build_contradiction_report as cr

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
DEFAULT_PACKET = SM / "manual_candidate_review.json"
DEFAULT_OUT = SM / "family_topology_contracts.json"
# FL-4162: reviewed composite-ownership decisions consumed at THIS build boundary.
# Reclassifies a composite source layer to 'owned' without touching the hand
# evidence. authority:false; fail-closed (see _apply_composite_decision).
DEFAULT_COMPOSITE_DECISIONS = SM / "composite_ownership_decisions.json"
SCHEMA = "family_topology_contracts/v1"
FAMILIES = ("attack", "bigbee", "player", "plydie", "wolack", "wolfie")
CLASSES = ("owned", "composite", "rejected", "unresolved")


class TopologyContractError(Exception):
    """FL-4162: topology contract could not be built/validated fail-closed."""


def _roles(row: dict[str, Any]) -> list[str]:
    return list((row.get("agent_verdict") or {}).get("proposed_roles") or [])


def classify_card(row: dict[str, Any]) -> str:
    verdict = row.get("agent_verdict") or {}
    roles = _roles(row)
    if verdict.get("unresolved"):
        return "unresolved"
    if any(str(r).startswith("composite_source:") for r in roles):
        return "rejected"
    if verdict.get("supported") and len(roles) > 1:
        return "composite"
    if verdict.get("supported") and len(roles) == 1:
        return "owned"
    # Supported=False but not flagged unresolved, or empty roles while supported:
    # fail closed rather than guess a class.
    raise TopologyContractError(
        f"{row.get('card_id')}: card does not land in a topology class "
        f"(supported={verdict.get('supported')}, unresolved={verdict.get('unresolved')}, "
        f"roles={roles})"
    )


def load_composite_decisions(path: Path | None) -> dict[str, dict[str, Any]]:
    """FL-4162: index reviewed composite-ownership decisions by source_key.

    Returns {} when the artifact is absent (req 3: missing decision keeps the
    composite blocker). authority:false is required (req 1)."""
    if path is None or not Path(path).is_file():
        return {}
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    if doc.get("authority") is not False:
        raise TopologyContractError(
            f"{path}: composite-ownership decisions must be authority:false (FL-4162 req 1)")
    out: dict[str, dict[str, Any]] = {}
    for dec in doc.get("decisions", []):
        sk = str(dec["source_key"])
        if sk in out:
            raise TopologyContractError(f"composite-ownership: duplicate decision for {sk}")
        out[sk] = dec
    return out


def _apply_composite_decision(
    row: dict[str, Any], base_cls: str,
    decisions: dict[str, dict[str, Any]], consumed: set[str],
) -> tuple[str, dict[str, Any]]:
    """FL-4162: at the contract boundary, a reviewed decision may reclassify a
    composite source layer to 'owned', preserving original roles as provenance.

    Fail-closed reviewer requirements:
      req 5/6 — only a 'composite' row may be changed (never owned/rejected/unresolved)
      req 2/4 — fingerprint-bound; mismatch fails closed
      req 3   — a missing decision leaves the composite blocker in place
      drift   — asserted original roles must equal the evidence roles exactly
    """
    sk = str(row.get("source_key") or row.get("card_id"))
    dec = decisions.get(sk)
    if dec is None:
        return base_cls, {}
    if base_cls != "composite":
        raise TopologyContractError(
            f"{sk}: composite-ownership decision targets a {base_cls!r} row; only "
            f"composite rows may be owned via this artifact (FL-4162 req 5/6)")
    fp = str(row.get("whole_atlas_fingerprint"))
    if str(dec.get("whole_atlas_fingerprint")) != fp:
        raise TopologyContractError(
            f"{sk}: composite-ownership decision fingerprint mismatch "
            f"(evidence {fp[:12]}.. vs decision {str(dec.get('whole_atlas_fingerprint'))[:12]}..) "
            f"- failing closed (FL-4162 req 4)")
    roles = sorted(_roles(row))
    if sorted(dec.get("asserted_original_roles") or []) != roles:
        raise TopologyContractError(
            f"{sk}: composite-ownership decision asserted roles "
            f"{dec.get('asserted_original_roles')} != evidence roles {roles} "
            f"- failing closed (FL-4162)")
    consumed.add(sk)
    provenance = {
        "composite_owned_at_contract": True,
        "original_composite_roles": roles,
        "owned_role": dec.get("owned_role"),
        "decision_fingerprint": fp,
    }
    return "owned", provenance


def _family_conflicts(report: dict[str, Any], family: str) -> list[dict[str, Any]]:
    out = []
    for conflict in report.get("glyph_exact_conflicts", []):
        members = [m for m in conflict["members"]
                   if str(m.get("card_id", "")).startswith(family + "-")]
        if len(members) >= 2 or (members and conflict["members"] != members):
            # Conflict touches this family. Keep the full member list for context.
            out.append({
                "whole_atlas_fingerprint": conflict["whole_atlas_fingerprint"],
                "distinct_role_sets": conflict["distinct_role_sets"],
                "members": conflict["members"],
                "resolution": "unresolved_canonical_name",
                "note": ("byte-identical layers carry different role NAMES; pixel "
                         "identity proves same role, canonical name is a human pick"),
            })
    return out


def build_contracts(packet: dict[str, Any],
                    decisions: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    rows = packet["reviewed"]
    report = cr.build_report(packet)
    decisions = decisions or {}
    consumed: set[str] = set()
    composite_owned_count = 0

    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_family[str(row.get("family"))].append(row)

    contracts: dict[str, Any] = {}
    grand = Counter()
    for family in sorted(by_family):
        fam_rows = by_family[family]
        per_card = []
        class_counts = Counter()
        overlay_indices = set()
        base_indices = set()
        index_roles: dict[int, Counter] = defaultdict(Counter)
        for row in sorted(fam_rows, key=lambda r: str(r.get("card_id"))):
            base_cls = classify_card(row)
            # FL-4162: a reviewed composite-ownership decision may reclassify a
            # composite row to 'owned' here (fail-closed; evidence untouched).
            cls, provenance = _apply_composite_decision(row, base_cls, decisions, consumed)
            if provenance:
                composite_owned_count += 1
            class_counts[cls] += 1
            grand[cls] += 1
            li = row.get("raw_layer_index")
            is_overlay = bool(row.get("engine_is_overlay"))
            (overlay_indices if is_overlay else base_indices).add(li)
            for role in _roles(row):
                index_roles[li][role] += 1
            entry = {
                "card_id": row.get("card_id"),
                "ahsw": row.get("ahsw"),
                "raw_layer_index": li,
                "engine_is_overlay": is_overlay,
                "engine_fixed_role": row.get("engine_fixed_role"),
                "classification": cls,
                "proposed_roles": _roles(row),
                "queue_class": row.get("queue_class"),
            }
            entry.update(provenance)
            per_card.append(entry)

        # Evidence that overlay role is variant-dependent: any overlay index whose
        # observed roles span more than one distinct role across variants.
        variant_dependent = sorted(
            li for li in overlay_indices if len(index_roles[li]) > 1
        )

        total = sum(class_counts.values())
        if total != len(fam_rows):
            raise TopologyContractError(
                f"{family}: classified {total} of {len(fam_rows)} cards"
            )

        contracts[family] = {
            "family": family,
            "card_count": len(fam_rows),
            "layer_structure": {
                "l0_l1": "upstream metadata layers (column-major), not in card corpus",
                "base_accumulator_indices": sorted(base_indices),
                "overlay_indices": sorted(overlay_indices),
                "overlay_ordinal_max": max(overlay_indices) if overlay_indices else None,
            },
            "overlay_role_binding": {
                "rule": "overlay role is bound by AHSW variant, NOT by layer index",
                "variant_dependent_overlay_indices": variant_dependent,
                "per_index_observed_roles": {
                    str(li): dict(sorted(index_roles[li].items()))
                    for li in sorted(index_roles)
                },
            },
            "class_counts": {c: class_counts.get(c, 0) for c in CLASSES},
            "role_name_conflicts": _family_conflicts(report, family),
            "per_card": per_card,
        }

    # FL-4162: every composite-ownership decision MUST have matched a composite row.
    # An unmatched decision means a wrong source_key or drifted evidence -> fail closed.
    unconsumed = sorted(set(decisions) - consumed)
    if unconsumed:
        raise TopologyContractError(
            f"composite-ownership decisions not matched to any composite row: "
            f"{unconsumed} (FL-4162 - wrong source_key or evidence drift)")

    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "surface_kind": "family_topology_contracts",
        "composite_owned_at_contract_count": composite_owned_count,
        "recorded_at": "2026-06-18",
        "source_packet": "docs/research/ascii/semantic_maps/manual_candidate_review.json",
        "non_authority_boundary": [
            "Family topology proposal only.",
            "Overlay role is AHSW-variant-bound, not index-fixed.",
            "Role-name conflicts await a human canonical pick (Canon Law 16).",
            "Does not author ActorVisualProfile rows or feed a compiler.",
        ],
        "classes": list(CLASSES),
        "summary": {
            "families": len(contracts),
            "total_cards": sum(grand.values()),
            "class_counts": {c: grand.get(c, 0) for c in CLASSES},
        },
        "contracts": contracts,
    }


def validate_contracts(contracts_doc: dict[str, Any], packet: dict[str, Any]) -> dict[str, Any]:
    """Independent re-check: every visible card is covered by exactly one class."""
    rows = packet["reviewed"]
    expected_ids = {str(r.get("card_id")) for r in rows}

    seen_ids: set[str] = set()
    duplicates: list[str] = []
    unclassified: list[str] = []
    per_family_ok: dict[str, bool] = {}

    for family, contract in contracts_doc["contracts"].items():
        fam_total = 0
        for card in contract["per_card"]:
            cid = str(card["card_id"])
            if cid in seen_ids:
                duplicates.append(cid)
            seen_ids.add(cid)
            if card["classification"] not in CLASSES:
                unclassified.append(cid)
            fam_total += 1
        per_family_ok[family] = (fam_total == contract["card_count"])

    missing = sorted(expected_ids - seen_ids)
    extra = sorted(seen_ids - expected_ids)
    ok = not (missing or extra or duplicates or unclassified) and all(per_family_ok.values())

    result = {
        "ok": ok,
        "expected_cards": len(expected_ids),
        "covered_cards": len(seen_ids),
        "missing_cards": missing,
        "extra_cards": extra,
        "duplicate_cards": sorted(set(duplicates)),
        "unclassified_cards": sorted(set(unclassified)),
        "per_family_count_ok": per_family_ok,
    }
    if not ok:
        raise TopologyContractError(f"topology contract validation FAILED: {json.dumps(result)}")
    return result


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
    parser.add_argument("--composite-decisions", type=Path, default=DEFAULT_COMPOSITE_DECISIONS,
                        help="FL-4162 reviewed composite-ownership decisions (authority:false); "
                             "absent file => no composite is owned")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--validate", action="store_true",
                        help="re-check completeness against the packet and print the result")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        packet = cr.load_packet(args.packet)
        decisions = load_composite_decisions(args.composite_decisions)
        contracts = build_contracts(packet, decisions)
        validation = validate_contracts(contracts, packet)
    except (cr.ContradictionReportError, TopologyContractError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    if args.validate:
        print(json.dumps(validation, indent=2, sort_keys=True))
        return 0
    text = dump_json(contracts)
    if args.write:
        atomic_write_text(args.out, text)
        print(f"wrote {args.out}")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
