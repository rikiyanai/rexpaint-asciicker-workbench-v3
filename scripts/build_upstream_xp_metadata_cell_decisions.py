#!/usr/bin/env python3
"""Review L0/L1 XP cells against pinned upstream engine semantics."""
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


def get_digit(glyph: int) -> int:
    if ord("0") <= glyph <= ord("9"):
        return glyph - ord("0")
    if ord("A") <= glyph <= ord("Z"):
        return 10 + glyph - ord("A")
    if ord("a") <= glyph <= ord("z"):
        return 10 + glyph - ord("a")
    return -1


def _atlas_coordinate(
    coordinate: tuple[int, int, int, int], geometry: dict[str, Any]
) -> tuple[int, int]:
    angle, frame, local_y, local_x = coordinate
    return (
        frame * int(geometry["frame_width"]) + local_x,
        angle * int(geometry["frame_height"]) + local_y,
    )


def _l0_roles(
    coordinate: tuple[int, int, int, int], value: dict[str, Any],
    geometry: dict[str, Any], active_animation_columns: set[int],
) -> tuple[str, ...]:
    atlas_x, atlas_y = _atlas_coordinate(coordinate, geometry)
    roles = ["per_cell_color_key"]
    if (atlas_x, atlas_y) == (0, 0):
        roles.append("view_angle_count")
    if atlas_y == 0 and atlas_x in active_animation_columns:
        roles.append("animation_frame_count")
    if (atlas_x, atlas_y) == (0, 1):
        roles.append("projection_y_reference")
    if (atlas_x, atlas_y) == (1, 1):
        roles.append("reflection_y_reference")
    if (atlas_x, atlas_y) == (0, 2):
        roles.append("projection_z_reference")
    if (atlas_x, atlas_y) == (1, 2):
        roles.append("reflection_z_reference")
    if int(value["raw"]["glyph"]) == 2:
        roles.append("frame_meta_position_marker")
    return tuple(roles)


def _active_animation_columns(
    cells: dict[tuple[int, int, int, int], dict[str, Any]], geometry: dict[str, Any]
) -> set[int]:
    by_atlas = {_atlas_coordinate(coord, geometry): value for coord, value in cells.items()}
    width = int(geometry["frame_width"]) * int(geometry["frames_per_angle"])
    active: set[int] = set()
    for atlas_x in range(1, width):
        value = by_atlas.get((atlas_x, 0))
        if value is None or get_digit(int(value["raw"]["glyph"])) <= 0:
            break
        active.add(atlas_x)
    return active


def _compress_assignments(
    assignments_by_coordinate: dict[
        tuple[int, int, int, int], tuple[str, tuple[str, ...]]
    ]
) -> list[list[Any]]:
    assignments: list[list[Any]] = []
    rows: dict[tuple[int, int, int], list[tuple[int, tuple[str, ...]]]] = {}
    for (angle, frame, y, x), assignment in assignments_by_coordinate.items():
        rows.setdefault((angle, frame, y), []).append((x, assignment))
    for (angle, frame, y), cells in sorted(rows.items()):
        cells.sort()
        start = cells[0][0]
        previous = start
        operation, semantics = cells[0][1]
        for x, current_assignment in cells[1:]:
            if x != previous + 1 or current_assignment != (operation, semantics):
                assignments.append([
                    angle, frame, y, start, previous - start + 1,
                    operation, list(semantics),
                ])
                start = x
                operation, semantics = current_assignment
            previous = x
        assignments.append([
            angle, frame, y, start, previous - start + 1,
            operation, list(semantics),
        ])
    return assignments


def build_metadata_decision(unit: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    layer_index = int(record["raw_layer_index"])
    if layer_index not in (0, 1):
        raise queue.ReviewQueueError(f"{unit['review_unit_id']}: not an engine metadata layer")
    cells = comparison.expand_cells(record)
    geometry = record["frame_geometry"]
    if layer_index == 0:
        active_animation_columns = _active_animation_columns(cells, geometry)
        semantics_by_coordinate = {
            coord: _l0_roles(coord, value, geometry, active_animation_columns)
            for coord, value in cells.items()
        }
        engine_rule = (
            "L0 bg is the per-cell color key; consumed L0 glyph coordinates encode angles, "
            "animation lengths, projection/reflection refs, and glyph==2 frame meta position"
        )
        evidence_refs = [
            "sprite.cpp@8ff75d0c:350,541-623,688-700",
            "engine/sprite.cpp:619,1029-1054",
        ]
        exceptions = [
            "animation scanning stops at the first non-positive GetDigit value",
            "upstream max_anims is fixed at 16 without a bounds check",
        ]
        decision_text = "reviewed L0 coordinate semantics from upstream engine reads"
    else:
        semantics_by_coordinate = {
            coord: ("height_or_undefined_spare_channel",) for coord in cells
        }
        engine_rule = "L1 glyph maps 0-9/A-Z to per-cell spare height; every other glyph yields 0xFF"
        evidence_refs = [
            "sprite.cpp@8ff75d0c:351,688-727",
            "engine/sprite.cpp:620",
        ]
        exceptions = ["lowercase glyphs are not accepted by the runtime L1 spare-channel decode"]
        decision_text = "reviewed L1 per-cell height/spare semantics from upstream engine reads"
    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "cell_assignments": _compress_assignments({
            coord: (str(cells[coord]["render_operation"]), semantics)
            for coord, semantics in semantics_by_coordinate.items()
        }),
        "composition_review": {
            "engine_rule": engine_rule,
            "verified_against_upstream_ref": True,
            "effect_on_l2_accumulator": (
                "L0 supplies transparency/reference metadata" if layer_index == 0
                else "L1 supplies per-cell height/spare metadata"
            ),
        },
        "exceptions": exceptions,
        "review_provenance": {
            "reviewer": "codex_manual_source_review",
            "reviewed_at": "2026-07-14",
            "evidence_refs": evidence_refs,
            "decision": decision_text,
        },
    }


def atomic_write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = b"".join(
        (json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode()
        for row in rows
    )
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
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        records = comparison.load_records(args.ledger)
        similarity = queue.load_similarity(args.similarity, set(records))
        review_doc = queue.build_queue(records, similarity)
        rows = []
        for unit in review_doc["review_units"]:
            if unit["decision_state"] != "needs_engine_metadata_cell_confirmation":
                continue
            rows.append(build_metadata_decision(unit, records[unit["representative_source_key"]]))
        decisions = {row["review_unit_id"]: row for row in rows}
        queue.apply_decisions(review_doc, decisions, records)
        if len(rows) != 29:
            raise queue.ReviewQueueError(f"expected 29 unique metadata decisions, got {len(rows)}")
        if not args.check:
            atomic_write_jsonl(args.out, rows)
    except (comparison.ComparisonError, queue.ReviewQueueError) as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps({"metadata_decisions": len(rows)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
