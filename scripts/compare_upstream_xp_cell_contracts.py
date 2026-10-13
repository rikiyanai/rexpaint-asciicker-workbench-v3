#!/usr/bin/env python3
"""Compare full-atlas FL-4162 cell contracts by exact coordinates and bytes."""
from __future__ import annotations

import argparse
import itertools
import json
import os
import tempfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO / "docs/research/ascii/semantic_maps/upstream_xp_cell_contract"
SCHEMA = "fl4162.upstream_xp_cell_comparison.v1"


class ComparisonError(RuntimeError):
    pass


def load_records(ledger: Path) -> dict[str, dict[str, Any]]:
    manifest_path = ledger / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ComparisonError(f"cannot read ledger manifest: {exc}") from exc
    if manifest.get("authority") is not False:
        raise ComparisonError("ledger must declare authority:false")
    records: dict[str, dict[str, Any]] = {}
    for shard in manifest.get("shards") or []:
        path = ledger / str(shard["path"])
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            try:
                row = json.loads(line)
            except ValueError as exc:
                raise ComparisonError(f"{path}:{lineno}: malformed JSON: {exc}") from exc
            key = str(row.get("source_key") or "")
            if not key or key in records:
                raise ComparisonError(f"duplicate or missing source_key: {key!r}")
            records[key] = row
    expected = int((manifest.get("totals") or {}).get("layers", -1))
    if len(records) != expected:
        raise ComparisonError(f"ledger record count {len(records)} != manifest {expected}")
    return records


def expand_cells(record: dict[str, Any]) -> dict[tuple[int, int, int, int], dict[str, Any]]:
    values = record.get("cell_values") or []
    cells: dict[tuple[int, int, int, int], dict[str, Any]] = {}
    for span in record.get("cell_spans") or []:
        if not isinstance(span, list) or len(span) != 6:
            raise ComparisonError(f"{record.get('source_key')}: invalid span")
        angle, frame, y, x_start, length, value_id = (int(v) for v in span)
        if not (0 <= value_id < len(values)):
            raise ComparisonError(f"{record.get('source_key')}: invalid cell value id")
        for x in range(x_start, x_start + length):
            key = (angle, frame, y, x)
            if key in cells:
                raise ComparisonError(f"{record.get('source_key')}: overlapping {key}")
            cells[key] = values[value_id]
    expected = int((record.get("coverage") or {}).get("raw_cells", -1))
    if len(cells) != expected:
        raise ComparisonError(
            f"{record.get('source_key')}: expanded {len(cells)} cells != {expected}"
        )
    return cells


def _visible(cells: dict[tuple[int, int, int, int], dict[str, Any]]) -> dict:
    return {coord: value for coord, value in cells.items()
            if value.get("cell_type") != "transparent"}


def _cell_summary(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "glyph": value["raw"]["glyph"],
        "fg": value["raw"]["fg"],
        "bg": value["raw"]["bg"],
        "cell_type": value["cell_type"],
    }


def similarity_metrics(
    left_visible: dict[tuple[int, int, int, int], dict[str, Any]],
    right_visible: dict[tuple[int, int, int, int], dict[str, Any]],
) -> dict[str, Any]:
    left_coords = set(left_visible)
    right_coords = set(right_visible)
    common = left_coords & right_coords
    union = left_coords | right_coords
    exact = {
        coord for coord in common
        if left_visible[coord]["raw"] == right_visible[coord]["raw"]
    }
    same_glyph = {
        coord for coord in common
        if left_visible[coord]["raw"]["glyph"] == right_visible[coord]["raw"]["glyph"]
    }
    if not left_coords and not right_coords:
        count_similarity = 1.0
    elif not left_coords or not right_coords:
        count_similarity = 0.0
    else:
        count_similarity = min(len(left_coords), len(right_coords)) / max(
            len(left_coords), len(right_coords)
        )
    coordinate_similarity = len(common) / len(union) if union else 1.0
    return {
        "left_visible": len(left_coords),
        "right_visible": len(right_coords),
        "common_visible_coordinates": len(common),
        "union_visible_coordinates": len(union),
        "exact_raw_coordinates": len(exact),
        "same_glyph_coordinates": len(same_glyph),
        "count_similarity": round(count_similarity, 6),
        "coordinate_similarity": round(coordinate_similarity, 6),
        "combined_similarity": round((count_similarity + coordinate_similarity) / 2.0, 6),
        "occupancy_jaccard": round(coordinate_similarity, 6),
        "exact_raw_union_fraction": round(len(exact) / len(union), 6) if union else 1.0,
    }


