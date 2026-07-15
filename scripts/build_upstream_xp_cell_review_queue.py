#!/usr/bin/env python3
"""Build the fail-closed FL-4162 / RQ-200 unique-layer review queue."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import compare_upstream_xp_cell_contracts as comparison

REPO = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract"
DEFAULT_SIMILARITY = DEFAULT_LEDGER / "similarity_index.json"
DEFAULT_DECISIONS = DEFAULT_LEDGER / "cell_role_decisions.jsonl"
DEFAULT_OUT = DEFAULT_LEDGER / "review_queue.json"
SCHEMA = "fl4162.upstream_xp_cell_review_queue.v2"

STATE_PRIORITY = {
    "engine_metadata_semantics_unverified": 0,
    "rejected_fragment_needs_contract": 0,
    "reviewed_composite_cell_assignment_pending": 1,
    "layer_role_reviewed_cell_semantics_unverified": 2,
}


class ReviewQueueError(RuntimeError):
    pass


def load_similarity(path: Path, expected_keys: set[str]) -> dict[str, dict[str, Any]]:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReviewQueueError(f"cannot read similarity index: {exc}") from exc
    if doc.get("authority") is not False or doc.get("is_proposal") is not True:
        raise ReviewQueueError("similarity index must be authority:false and proposal-only")
    rows = doc.get("rankings") or []
    by_key = {str(row.get("source_key") or ""): row for row in rows}
    if "" in by_key or len(by_key) != len(rows):
        raise ReviewQueueError("similarity index has missing or duplicate source keys")
    if set(by_key) != expected_keys:
        raise ReviewQueueError("similarity index source keys do not match the ledger")
    return by_key


def load_decisions(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    decisions: dict[str, dict[str, Any]] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ReviewQueueError(f"cannot read cell decisions: {exc}") from exc
    for lineno, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as exc:
            raise ReviewQueueError(f"cell decisions line {lineno}: malformed JSON: {exc}") from exc
        unit_id = str(row.get("review_unit_id") or "")
        if not unit_id or unit_id in decisions:
            raise ReviewQueueError(f"cell decisions line {lineno}: missing or duplicate review_unit_id")
        decisions[unit_id] = row
    return decisions


def _assignment_coordinates(
    assignments: list[Any],
) -> dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]]:
    coordinates: dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]] = {}
    for assignment in assignments:
        if not isinstance(assignment, list) or len(assignment) != 7:
            raise ReviewQueueError("cell decision contains malformed assignment")
        angle, frame, y, x_start, length = (int(value) for value in assignment[:5])
        render_operation = assignment[5]
        semantic_contributions = assignment[6]
        if (
            length < 1
            or not isinstance(render_operation, str)
            or not render_operation
            or not isinstance(semantic_contributions, list)
            or not all(isinstance(role, str) and role for role in semantic_contributions)
        ):
            raise ReviewQueueError("cell decision assignment has invalid operation or semantics")
        for x in range(x_start, x_start + length):
            coordinate = (angle, frame, y, x)
            if coordinate in coordinates:
                raise ReviewQueueError(f"cell decision overlaps coordinate {coordinate}")
            coordinates[coordinate] = (render_operation, tuple(semantic_contributions))
    return coordinates


def apply_decisions(
    doc: dict[str, Any], decisions: dict[str, dict[str, Any]],
    records: dict[str, dict[str, Any]],
) -> None:
    units = {unit["review_unit_id"]: unit for unit in doc["review_units"]}
    unknown = sorted(set(decisions) - set(units))
    if unknown:
        raise ReviewQueueError(f"cell decisions reference unknown review units: {unknown}")
    for unit_id, decision in decisions.items():
        unit = units[unit_id]
        if decision.get("schema") != "fl4162.upstream_xp_cell_role_decision.v2":
            raise ReviewQueueError(f"{unit_id}: wrong decision schema")
        if decision.get("authority") is not False or decision.get("is_proposal") is not True:
            raise ReviewQueueError(f"{unit_id}: decision must be authority:false proposal")
        if decision.get("source_layer_sha256") != unit["source_layer_sha256"]:
            raise ReviewQueueError(f"{unit_id}: source layer fingerprint mismatch")
        if decision.get("frame_geometry") != unit["frame_geometry"]:
            raise ReviewQueueError(f"{unit_id}: frame geometry mismatch")
        if sorted(decision.get("member_source_keys") or []) != unit["member_source_keys"]:
            raise ReviewQueueError(f"{unit_id}: exact-match member set mismatch")
        representative = records[unit["representative_source_key"]]
        expected_cells = comparison.expand_cells(representative)
        expected = set(expected_cells)
        assigned = _assignment_coordinates(decision.get("cell_assignments") or [])
        assigned_coordinates = set(assigned)
        if assigned_coordinates != expected:
            raise ReviewQueueError(
                f"{unit_id}: assignment coverage mismatch missing={len(expected-assigned_coordinates)} "
                f"extra={len(assigned_coordinates-expected)}"
            )
        for coordinate, value in expected_cells.items():
            operation, semantics = assigned[coordinate]
            if operation != value.get("render_operation"):
                raise ReviewQueueError(f"{unit_id}: render operation mismatch at {coordinate}")
            transparent = value.get("cell_type") == "transparent"
            if transparent and semantics:
                raise ReviewQueueError(f"{unit_id}: transparent cell has semantic claim at {coordinate}")
            if not transparent and not semantics:
                raise ReviewQueueError(f"{unit_id}: visible cell lacks semantic contribution at {coordinate}")
        composition = decision.get("composition_review") or {}
        if composition.get("verified_against_upstream_ref") is not True:
            raise ReviewQueueError(f"{unit_id}: upstream composition review not verified")
        provenance = decision.get("review_provenance") or {}
        if not provenance.get("evidence_refs") or not provenance.get("decision"):
            raise ReviewQueueError(f"{unit_id}: review provenance incomplete")
        unit["decision_record"] = {
            "schema": decision["schema"],
            "decision": provenance["decision"],
            "reviewer": provenance.get("reviewer"),
            "reviewed_at": provenance.get("reviewed_at"),
            "evidence_refs": provenance["evidence_refs"],
            "assignment_spans": len(decision["cell_assignments"]),
            "assigned_coordinates": len(assigned_coordinates),
        }
    decided = sum(unit["decision_record"] is not None for unit in doc["review_units"])
    doc["coverage"]["decided_units"] = decided
    doc["coverage"]["pending_units"] = len(doc["review_units"]) - decided
    doc["freeze_gate"]["ready"] = decided == len(doc["review_units"])
    if doc["freeze_gate"]["ready"]:
        doc["freeze_gate"]["reason"] = "every unique layer unit has a reviewed full-cell decision"


def _geometry_key(record: dict[str, Any]) -> str:
    return json.dumps(record["frame_geometry"], sort_keys=True, separators=(",", ":"))


def _unit_id(raw_sha: str, geometry_key: str) -> str:
    geometry_sha = hashlib.sha256(geometry_key.encode()).hexdigest()[:12]
    return f"xp-cell-unit:{raw_sha[:20]}:{geometry_sha}"


def _decision_state(review_states: set[str]) -> str:
    if "engine_metadata_semantics_unverified" in review_states:
        return "needs_engine_metadata_cell_confirmation"
    if "rejected_fragment_needs_contract" in review_states:
        return "needs_source_contract"
    if "reviewed_composite_cell_assignment_pending" in review_states:
        return "needs_cell_role_segmentation"
    return "needs_cell_semantic_confirmation"


def build_queue(
    records: dict[str, dict[str, Any]], similarity: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records.values():
        state = record["layer_semantics"]["review_state"]
        if state not in STATE_PRIORITY:
            raise ReviewQueueError(f"unknown review state: {state}")
        groups.setdefault(
            (record["source_xp"]["raw_layer_sha256"], _geometry_key(record)), []
        ).append(record)

    units = []
    covered_keys: list[str] = []
    for (raw_sha, geometry_key), members in groups.items():
        members.sort(key=lambda row: row["source_key"])
        covered_keys.extend(row["source_key"] for row in members)
        review_states = {row["layer_semantics"]["review_state"] for row in members}
        topology_classes = {row["layer_semantics"]["topology_class"] for row in members}
        representative = min(
            members,
            key=lambda row: (
                STATE_PRIORITY[row["layer_semantics"]["review_state"]],
                row["source_key"],
            ),
        )
        representative_key = representative["source_key"]
        units.append({
            "review_unit_id": _unit_id(raw_sha, geometry_key),
            "priority": min(STATE_PRIORITY[state] for state in review_states) + 1,
            "decision_state": _decision_state(review_states),
            "source_layer_sha256": raw_sha,
            "frame_geometry": representative["frame_geometry"],
            "representative_source_key": representative_key,
            "member_source_keys": [row["source_key"] for row in members],
            "exact_duplicate_layer_count": len(members),
            "families": sorted({row["family"] for row in members}),
            "raw_layer_indices": sorted({row["raw_layer_index"] for row in members}),
            "hand_statuses": sorted({row["hand_evidence"]["status"] for row in members}),
            "topology_classes": sorted(topology_classes),
            "candidate_role_sets": sorted({
                ";".join(row["layer_semantics"]["candidate_roles"]) for row in members
            }),
            "review_states": sorted(review_states),
            "coverage": representative["coverage"],
            "nearest_neighbors": similarity[representative_key]["nearest_neighbors"],
            "required_decision": {
                "raw_coordinates_covered_exactly_once": True,
                "semantic_contributions_reviewed_per_coordinate": True,
                "render_operation_bound_per_coordinate": True,
                "engine_composition_rule_verified": True,
                "exceptions_recorded": True,
                "evidence_refs_required": True,
            },
            "decision_record": None,
        })

    expected_keys = sorted(records)
    if sorted(covered_keys) != expected_keys:
        raise ReviewQueueError("review units do not cover every ledger source key exactly once")
    units.sort(key=lambda unit: (
        unit["priority"],
        -unit["exact_duplicate_layer_count"],
        unit["representative_source_key"],
    ))
    state_counts: dict[str, int] = {}
    for unit in units:
        state_counts[unit["decision_state"]] = state_counts.get(unit["decision_state"], 0) + 1
    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "rq": "RQ-200",
        "purpose": "Review each unique raw XP layer once, then inherit only across exact fingerprint matches.",
        "freeze_gate": {
            "ready": False,
            "reason": "every unique layer unit requires a reviewed full-cell decision",
            "required_decision_schema": "pipeline-v3/config/upstream_xp_cell_role_decision_schema.json",
        },
        "coverage": {
            "ledger_layers": len(records),
            "covered_layers": len(covered_keys),
            "unique_review_units": len(units),
            "exact_duplicate_layers_reusing_a_unit": len(records) - len(units),
            "decision_state_counts": state_counts,
            "decided_units": 0,
            "pending_units": len(units),
        },
        "review_units": units,
    }


def atomic_write(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode()
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
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--similarity", type=Path, default=DEFAULT_SIMILARITY)
    parser.add_argument("--decisions", type=Path, default=DEFAULT_DECISIONS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        records = comparison.load_records(args.ledger)
        similarity = load_similarity(args.similarity, set(records))
        doc = build_queue(records, similarity)
        apply_decisions(doc, load_decisions(args.decisions), records)
        if not args.check:
            atomic_write(args.out, doc)
    except (comparison.ComparisonError, ReviewQueueError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps(doc["coverage"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
