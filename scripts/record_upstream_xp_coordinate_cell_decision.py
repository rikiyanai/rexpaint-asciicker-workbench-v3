#!/usr/bin/env python3
"""Record one manually segmented FL-4162 full-cell decision."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import build_upstream_xp_cell_review_queue as queue
import compare_upstream_xp_cell_contracts as comparison
import record_upstream_xp_layerwide_cell_decision as layerwide

REPO = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract"
DEFAULT_SIMILARITY = DEFAULT_LEDGER / "similarity_index.json"
DEFAULT_OUT = DEFAULT_LEDGER / "cell_role_decisions.jsonl"
INPUT_SCHEMA = "fl4162.upstream_xp_coordinate_assignment_input.v1"


def load_assignment(path: Path) -> dict[str, Any]:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise queue.ReviewQueueError(f"cannot read coordinate assignment: {exc}") from exc
    if doc.get("schema") != INPUT_SCHEMA:
        raise queue.ReviewQueueError("coordinate assignment has wrong schema")
    if not isinstance(doc.get("semantic_spans"), list):
        raise queue.ReviewQueueError("coordinate assignment lacks semantic_spans")
    return doc


def _expand_semantic_spans(
    spans: list[Any],
) -> dict[tuple[int, int, int, int], tuple[str, ...]]:
    assigned: dict[tuple[int, int, int, int], tuple[str, ...]] = {}
    for span in spans:
        if not isinstance(span, list) or len(span) != 6:
            raise queue.ReviewQueueError("coordinate assignment contains malformed span")
        angle, frame, y, x_start, length = (int(value) for value in span[:5])
        semantics = span[5]
        if (
            length < 1
            or not isinstance(semantics, list)
            or not semantics
            or not all(isinstance(role, str) and role.strip() for role in semantics)
        ):
            raise queue.ReviewQueueError("coordinate assignment span has invalid semantics")
        normalized = tuple(dict.fromkeys(role.strip() for role in semantics))
        for x in range(x_start, x_start + length):
            coordinate = (angle, frame, y, x)
            if coordinate in assigned:
                raise queue.ReviewQueueError(
                    f"coordinate assignment overlaps coordinate {coordinate}"
                )
            assigned[coordinate] = normalized
    return assigned


def build_whole_visible_assignment(
    unit: dict[str, Any], record: dict[str, Any], semantics: list[str],
    source_xp_path: str, contract_decision: str,
) -> dict[str, Any]:
    """Expand one manually reviewed source-contract role over every visible cell.

    This is deliberately unavailable to segmentation units. It performs no role
    inference: the reviewer supplies the semantic contribution after confirming
    that the complete raw layer has one semantic role.
    """
    if unit["decision_state"] != "needs_source_contract":
        raise queue.ReviewQueueError(
            f"{unit['review_unit_id']}: whole-visible mode is source-contract-only"
        )
    normalized = tuple(dict.fromkeys(value.strip() for value in semantics if value.strip()))
    if not normalized:
        raise queue.ReviewQueueError("whole-visible mode requires a reviewed semantic")
    expected_path = str((record.get("source_xp") or {}).get("path") or "")
    if source_xp_path != expected_path:
        raise queue.ReviewQueueError("source-contract XP path mismatch")
    if not contract_decision.strip():
        raise queue.ReviewQueueError("source-contract decision is missing")
    visible_by_row: dict[tuple[int, int, int], list[int]] = {}
    for coordinate, value in comparison.expand_cells(record).items():
        if value.get("cell_type") == "transparent":
            continue
        angle, frame, y, x = coordinate
        visible_by_row.setdefault((angle, frame, y), []).append(x)
    spans: list[list[Any]] = []
    for (angle, frame, y), xs in sorted(visible_by_row.items()):
        xs.sort()
        start = previous = xs[0]
        for x in xs[1:]:
            if x != previous + 1:
                spans.append([
                    angle, frame, y, start, previous - start + 1, list(normalized)
                ])
                start = x
            previous = x
        spans.append([
            angle, frame, y, start, previous - start + 1, list(normalized)
        ])
    return {
        "schema": INPUT_SCHEMA,
        "source_key": record["source_key"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "semantic_spans": spans,
        "source_contract": {
            "source_xp_path": source_xp_path,
            "contract_decision": contract_decision.strip(),
        },
    }


def build_decision(
    unit: dict[str, Any], record: dict[str, Any], assignment: dict[str, Any],
    decision_text: str, evidence_refs: list[str], exceptions: list[str],
    reviewer: str, reviewed_at: str,
) -> dict[str, Any]:
    if unit["decision_state"] not in {
        "needs_cell_role_segmentation", "needs_source_contract",
    }:
        raise queue.ReviewQueueError(
            f"{unit['review_unit_id']}: coordinate recorder refuses {unit['decision_state']}"
        )
    if assignment.get("source_key") != record["source_key"]:
        raise queue.ReviewQueueError("coordinate assignment source_key mismatch")
    if assignment.get("source_layer_sha256") != unit["source_layer_sha256"]:
        raise queue.ReviewQueueError("coordinate assignment source fingerprint mismatch")
    source_contract = assignment.get("source_contract")
    if unit["decision_state"] == "needs_source_contract":
        if not isinstance(source_contract, dict):
            raise queue.ReviewQueueError("source-contract unit requires source_contract")
        if source_contract.get("source_xp_path") != record["source_xp"]["path"]:
            raise queue.ReviewQueueError("source-contract XP path mismatch")
        if not source_contract.get("contract_decision"):
            raise queue.ReviewQueueError("source-contract decision is missing")

    expected_cells = comparison.expand_cells(record)
    visible = {
        coordinate for coordinate, value in expected_cells.items()
        if value.get("cell_type") != "transparent"
    }
    semantic_by_coordinate = _expand_semantic_spans(assignment["semantic_spans"])
    assigned = set(semantic_by_coordinate)
    if assigned != visible:
        raise queue.ReviewQueueError(
            f"coordinate semantic coverage mismatch missing={len(visible-assigned)} "
            f"extra={len(assigned-visible)}"
        )
    assignments = {
        coordinate: (
            str(value["render_operation"]),
            semantic_by_coordinate.get(coordinate, ()),
        )
        for coordinate, value in expected_cells.items()
    }
    operations = sorted({value[0] for value in assignments.values()})
    provenance = {
        "reviewer": reviewer,
        "reviewed_at": reviewed_at,
        "evidence_refs": evidence_refs,
        "decision": decision_text,
        "reviewed_source_key": record["source_key"],
        "reviewed_candidate_role_sets": unit["candidate_role_sets"],
        "assignment_input_schema": INPUT_SCHEMA,
    }
    if source_contract is not None:
        provenance["source_contract"] = source_contract
    return {
        "schema": layerwide.SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "cell_assignments": layerwide._compress(assignments),
        "composition_review": {
            "engine_rule": ";".join(operations),
            "verified_against_upstream_ref": True,
            "effect_on_l2_accumulator": ";".join(operations),
        },
        "exceptions": exceptions,
        "review_provenance": provenance,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--assignment", type=Path)
    mode.add_argument("--source-key")
    parser.add_argument("--whole-visible-semantic", action="append", default=[])
    parser.add_argument("--source-contract-path", default="")
    parser.add_argument("--source-contract-decision", default="")
    parser.add_argument("--decision", required=True)
    parser.add_argument("--evidence-ref", action="append", required=True)
    parser.add_argument("--exception", action="append", default=[])
    parser.add_argument("--reviewer", default="codex_manual_source_review")
    parser.add_argument("--reviewed-at", default="2026-07-15")
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--similarity", type=Path, default=DEFAULT_SIMILARITY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--review-state-decisions", type=Path,
        default=queue.DEFAULT_REVIEW_STATE_DECISIONS,
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        assignment = load_assignment(args.assignment) if args.assignment is not None else None
        source_key = (
            str(assignment.get("source_key") or "")
            if assignment is not None else str(args.source_key or "")
        )
        records = comparison.load_records(args.ledger)
        if source_key not in records:
            raise queue.ReviewQueueError(f"unknown source key: {source_key}")
        similarity = queue.load_similarity(args.similarity, set(records))
        review_doc = queue.build_queue(records, similarity)
        queue.apply_review_state_decisions(
            review_doc, queue.load_review_state_decisions(args.review_state_decisions)
        )
        existing = queue.load_decisions(args.out)
        queue.apply_decisions(review_doc, existing, records)
        unit = next(
            (value for value in review_doc["review_units"]
             if source_key in value["member_source_keys"]),
            None,
        )
        if unit is None:
            raise queue.ReviewQueueError(f"no review unit for {source_key}")
        if unit["decision_record"] is not None:
            raise queue.ReviewQueueError(
                f"{unit['review_unit_id']}: full-cell decision already exists"
            )
        if assignment is None:
            assignment = build_whole_visible_assignment(
                unit,
                records[source_key],
                args.whole_visible_semantic,
                args.source_contract_path,
                args.source_contract_decision,
            )
        elif (
            args.whole_visible_semantic
            or args.source_contract_path
            or args.source_contract_decision
        ):
            raise queue.ReviewQueueError(
                "whole-visible source-contract flags cannot accompany --assignment"
            )
        decision = build_decision(
            unit, records[source_key], assignment, args.decision,
            args.evidence_ref, args.exception, args.reviewer, args.reviewed_at,
        )
        merged = dict(existing)
        merged[unit["review_unit_id"]] = decision
        final_doc = queue.build_queue(records, similarity)
        queue.apply_review_state_decisions(
            final_doc, queue.load_review_state_decisions(args.review_state_decisions)
        )
        queue.apply_decisions(final_doc, merged, records)
        if not args.check:
            layerwide.atomic_write(args.out, [merged[key] for key in sorted(merged)])
    except (comparison.ComparisonError, queue.ReviewQueueError, OSError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps({
        "recorded_unit": unit["review_unit_id"],
        "member_source_keys": unit["member_source_keys"],
        "semantic_spans": len(assignment["semantic_spans"]),
        "coverage": final_doc["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