def compare_records(left: dict[str, Any], right: dict[str, Any], detail_limit: int = 40) -> dict[str, Any]:
    if left.get("frame_geometry") != right.get("frame_geometry"):
        raise ComparisonError(
            f"geometry mismatch {left.get('source_key')} vs {right.get('source_key')}"
        )
    lvis = _visible(expand_cells(left))
    rvis = _visible(expand_cells(right))
    lset, rset = set(lvis), set(rvis)
    common = lset & rset
    exact = {coord for coord in common if lvis[coord]["raw"] == rvis[coord]["raw"]}
    left_only = sorted(lset - rset)
    right_only = sorted(rset - lset)
    changed = sorted(common - exact)
    return {
        "left": left["source_key"],
        "right": right["source_key"],
        "right_hand_status": right["hand_evidence"]["status"],
        "right_hand_label": right["hand_evidence"]["corrected_label"],
        "right_candidate_roles": right["layer_semantics"]["candidate_roles"],
        "metrics": {
            **similarity_metrics(lvis, rvis),
            "left_only_coordinates": len(left_only),
            "right_only_coordinates": len(right_only),
        },
        "coordinate_differences": {
            "left_only": [list(coord) for coord in left_only[:detail_limit]],
            "right_only": [list(coord) for coord in right_only[:detail_limit]],
            "changed": [
                {"coordinate": list(coord), "left": _cell_summary(lvis[coord]),
                 "right": _cell_summary(rvis[coord])}
                for coord in changed[:detail_limit]
            ],
            "truncated": any(len(items) > detail_limit
                             for items in (left_only, right_only, changed)),
        },
    }


def _geometry_key(record: dict[str, Any]) -> str:
    return json.dumps(record.get("frame_geometry"), sort_keys=True, separators=(",", ":"))


def _ranking_key(row: dict[str, Any]) -> tuple[Any, ...]:
    metrics = row["metrics"]
    return (
        -metrics["combined_similarity"],
        -metrics["coordinate_similarity"],
        -metrics["count_similarity"],
        -metrics["exact_raw_coordinates"],
        row["peer"],
    )


