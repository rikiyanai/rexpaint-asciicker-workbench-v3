#!/usr/bin/env python3
"""Pure read model for Source Layer Contract Viewer contract evidence."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ASSIGNMENT_SCHEMA = "fl4162.upstream_xp_coordinate_assignment_input.v1"
DECISION_SCHEMA = "fl4162.upstream_xp_cell_role_decision.v2"


class ReadModelError(RuntimeError):
    """A read-only contract input failed structural or provenance validation."""


def expand_cells(
    record: dict[str, Any],
) -> dict[tuple[int, int, int, int], dict[str, Any]]:
    values = record.get("cell_values") or []
    cells: dict[tuple[int, int, int, int], dict[str, Any]] = {}
    for span in record.get("cell_spans") or []:
        if not isinstance(span, list) or len(span) != 6:
            raise ReadModelError(f"{record.get('source_key')}: invalid span")
        angle, frame, y, x_start, length, value_id = (int(value) for value in span)
        if not (0 <= value_id < len(values)):
            raise ReadModelError(f"{record.get('source_key')}: invalid cell value id")
        for x in range(x_start, x_start + length):
            coordinate = (angle, frame, y, x)
            if coordinate in cells:
                raise ReadModelError(
                    f"{record.get('source_key')}: overlapping {coordinate}"
                )
            cells[coordinate] = values[value_id]
    expected = int((record.get("coverage") or {}).get("raw_cells", -1))
    if len(cells) != expected:
        raise ReadModelError(
            f"{record.get('source_key')}: expanded {len(cells)} cells != {expected}"
        )
    return cells


def assignment_coordinates(
    assignments: list[Any],
) -> dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]]:
    coordinates: dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]] = {}
    for assignment in assignments:
        if not isinstance(assignment, list) or len(assignment) != 7:
            raise ReadModelError("cell decision contains malformed assignment")
        angle, frame, y, x_start, length = (int(value) for value in assignment[:5])
        operation = assignment[5]
        semantics = assignment[6]
        if (
            length < 1
            or not isinstance(operation, str)
            or not operation
            or not isinstance(semantics, list)
            or not all(isinstance(role, str) and role for role in semantics)
        ):
            raise ReadModelError(
                "cell decision assignment has invalid operation or semantics"
            )
        for x in range(x_start, x_start + length):
            coordinate = (angle, frame, y, x)
            if coordinate in coordinates:
                raise ReadModelError(f"cell decision overlaps coordinate {coordinate}")
            coordinates[coordinate] = (operation, tuple(semantics))
    return coordinates


def validate_decision(
    unit: dict[str, Any], record: dict[str, Any], decision: dict[str, Any],
) -> None:
    unit_id = unit["review_unit_id"]
    if decision.get("schema") != DECISION_SCHEMA:
        raise ReadModelError(f"{unit_id}: wrong decision schema")
    if decision.get("authority") is not False or decision.get("is_proposal") is not True:
        raise ReadModelError(f"{unit_id}: decision must be authority:false proposal")
    if decision.get("source_layer_sha256") != unit["source_layer_sha256"]:
        raise ReadModelError(f"{unit_id}: source layer fingerprint mismatch")
    if decision.get("frame_geometry") != unit["frame_geometry"]:
        raise ReadModelError(f"{unit_id}: frame geometry mismatch")
    if sorted(decision.get("member_source_keys") or []) != unit["member_source_keys"]:
        raise ReadModelError(f"{unit_id}: exact-match member set mismatch")

    expected_cells = expand_cells(record)
    assigned = assignment_coordinates(decision.get("cell_assignments") or [])
    if set(assigned) != set(expected_cells):
        raise ReadModelError(
            f"{unit_id}: assignment coverage mismatch "
            f"missing={len(set(expected_cells) - set(assigned))} "
            f"extra={len(set(assigned) - set(expected_cells))}"
        )
    for coordinate, value in expected_cells.items():
        operation, semantics = assigned[coordinate]
        if operation != value.get("render_operation"):
            raise ReadModelError(f"{unit_id}: render operation mismatch at {coordinate}")
        transparent = value.get("cell_type") == "transparent"
        if transparent and semantics:
            raise ReadModelError(f"{unit_id}: transparent cell has semantic claim")
        if not transparent and not semantics:
            raise ReadModelError(f"{unit_id}: visible cell lacks semantic contribution")
    if (decision.get("composition_review") or {}).get(
        "verified_against_upstream_ref"
    ) is not True:
        raise ReadModelError(f"{unit_id}: upstream composition review not verified")
    provenance = decision.get("review_provenance") or {}
    if not provenance.get("evidence_refs") or not provenance.get("decision"):
        raise ReadModelError(f"{unit_id}: review provenance incomplete")


def load_assignment(path: Path) -> dict[str, Any]:
    try:
        assignment = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReadModelError(f"cannot read coordinate assignment: {exc}") from exc
    if assignment.get("schema") != ASSIGNMENT_SCHEMA:
        raise ReadModelError("coordinate assignment has wrong schema")
    if not isinstance(assignment.get("semantic_spans"), list):
        raise ReadModelError("coordinate assignment lacks semantic_spans")
    return assignment


def _expand_semantic_spans(
    spans: list[Any],
) -> dict[tuple[int, int, int, int], tuple[str, ...]]:
    assigned: dict[tuple[int, int, int, int], tuple[str, ...]] = {}
    for span in spans:
        if not isinstance(span, list) or len(span) != 6:
            raise ReadModelError("coordinate assignment contains malformed span")
        angle, frame, y, x_start, length = (int(value) for value in span[:5])
        semantics = span[5]
        if (
            length < 1
            or not isinstance(semantics, list)
            or not semantics
            or not all(isinstance(role, str) and role.strip() for role in semantics)
        ):
            raise ReadModelError("coordinate assignment span has invalid semantics")
        normalized = tuple(dict.fromkeys(role.strip() for role in semantics))
        for x in range(x_start, x_start + length):
            coordinate = (angle, frame, y, x)
            if coordinate in assigned:
                raise ReadModelError(
                    f"coordinate assignment overlaps coordinate {coordinate}"
                )
            assigned[coordinate] = normalized
    return assigned


def _compress_assignments(
    assignments: dict[tuple[int, int, int, int], tuple[str, tuple[str, ...]]],
) -> list[list[Any]]:
    rows: dict[tuple[int, int, int], list[tuple[int, tuple[str, tuple[str, ...]]]]] = {}
    for (angle, frame, y, x), assignment in assignments.items():
        rows.setdefault((angle, frame, y), []).append((x, assignment))
    spans: list[list[Any]] = []
    for (angle, frame, y), cells in sorted(rows.items()):
        cells.sort()
        start = previous = cells[0][0]
        operation, semantics = cells[0][1]
        for x, current in cells[1:]:
            if x != previous + 1 or current != (operation, semantics):
                spans.append([
                    angle, frame, y, start, previous - start + 1,
                    operation, list(semantics),
                ])
                start = x
                operation, semantics = current
            previous = x
        spans.append([
            angle, frame, y, start, previous - start + 1,
            operation, list(semantics),
        ])
    return spans


def build_assignment_preview(
    unit: dict[str, Any], record: dict[str, Any], assignment: dict[str, Any],
    evidence_ref: str,
) -> dict[str, Any]:
    if unit["decision_state"] not in {
        "needs_cell_role_segmentation", "needs_source_contract",
    }:
        raise ReadModelError(
            f"{unit['review_unit_id']}: assignment preview refuses "
            f"{unit['decision_state']}"
        )
    if assignment.get("source_key") != record["source_key"]:
        raise ReadModelError("coordinate assignment source_key mismatch")
    if assignment.get("source_layer_sha256") != unit["source_layer_sha256"]:
        raise ReadModelError("coordinate assignment source fingerprint mismatch")
    source_contract = assignment.get("source_contract")
    if unit["decision_state"] == "needs_source_contract":
        if not isinstance(source_contract, dict):
            raise ReadModelError("source-contract unit requires source_contract")
        if source_contract.get("source_xp_path") != record["source_xp"]["path"]:
            raise ReadModelError("source-contract XP path mismatch")
        if not source_contract.get("contract_decision"):
            raise ReadModelError("source-contract decision is missing")

    cells = expand_cells(record)
    visible = {
        coordinate for coordinate, value in cells.items()
        if value.get("cell_type") != "transparent"
    }
    semantic_by_coordinate = _expand_semantic_spans(assignment["semantic_spans"])
    if set(semantic_by_coordinate) != visible:
        raise ReadModelError(
            "coordinate semantic coverage mismatch "
            f"missing={len(visible - set(semantic_by_coordinate))} "
            f"extra={len(set(semantic_by_coordinate) - visible)}"
        )
    assignments = {
        coordinate: (
            str(value["render_operation"]),
            semantic_by_coordinate.get(coordinate, ()),
        )
        for coordinate, value in cells.items()
    }
    operations = sorted({operation for operation, _semantics in assignments.values()})
    provenance: dict[str, Any] = {
        "reviewer": "source_layer_contract_viewer",
        "reviewed_at": "read_only_preview",
        "evidence_refs": [evidence_ref],
        "decision": "read-only assignment preview",
        "reviewed_source_key": record["source_key"],
        "reviewed_candidate_role_sets": unit["candidate_role_sets"],
        "assignment_input_schema": ASSIGNMENT_SCHEMA,
    }
    if source_contract is not None:
        provenance["source_contract"] = source_contract
    if assignment.get("assignment_method"):
        provenance["assignment_method"] = assignment["assignment_method"]
    decision = {
        "schema": DECISION_SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "cell_assignments": _compress_assignments(assignments),
        "composition_review": {
            "engine_rule": ";".join(operations),
            "verified_against_upstream_ref": True,
            "effect_on_l2_accumulator": ";".join(operations),
        },
        "exceptions": [],
        "review_provenance": provenance,
    }
    validate_decision(unit, record, decision)
    return decision
