#!/usr/bin/env python3
"""Record one manually reviewed layer-wide FL-4162 cell decision.

This command never infers a semantic role. The reviewer supplies the semantic
contribution after inspecting the raw layer. It deliberately refuses composite
segmentation units; those require coordinate-specific review.
"""
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
DEFAULT_OUT = DEFAULT_LEDGER / "cell_role_decisions.jsonl"
SCHEMA = "fl4162.upstream_xp_cell_role_decision.v2"


def _compress(
    by_coordinate: dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]]
) -> list[list[Any]]:
    rows: dict[tuple[int, int, int], list[tuple[int, tuple[str, tuple[str, ...]]]]] = {}
    for (angle, frame, y, x), assignment in by_coordinate.items():
        rows.setdefault((angle, frame, y), []).append((x, assignment))
    out: list[list[Any]] = []
    for (angle, frame, y), cells in sorted(rows.items()):
        cells.sort()
        start = previous = cells[0][0]
        operation, semantics = cells[0][1]
        for x, assignment in cells[1:]:
            if x != previous + 1 or assignment != (operation, semantics):
                out.append([
                    angle, frame, y, start, previous - start + 1,
                    operation, list(semantics),
                ])
                start = x
                operation, semantics = assignment
            previous = x
        out.append([
            angle, frame, y, start, previous - start + 1,
            operation, list(semantics),
        ])
    return out


def build_decision(
    unit: dict[str, Any], record: dict[str, Any], semantics: list[str],
    decision_text: str, evidence_refs: list[str], exceptions: list[str],
    reviewer: str, reviewed_at: str,
) -> dict[str, Any]:
    if unit["decision_state"] != "needs_cell_semantic_confirmation":
        raise queue.ReviewQueueError(
            f"{unit['review_unit_id']}: layer-wide recorder refuses {unit['decision_state']}"
        )
    semantics = list(dict.fromkeys(value.strip() for value in semantics if value.strip()))
    if not semantics:
        raise queue.ReviewQueueError("at least one reviewed semantic contribution is required")
    cells = comparison.expand_cells(record)
    assignments = {
        coordinate: (
            str(value["render_operation"]),
            () if value.get("cell_type") == "transparent" else tuple(semantics),
        )
        for coordinate, value in cells.items()
    }
    operations = sorted({value[0] for value in assignments.values()})
    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "cell_assignments": _compress(assignments),
        "composition_review": {
            "engine_rule": ";".join(operations),
            "verified_against_upstream_ref": True,
            "effect_on_l2_accumulator": ";".join(operations),
        },
        "exceptions": exceptions,
        "review_provenance": {
            "reviewer": reviewer,
            "reviewed_at": reviewed_at,
            "evidence_refs": evidence_refs,
            "decision": decision_text,
            "reviewed_source_key": record["source_key"],
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
    parser.add_argument("--semantic", action="append", required=True)
    parser.add_argument("--decision", required=True)
    parser.add_argument("--evidence-ref", action="append", required=True)
    parser.add_argument("--exception", action="append", default=[])
    parser.add_argument("--reviewer", default="codex_manual_source_review")
    parser.add_argument("--reviewed-at", default="2026-07-15")
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--similarity", type=Path, default=DEFAULT_SIMILARITY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        records = comparison.load_records(args.ledger)
        if args.source_key not in records:
            raise queue.ReviewQueueError(f"unknown source key: {args.source_key}")
        similarity = queue.load_similarity(args.similarity, set(records))
        review_doc = queue.build_queue(records, similarity)
        existing = queue.load_decisions(args.out)
        queue.apply_decisions(review_doc, existing, records)
        unit = next(
            (value for value in review_doc["review_units"]
             if args.source_key in value["member_source_keys"]),
            None,
        )
        if unit is None:
            raise queue.ReviewQueueError(f"no review unit for {args.source_key}")
        decision = build_decision(
            unit, records[args.source_key], args.semantic, args.decision,
            args.evidence_ref, args.exception, args.reviewer, args.reviewed_at,
        )
        merged = dict(existing)
        merged[unit["review_unit_id"]] = decision
        final_doc = queue.build_queue(records, similarity)
        queue.apply_decisions(final_doc, merged, records)
        if not args.check:
            atomic_write(args.out, [merged[key] for key in sorted(merged)])
    except (comparison.ComparisonError, queue.ReviewQueueError, OSError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps({
        "recorded_unit": unit["review_unit_id"],
        "member_source_keys": unit["member_source_keys"],
        "semantic_contributions": args.semantic,
        "coverage": final_doc["coverage"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
