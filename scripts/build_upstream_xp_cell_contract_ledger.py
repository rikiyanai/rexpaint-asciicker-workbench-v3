#!/usr/bin/env python3
"""Build the FL-4162 / RQ-200 full-cell upstream XP contract ledger.

The ledger is deterministic evidence, never runtime authority. Every raw atlas
coordinate in every source XP layer is represented by a horizontal span with exact
XP bytes, frame/angle-local coordinates, engine composition behavior, and an honest
role-assignment state. L0/L1 carry engine-derived metadata evidence; hand evidence
begins at L2. Composite visual layers remain unsegmented until a reviewed cell-level
decision exists.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import struct
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import xp_core  # noqa: E402
from source_layer_contract_viewer import classify_cell  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SM = REPO / "docs/research/ascii/semantic_maps"
DEFAULT_STATE_FINAL = Path(
    "/Users/r/Desktop/bundle_layer_audit_20260520/verifier_state_backups/"
    "state_FINAL_20260521-163326.json"
)
EXPECTED_STATE_FINAL_SHA256 = "ecc9a16112ce48beaeb0e24beba2ccc7399c4efc50d32505f3fd54f8e8d76020"
DEFAULT_OUT = SM / "upstream_xp_cell_contract"
SCHEMA = "fl4162.upstream_xp_cell_contract.layer.v1"
MANIFEST_SCHEMA = "fl4162.upstream_xp_cell_contract.manifest.v1"


class CellContractError(RuntimeError):
    """An input drifted, coverage was incomplete, or an output was malformed."""


def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CellContractError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise CellContractError(f"expected JSON object: {path}")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise CellContractError(f"cannot read JSONL {path}: {exc}") from exc
    for lineno, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as exc:
            raise CellContractError(f"{path}:{lineno}: malformed JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise CellContractError(f"{path}:{lineno}: expected object")
        rows.append(row)
    return rows


def index_unique(rows: Iterable[dict[str, Any]], key: str, owner: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        value = str(row.get(key) or "")
        if not value:
            raise CellContractError(f"{owner}: row missing {key}")
        if value in out:
            raise CellContractError(f"{owner}: duplicate {key} {value}")
        out[value] = row
    return out


def load_xp(path: Path) -> xp_core.XPFile:
    if not path.is_file():
        raise CellContractError(f"missing upstream XP: {path}")
    xp = xp_core.XPFile()
    with contextlib.redirect_stdout(io.StringIO()):
        xp.load(str(path))
    return xp


def raw_layer_sha256(layer: xp_core.XPLayer) -> str:
    h = hashlib.sha256()
    h.update(struct.pack("<II", layer.width, layer.height))
    for y in range(layer.height):
        for x in range(layer.width):
            glyph, fg, bg = layer.data[y][x]
            h.update(struct.pack("<I6B", int(glyph), *fg, *bg))
    return h.hexdigest()


def topology_index(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    contracts = doc.get("contracts") or {}
    if not isinstance(contracts, dict):
        raise CellContractError("family topology contracts missing contracts object")
    for contract in contracts.values():
        for row in contract.get("per_card") or []:
            key = str(row.get("card_id") or "")
            if not key or key in out:
                raise CellContractError(f"invalid duplicate topology card: {key!r}")
            out[key] = row
    return out


def candidate_roles(manual: dict[str, Any], decision: dict[str, Any] | None,
                    topology: dict[str, Any]) -> list[str]:
    # The reviewed family contract is the later, fingerprint-bound role owner.
    # Earlier source-layer decisions remain provenance and must not resurrect a
    # false-clean label after owned->composite reconciliation.
    roles = list(topology.get("reconciled_roles") or [])
    if not roles and topology.get("owned_role"):
        roles = [part for part in str(topology["owned_role"]).split(";") if part]
    if not roles:
        roles = list(topology.get("proposed_roles") or [])
    if not roles:
        roles = list((decision or {}).get("composite_roles") or [])
    if not roles:
        roles = list((manual.get("agent_verdict") or {}).get("proposed_roles") or [])
    return list(dict.fromkeys(str(role) for role in roles if str(role)))


def semantic_state(manual: dict[str, Any], topology: dict[str, Any], roles: list[str]) -> tuple[str, str]:
    verdict = manual.get("agent_verdict") or {}
    cls = topology.get("classification")
    if verdict.get("unresolved") or cls == "unresolved":
        return "unresolved_source_contract", "unresolved_hand_evidence"
    if cls == "rejected":
        return "rejected_fragment_unassigned", "rejected_fragment_needs_contract"
    if len(roles) == 1:
        return "reviewed_layer_role_candidate", "layer_role_reviewed_cell_semantics_unverified"
    if len(roles) > 1:
        return "composite_layer_unsegmented", "reviewed_composite_cell_assignment_pending"
    return "unassigned", "missing_role_fails_closed"


def composition_rule(cell_type: str, layer_index: int) -> str:
    if layer_index == 0:
        return "define_per_cell_color_key_and_frame_metadata"
    if layer_index == 1:
        return "define_height_channel"
    if cell_type == "transparent":
        return "no_visual_contribution"
    if layer_index == 2:
        return "seed_l2_base_accumulator"
    if cell_type == "swoosh_pixel":
        return "final_cyan_swoosh_context_composite"
    return "ordinal_overlay_merge_into_l2"


def _span_value(cell: tuple[Any, Any, Any], layer_index: int, layer_count: int,
                role_state: str) -> tuple[Any, ...]:
    glyph, fg, bg = cell
    cell_type = classify_cell(int(glyph), fg, bg, layer_index, layer_count)
    contribution = "none" if cell_type == "transparent" else role_state
    return (int(glyph), tuple(fg), tuple(bg), cell_type,
            composition_rule(cell_type, layer_index), contribution)


def build_spans(layer: xp_core.XPLayer, layer_index: int, layer_count: int,
                frame_width: int, frame_height: int,
                role_state: str) -> tuple[list[dict[str, Any]], list[list[int]], Counter[str]]:
    if layer.width % frame_width or layer.height % frame_height:
        raise CellContractError(
            f"L{layer_index}: atlas {layer.width}x{layer.height} not divisible by "
            f"frame {frame_width}x{frame_height}"
        )
    angles = layer.height // frame_height
    frames = layer.width // frame_width
    values: list[dict[str, Any]] = []
    value_ids: dict[tuple[Any, ...], int] = {}
    spans: list[list[int]] = []
    histogram: Counter[str] = Counter()
    for angle in range(angles):
        for frame in range(frames):
            for local_y in range(frame_height):
                atlas_y = angle * frame_height + local_y
                local_x = 0
                while local_x < frame_width:
                    atlas_x = frame * frame_width + local_x
                    value = _span_value(
                        layer.data[atlas_y][atlas_x], layer_index, layer_count, role_state
                    )
                    end = local_x + 1
                    while end < frame_width:
                        next_x = frame * frame_width + end
                        if _span_value(layer.data[atlas_y][next_x], layer_index,
                                       layer_count, role_state) != value:
                            break
                        end += 1
                    glyph, fg, bg, cell_type, rule, contribution = value
                    length = end - local_x
                    histogram[cell_type] += length
                    if value not in value_ids:
                        value_ids[value] = len(values)
                        values.append({
                            "raw": {"glyph": glyph, "fg": list(fg), "bg": list(bg)},
                            "cell_type": cell_type,
                            "composition_rule": rule,
                            "role_contribution": contribution,
                        })
                    spans.append([angle, frame, local_y, local_x, length, value_ids[value]])
                    local_x = end
    return values, spans, histogram


def build_layer_record(card: dict[str, Any], manual: dict[str, Any],
                       decision: dict[str, Any] | None, topology: dict[str, Any],
                       xp_path: Path, xp: xp_core.XPFile) -> dict[str, Any]:
    source_key = str(card["source_key"])
    layer_index = int(card["raw_layer_index"])
    if layer_index < 2 or layer_index >= len(xp.layers):
        raise CellContractError(f"{source_key}: invalid raw layer L{layer_index}")
    if card.get("source_final_sha256") != EXPECTED_STATE_FINAL_SHA256:
        raise CellContractError(f"{source_key}: state_FINAL fingerprint mismatch")
    frame_wh = (card.get("cells") or {}).get("frame_wh")
    if not isinstance(frame_wh, list) or len(frame_wh) != 2:
        raise CellContractError(f"{source_key}: missing frame geometry")
    fw, fh = (int(frame_wh[0]), int(frame_wh[1]))
    layer = xp.layers[layer_index]
    roles = candidate_roles(manual, decision, topology)
    role_state, review_state = semantic_state(manual, topology, roles)
    values, spans, histogram = build_spans(
        layer, layer_index, len(xp.layers), fw, fh, role_state
    )
    raw_cells = layer.width * layer.height
    if sum(histogram.values()) != raw_cells:
        raise CellContractError(f"{source_key}: span coverage mismatch")
    hand = card.get("hand") or {}
    verdict = manual.get("agent_verdict") or {}
    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "source_key": source_key,
        "family": str(card["family"]),
        "ahsw": card.get("ahsw"),
        "source_xp": {
            "path": str(card["source_xp_path"]),
            "sha256": sha256_path(xp_path),
            "raw_layer_sha256": raw_layer_sha256(layer),
            "width": layer.width,
            "height": layer.height,
            "layer_count": len(xp.layers),
        },
        "raw_layer_index": layer_index,
        "frame_geometry": {
            "frame_width": fw,
            "frame_height": fh,
            "angles": layer.height // fh,
            "frames_per_angle": layer.width // fw,
        },
        "hand_evidence": {
            "status": hand.get("status"),
            "corrected_label": hand.get("corrected_label"),
            "note": hand.get("note"),
            "pre_guess": hand.get("pre_guess"),
            "pre_source": hand.get("pre_source"),
            "source_row_verbatim": hand.get("source_row_verbatim"),
        },
        "layer_semantics": {
            "topology_class": topology.get("classification"),
            "candidate_roles": roles,
            "cell_role_state": role_state,
            "review_state": review_state,
        },
        "coverage": {
            "raw_cells": raw_cells,
            "spans": len(spans),
            "visible_cells": raw_cells - histogram.get("transparent", 0),
            "transparent_cells": histogram.get("transparent", 0),
            "cell_type_histogram": dict(sorted(histogram.items())),
        },
        "cell_values": values,
        "cell_spans": spans,
        "exceptions": {
            "contradictions": list(verdict.get("contradictions") or []),
            "topology_note": verdict.get("topology_note") or "",
            "glyph_exact_matches": list((card.get("glyph_similarity") or {}).get("exact_matches") or []),
            "glyph_near_matches": list((card.get("glyph_similarity") or {}).get("near_matches") or []),
        },
        "actor_visual_profile_implication": {
            "state": "proposal_only_not_compiler_authority",
            "candidate_roles": roles,
            "decision_present": decision is not None,
        },
        "traceability": {
            "source_final_sha256": EXPECTED_STATE_FINAL_SHA256,
            "source_card_fingerprint": (decision or {}).get("source_card_fingerprint"),
            "evidence_card": f"layer_evidence_cards.jsonl#{source_key}",
            "manual_review": f"manual_candidate_review.json#{source_key}",
            "family_contract": f"family_topology_contracts.json#{source_key}",
            "upstream_engine_ref": "sprite.cpp@8ff75d0c:350-361",
            "local_engine_correspondence": "engine/sprite.cpp:619-622,1029-1203",
        },
    }


def build_metadata_layer_record(
    card: dict[str, Any], xp_path: Path, xp: xp_core.XPFile, layer_index: int
) -> dict[str, Any]:
    if layer_index not in (0, 1):
        raise CellContractError(f"metadata layer index must be L0/L1, got L{layer_index}")
    frame_wh = (card.get("cells") or {}).get("frame_wh")
    if not isinstance(frame_wh, list) or len(frame_wh) != 2:
        raise CellContractError(f"{card.get('source_key')}: missing frame geometry")
    fw, fh = (int(frame_wh[0]), int(frame_wh[1]))
    layer = xp.layers[layer_index]
    role = "engine_color_key_frame_metadata" if layer_index == 0 else "engine_height_channel"
    values, spans, histogram = build_spans(
        layer, layer_index, len(xp.layers), fw, fh, "engine_metadata_contract"
    )
    raw_cells = layer.width * layer.height
    if sum(histogram.values()) != raw_cells:
        raise CellContractError(f"{card.get('source_key')}: metadata span coverage mismatch")
    stem = Path(str(card["source_xp_path"])).stem
    source_key = f"{stem}-L{layer_index}"
    return {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": True,
        "source_key": source_key,
        "family": str(card["family"]),
        "ahsw": card.get("ahsw"),
        "source_xp": {
            "path": str(card["source_xp_path"]),
            "sha256": sha256_path(xp_path),
            "raw_layer_sha256": raw_layer_sha256(layer),
            "width": layer.width,
            "height": layer.height,
            "layer_count": len(xp.layers),
        },
        "raw_layer_index": layer_index,
        "frame_geometry": {
            "frame_width": fw,
            "frame_height": fh,
            "angles": layer.height // fh,
            "frames_per_angle": layer.width // fw,
        },
        "hand_evidence": {
            "status": "not_applicable_engine_metadata",
            "corrected_label": None,
            "note": "No hand-label row exists for L0/L1; meaning derives from pinned upstream engine behavior.",
            "pre_guess": None,
            "pre_source": "upstream_engine_contract",
            "source_row_verbatim": None,
        },
        "layer_semantics": {
            "topology_class": "engine_metadata",
            "candidate_roles": [role],
            "cell_role_state": "engine_metadata_contract",
            "review_state": "engine_metadata_semantics_unverified",
        },
        "coverage": {
            "raw_cells": raw_cells,
            "spans": len(spans),
            "visible_cells": raw_cells,
            "transparent_cells": 0,
            "cell_type_histogram": dict(sorted(histogram.items())),
        },
        "cell_values": values,
        "cell_spans": spans,
        "exceptions": {
            "contradictions": [],
            "topology_note": "L0/L1 are engine metadata channels, not visual semantic slots.",
            "glyph_exact_matches": [],
            "glyph_near_matches": [],
        },
        "actor_visual_profile_implication": {
            "state": "source_engine_metadata_not_profile_role",
            "candidate_roles": [role],
            "decision_present": False,
        },
        "traceability": {
            "source_final_sha256": EXPECTED_STATE_FINAL_SHA256,
            "source_card_fingerprint": None,
            "evidence_card": None,
            "manual_review": None,
            "family_contract": None,
            "upstream_engine_ref": (
                "sprite.cpp@8ff75d0c:350" if layer_index == 0
                else "sprite.cpp@8ff75d0c:351"
            ),
            "local_engine_correspondence": (
                "engine/sprite.cpp:619" if layer_index == 0
                else "engine/sprite.cpp:620"
            ),
        },
    }


def validate_record(record: dict[str, Any]) -> None:
    key = record.get("source_key", "<missing>")
    if record.get("schema") != SCHEMA or record.get("authority") is not False:
        raise CellContractError(f"{key}: invalid authority/schema")
    coverage = record.get("coverage") or {}
    spans = record.get("cell_spans") or []
    if coverage.get("spans") != len(spans):
        raise CellContractError(f"{key}: span count mismatch")
    expanded = 0
    seen: set[tuple[int, int]] = set()
    width = int(record["source_xp"]["width"])
    height = int(record["source_xp"]["height"])
    values = record.get("cell_values") or []
    fw = int(record["frame_geometry"]["frame_width"])
    fh = int(record["frame_geometry"]["frame_height"])
    for span in spans:
        if not isinstance(span, list) or len(span) != 6:
            raise CellContractError(f"{key}: invalid compact span")
        angle, frame, local_y, local_x, length, value_id = (int(v) for v in span)
        start = frame * fw + local_x
        end = start + length
        y = angle * fh + local_y
        if not (0 <= value_id < len(values)):
            raise CellContractError(f"{key}: invalid cell value reference")
        if not (0 <= start < end <= width and 0 <= y < height):
            raise CellContractError(f"{key}: invalid span address")
        for x in range(start, end):
            if (x, y) in seen:
                raise CellContractError(f"{key}: overlapping cell {(x, y)}")
            seen.add((x, y))
        expanded += end - start
    if expanded != width * height or len(seen) != width * height:
        raise CellContractError(f"{key}: incomplete full-cell coverage")


def atomic_write(path: Path, data: bytes) -> None:
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


def build_all(state_final: Path = DEFAULT_STATE_FINAL) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    if sha256_path(state_final) != EXPECTED_STATE_FINAL_SHA256:
        raise CellContractError(f"state_FINAL SHA-256 mismatch: {state_final}")
    state_rows = read_json(state_final)
    cards = read_jsonl(SM / "layer_evidence_cards.jsonl")
    card_by_key = index_unique(cards, "source_key", "evidence cards")
    manual_doc = read_json(SM / "manual_candidate_review.json")
    manual_by_key = index_unique(manual_doc.get("reviewed") or [], "card_id", "manual review")
    decision_by_key = index_unique(
        read_jsonl(SM / "source_layer_review_decisions.jsonl"), "source_key", "review decisions"
    )
    topo_by_key = topology_index(read_json(SM / "family_topology_contracts.json"))
    expected_keys = set(state_rows)
    for name, keys in (
        ("evidence cards", set(card_by_key)),
        ("manual review", set(manual_by_key)),
        ("family topology", set(topo_by_key)),
    ):
        if keys != expected_keys:
            raise CellContractError(
                f"{name}: key coverage mismatch missing={sorted(expected_keys - keys)} "
                f"extra={sorted(keys - expected_keys)}"
            )
    if not set(decision_by_key).issubset(expected_keys):
        raise CellContractError("review decisions contain unknown source keys")

    xp_cache: dict[str, tuple[Path, xp_core.XPFile]] = {}
    representative_card_by_xp: dict[str, dict[str, Any]] = {}
    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    totals: Counter[str] = Counter()
    review_states: Counter[str] = Counter()
    unresolved: list[str] = []
    for source_key in sorted(expected_keys):
        card = card_by_key[source_key]
        source_rel = str(card["source_xp_path"])
        if source_rel not in xp_cache:
            path = REPO / source_rel
            xp_cache[source_rel] = (path, load_xp(path))
            representative_card_by_xp[source_rel] = card
        path, xp = xp_cache[source_rel]
        record = build_layer_record(
            card, manual_by_key[source_key], decision_by_key.get(source_key),
            topo_by_key[source_key], path, xp,
        )
        validate_record(record)
        by_family[record["family"]].append(record)
        totals["layers"] += 1
        totals["raw_cells"] += record["coverage"]["raw_cells"]
        totals["visible_cells"] += record["coverage"]["visible_cells"]
        totals["transparent_cells"] += record["coverage"]["transparent_cells"]
        totals["spans"] += record["coverage"]["spans"]
        state = record["layer_semantics"]["review_state"]
        review_states[state] += 1
        if state == "unresolved_hand_evidence":
            unresolved.append(source_key)

    for source_rel in sorted(xp_cache):
        path, xp = xp_cache[source_rel]
        card = representative_card_by_xp[source_rel]
        for layer_index in (0, 1):
            record = build_metadata_layer_record(card, path, xp, layer_index)
            validate_record(record)
            by_family[record["family"]].append(record)
            totals["layers"] += 1
            totals["engine_metadata_layers"] += 1
            totals["raw_cells"] += record["coverage"]["raw_cells"]
            totals["visible_cells"] += record["coverage"]["visible_cells"]
            totals["transparent_cells"] += record["coverage"]["transparent_cells"]
            totals["spans"] += record["coverage"]["spans"]
            review_states[record["layer_semantics"]["review_state"]] += 1

    for rows in by_family.values():
        rows.sort(key=lambda row: row["source_key"])

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "authority": False,
        "is_proposal": True,
        "rq": "RQ-200",
        "fl": "FL-4162",
        "cell_addressing": "all raw atlas cells covered exactly once by compact frame-row horizontal spans",
        "cell_span_encoding": ["angle", "frame", "local_y", "local_x_start", "length", "cell_value_index"],
        "source_final": {"path": str(state_final), "sha256": EXPECTED_STATE_FINAL_SHA256},
        "input_counts": {
            "source_xp_files": len(xp_cache),
            "state_final_rows": len(state_rows),
            "evidence_cards": len(cards),
            "manual_reviews": len(manual_by_key),
            "review_decisions": len(decision_by_key),
            "family_topology_cards": len(topo_by_key),
        },
        "totals": dict(totals),
        "family_layers": {family: len(rows) for family, rows in sorted(by_family.items())},
        "review_states": dict(sorted(review_states.items())),
        "unresolved_source_keys": unresolved,
        "authority_boundary": "Evidence ledger only. No row is compiler or runtime authority.",
    }
    return dict(sorted(by_family.items())), manifest


def write_outputs(by_family: dict[str, list[dict[str, Any]]], manifest: dict[str, Any], out: Path) -> None:
    shards = []
    for family, rows in by_family.items():
        path = out / f"{family}.jsonl"
        data = b"".join(
            (json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
            for row in rows
        )
        atomic_write(path, data)
        shards.append({"family": family, "path": path.name, "records": len(rows),
                       "sha256": hashlib.sha256(data).hexdigest()})
    manifest = dict(manifest)
    manifest["shards"] = shards
    atomic_write(out / "manifest.json", (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-final", type=Path, default=DEFAULT_STATE_FINAL)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true", help="validate full corpus without writing")
    args = parser.parse_args(argv)
    try:
        by_family, manifest = build_all(args.state_final)
        if not args.check:
            write_outputs(by_family, manifest, args.out)
    except CellContractError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
