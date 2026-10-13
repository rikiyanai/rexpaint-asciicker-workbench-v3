#!/usr/bin/env python3
"""Retract one false-clean FL-4162 full-cell decision and reopen review."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import build_upstream_xp_cell_review_queue as queue
import compare_upstream_xp_cell_contracts as comparison
import record_upstream_xp_cell_review_state_decision as review_state
import record_upstream_xp_layerwide_cell_decision as layerwide

REPO = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract"
DEFAULT_SIMILARITY = DEFAULT_LEDGER / "similarity_index.json"
DEFAULT_DECISIONS = DEFAULT_LEDGER / "cell_role_decisions.jsonl"
DEFAULT_REVIEW_STATES = DEFAULT_LEDGER / "cell_review_state_decisions.jsonl"


def canonical_sha256(value: dict[str, Any]) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def semantic_sets(decision: dict[str, Any]) -> list[list[str]]:
    values = {
        tuple(str(role) for role in span[6])
        for span in decision.get("cell_assignments") or []
        if isinstance(span, list) and len(span) == 7 and span[6]
    }
    return [list(value) for value in sorted(values)]


def validate_expected_active_decision(
    active: dict[str, Any], expected_sha256: str,
    expected_semantic_sets: list[str],
) -> str:
    active_hash = canonical_sha256(active)
    if active_hash != expected_sha256:
        raise queue.ReviewQueueError("active decision SHA-256 mismatch")
    expected_semantics = sorted(
        sorted(value.strip() for value in item.split(";") if value.strip())
        for item in expected_semantic_sets
    )
    actual_semantics = sorted(sorted(value) for value in semantic_sets(active))
    if actual_semantics != expected_semantics:
        raise queue.ReviewQueueError(
            f"active semantics mismatch expected={expected_semantics} "
            f"actual={actual_semantics}"
        )
    return active_hash


def build_retraction_state_decision(
    unit: dict[str, Any], active_decision: dict[str, Any], reason: str,
    evidence_refs: list[str], reviewer: str, reviewed_at: str,
) -> dict[str, Any]:
    if unit["decision_state"] != "needs_cell_semantic_confirmation":
        raise queue.ReviewQueueError(
            f"{unit['review_unit_id']}: false-clean retraction requires the original "
            "semantic-confirmation state"
        )
    if active_decision.get("review_unit_id") != unit["review_unit_id"]:
        raise queue.ReviewQueueError("active decision review-unit mismatch")
    if active_decision.get("source_layer_sha256") != unit["source_layer_sha256"]:
        raise queue.ReviewQueueError("active decision fingerprint mismatch")
    state_decision = review_state.build_decision(
        unit, "needs_cell_role_segmentation", reason, evidence_refs,
        reviewer, reviewed_at,
    )
    state_decision["review_provenance"].update({
        "retracted_full_cell_decision_sha256": canonical_sha256(active_decision),
        "retracted_assignment_spans": len(active_decision.get("cell_assignments") or []),
        "retracted_semantic_sets": semantic_sets(active_decision),
        "retracted_review_provenance": active_decision.get("review_provenance") or {},
    })
    return state_decision


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-key", required=True)
    parser.add_argument("--expected-decision-sha256", required=True)
    parser.add_argument("--expected-semantic-set", action="append", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--evidence-ref", action="append", required=True)
    parser.add_argument("--reviewer", default="codex_manual_source_review")
    parser.add_argument("--reviewed-at", default="2026-07-15")
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--similarity", type=Path, default=DEFAULT_SIMILARITY)
    parser.add_argument("--decisions", type=Path, default=DEFAULT_DECISIONS)
    parser.add_argument("--review-states", type=Path, default=DEFAULT_REVIEW_STATES)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        records = comparison.load_records(args.ledger)
        if args.source_key not in records:
            raise queue.ReviewQueueError(f"unknown source key: {args.source_key}")
        similarity = queue.load_similarity(args.similarity, set(records))
        raw_doc = queue.build_queue(records, similarity)
        unit = next(
            (value for value in raw_doc["review_units"]
             if args.source_key in value["member_source_keys"]),
            None,
        )
        if unit is None:
            raise queue.ReviewQueueError(f"no review unit for {args.source_key}")
        decisions = queue.load_decisions(args.decisions)
        active = decisions.get(unit["review_unit_id"])
        if active is None:
            raise queue.ReviewQueueError(
                f"{unit['review_unit_id']}: no active full-cell decision to retract"
            )
        active_hash = validate_expected_active_decision(
            active, args.expected_decision_sha256, args.expected_semantic_set
        )
        review_states = queue.load_review_state_decisions(args.review_states)
        if unit["review_unit_id"] in review_states:
            raise queue.ReviewQueueError(
                f"{unit['review_unit_id']}: review-state decision already exists"
            )
        retraction = build_retraction_state_decision(
            unit, active, args.reason, args.evidence_ref,
            args.reviewer, args.reviewed_at,
        )
        remaining = dict(decisions)
        del remaining[unit["review_unit_id"]]
        updated_states = dict(review_states)
        updated_states[unit["review_unit_id"]] = retraction
        final_doc = queue.build_queue(records, similarity)
        queue.apply_review_state_decisions(final_doc, updated_states)
        queue.apply_decisions(final_doc, remaining, records)
        reopened = next(
            value for value in final_doc["review_units"]
            if value["review_unit_id"] == unit["review_unit_id"]
        )
        if (
            reopened["decision_state"] != "needs_cell_role_segmentation"
            or reopened["decision_record"] is not None
        ):
            raise queue.ReviewQueueError("retracted unit did not reopen fail-closed")
        if not args.check:
            # Delete the active owner first. A crash after this point leaves the unit
            # unassigned, which is fail-closed, never false-clean.
            layerwide.atomic_write(
                args.decisions, [remaining[key] for key in sorted(remaining)]
            )
            review_state.atomic_write(
                args.review_states,
                [updated_states[key] for key in sorted(updated_states)],
            )
    except (comparison.ComparisonError, queue.ReviewQueueError, OSError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps({
        "retracted_unit": unit["review_unit_id"],
        "member_source_keys": unit["member_source_keys"],
        "retracted_decision_sha256": active_hash,
        "reopened_state": reopened["decision_state"],
        "coverage": final_doc["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
