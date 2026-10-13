#!/usr/bin/env python3
"""Record one fingerprint-bound manual FL-4162 queue-state decision."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import build_upstream_xp_cell_review_queue as queue
import compare_upstream_xp_cell_contracts as comparison

REPO = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract"
DEFAULT_SIMILARITY = DEFAULT_LEDGER / "similarity_index.json"
DEFAULT_OUT = DEFAULT_LEDGER / "cell_review_state_decisions.jsonl"


def build_decision(
    unit: dict[str, Any], target: str, decision_text: str,
    evidence_refs: list[str], reviewer: str, reviewed_at: str,
) -> dict[str, Any]:
    if unit["decision_state"] != "needs_cell_semantic_confirmation":
        raise queue.ReviewQueueError(
            f"{unit['review_unit_id']}: review-state recorder refuses {unit['decision_state']}"
        )
    if target not in queue.REVIEW_STATE_TARGETS:
        raise queue.ReviewQueueError(f"invalid review-state target: {target}")
    if not decision_text.strip() or not evidence_refs:
        raise queue.ReviewQueueError("review-state decision requires rationale and evidence")
    return {
        "schema": queue.REVIEW_STATE_DECISION_SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "source_decision_state": "needs_cell_semantic_confirmation",
        "target_decision_state": target,
        "review_provenance": {
            "reviewer": reviewer,
            "reviewed_at": reviewed_at,
            "evidence_refs": evidence_refs,
            "decision": decision_text,
            "reviewed_source_key": unit["representative_source_key"],
            "reviewed_candidate_role_sets": unit["candidate_role_sets"],
        },
    }


def atomic_write(path: Path, rows: list[dict[str, Any]]) -> None:
    data = b"".join(
        (json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode()
        for row in rows
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-key", required=True)
    parser.add_argument("--target", choices=sorted(queue.REVIEW_STATE_TARGETS), required=True)
    parser.add_argument("--decision", required=True)
    parser.add_argument("--evidence-ref", action="append", required=True)
    parser.add_argument("--reviewer", default="codex_manual_source_review")
    parser.add_argument("--reviewed-at", default="2026-07-14")
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--similarity", type=Path, default=DEFAULT_SIMILARITY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--cell-decisions", type=Path, default=queue.DEFAULT_DECISIONS)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        records = comparison.load_records(args.ledger)
        if args.source_key not in records:
            raise queue.ReviewQueueError(f"unknown source key: {args.source_key}")
        similarity = queue.load_similarity(args.similarity, set(records))
        review_doc = queue.build_queue(records, similarity)
        unit = next(
            (value for value in review_doc["review_units"]
             if args.source_key in value["member_source_keys"]),
            None,
        )
        if unit is None:
            raise queue.ReviewQueueError(f"no review unit for {args.source_key}")
        cell_decisions = queue.load_decisions(args.cell_decisions)
        if unit["review_unit_id"] in cell_decisions:
            raise queue.ReviewQueueError(
                f"{unit['review_unit_id']}: full-cell decision already exists"
            )
        decision = build_decision(
            unit, args.target, args.decision, args.evidence_ref,
            args.reviewer, args.reviewed_at,
        )
        merged = queue.load_review_state_decisions(args.out)
        merged[unit["review_unit_id"]] = decision
        final_doc = queue.build_queue(records, similarity)
        queue.apply_review_state_decisions(final_doc, merged)
        queue.apply_decisions(final_doc, cell_decisions, records)
        if not args.check:
            atomic_write(args.out, [merged[key] for key in sorted(merged)])
    except (comparison.ComparisonError, queue.ReviewQueueError, OSError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps({
        "recorded_unit": unit["review_unit_id"],
        "member_source_keys": unit["member_source_keys"],
        "target_decision_state": args.target,
        "coverage": final_doc["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