def build_corpus_ranking(
    records: dict[str, dict[str, Any]], top: int = 8
) -> dict[str, Any]:
    if top < 1:
        raise ComparisonError("top must be at least 1")
    visible = {key: _visible(expand_cells(record)) for key, record in records.items()}
    geometry_groups: dict[str, list[str]] = {}
    for key, record in records.items():
        geometry_groups.setdefault(_geometry_key(record), []).append(key)

    neighbors: dict[str, list[dict[str, Any]]] = {key: [] for key in records}
    compatible_pair_count = 0
    for keys in geometry_groups.values():
        for left_key, right_key in itertools.combinations(sorted(keys), 2):
            compatible_pair_count += 1
            metrics = similarity_metrics(visible[left_key], visible[right_key])
            left_record = records[left_key]
            right_record = records[right_key]
            neighbors[left_key].append({
                "peer": right_key,
                "peer_family": right_record["family"],
                "peer_hand_status": right_record["hand_evidence"]["status"],
                "peer_candidate_roles": right_record["layer_semantics"]["candidate_roles"],
                "metrics": metrics,
            })
            neighbors[right_key].append({
                "peer": left_key,
                "peer_family": left_record["family"],
                "peer_hand_status": left_record["hand_evidence"]["status"],
                "peer_candidate_roles": left_record["layer_semantics"]["candidate_roles"],
                "metrics": {
                    **metrics,
                    "left_visible": metrics["right_visible"],
                    "right_visible": metrics["left_visible"],
                },
            })

    missing_peers = sorted(key for key, rows in neighbors.items() if not rows)
    if missing_peers:
        raise ComparisonError(f"layers without compatible geometry peers: {missing_peers}")

    rankings = []
    for key in sorted(records):
        rows = sorted(neighbors[key], key=_ranking_key)
        record = records[key]
        rankings.append({
            "source_key": key,
            "family": record["family"],
            "raw_layer_index": record["raw_layer_index"],
            "frame_geometry": record["frame_geometry"],
            "hand_evidence": record["hand_evidence"],
            "candidate_roles": record["layer_semantics"]["candidate_roles"],
            "compatible_peer_count": len(rows),
            "nearest_neighbors": rows[:top],
        })
    if len(rankings) != len(records):
        raise ComparisonError("corpus ranking did not cover every ledger layer")

    total_pairs = len(records) * (len(records) - 1) // 2
    return {
        "schema": "fl4162.upstream_xp_cell_similarity_index.v1",
        "authority": False,
        "is_proposal": True,
        "comparison_scope": (
            "full atlas; exact frame/angle/local cell coordinates; all families with "
            "identical frame geometry"
        ),
        "ranking_axes": {
            "count_similarity": "min(visible cell counts) / max(visible cell counts)",
            "coordinate_similarity": "Jaccard overlap of visible cell coordinates",
            "combined_similarity": "mean(count_similarity, coordinate_similarity)",
        },
        "coverage": {
            "ledger_layers": len(records),
            "ranked_layers": len(rankings),
            "geometry_groups": len(geometry_groups),
            "compatible_pairs_ranked": compatible_pair_count,
            "incompatible_geometry_pairs_excluded": total_pairs - compatible_pair_count,
            "layers_without_ranked_peers": [],
            "nearest_neighbors_per_layer": top,
        },
        "rankings": rankings,
    }


def rank_peers(source_key: str, records: dict[str, dict[str, Any]], top: int = 20) -> dict[str, Any]:
    if source_key not in records:
        raise ComparisonError(f"unknown source_key: {source_key}")
    left = records[source_key]
    peers = []
    for key, right in records.items():
        if key == source_key:
            continue
        if right.get("family") != left.get("family"):
            continue
        if right.get("frame_geometry") != left.get("frame_geometry"):
            continue
        peers.append(compare_records(left, right))
    peers.sort(key=lambda row: (
        -row["metrics"]["occupancy_jaccard"],
        -row["metrics"]["exact_raw_union_fraction"],
        row["right"],
    ))
    return {
        "source_key": source_key,
        "hand_evidence": left["hand_evidence"],
        "candidate_roles": left["layer_semantics"]["candidate_roles"],
        "frame_geometry": left["frame_geometry"],
        "peers": peers[:top],
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
    parser.add_argument("source_keys", nargs="*")
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--rank-all", action="store_true")
    parser.add_argument("--write", type=Path)
    args = parser.parse_args(argv)
    try:
        records = load_records(args.ledger)
        if args.rank_all:
            if args.source_keys:
                raise ComparisonError("--rank-all does not accept source keys")
            doc = build_corpus_ranking(records, args.top)
        else:
            if not args.source_keys:
                raise ComparisonError("provide source keys or use --rank-all")
            doc = {
                "schema": SCHEMA,
                "authority": False,
                "is_proposal": True,
                "comparison_scope": "full atlas, exact frame/angle/local cell coordinates",
                "sources": [rank_peers(key, records, args.top) for key in args.source_keys],
            }
        if args.write:
            atomic_write(args.write, doc)
    except ComparisonError as exc:
        print(f"FAIL: {exc}")
        return 2
    print(json.dumps(doc, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
