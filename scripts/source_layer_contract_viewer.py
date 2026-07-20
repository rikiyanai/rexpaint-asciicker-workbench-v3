#!/usr/bin/env python3
"""FL-4162 — Source Layer Contract Viewer (READ-ONLY).

A fresh, read-only inspector for the FL-4162 review/contract surfaces. It is NOT a
fork of xp_uv_body_viewer.py: it deliberately does not carry the anchor-region
editor owner (frames[].regions[], assignment keys, save paths, body-map toggles,
composite/mutation state). It only renders pure pixels and joins read-only data.

It borrows ONLY the pure-rendering idea from xp_uv_body_viewer.py — a cell is
visible iff its bg is not the magenta key (255,0,255) and its glyph is non-zero —
with attribution here. Everything else is new and read-only.

What it shows across the complete reviewed upstream XP corpus:
  * every raw layer in all reviewed XP files, including engine metadata L0/L1,
  * the original cells sliced per frame/angle from card geometry, with autoplay,
  * immutable hand/proposal evidence separately from frozen reviewed cell roles,
  * topology class, blockers,
  * glyph exact/near match evidence, and a role-focus grid over the stem's layers.
  * corpus, layer, frame, and angle navigation plus include/hide/highlight controls.

Hard read-only guarantees (Canon Law: old owner stays dead):
  * opens XP + four FL-4162 artifacts read-only; writes NOTHING to disk;
  * never touches frames[].regions[], never promotes a semantic map, never feeds
    compiler authority. It is an inspection surface only.

Inputs (read-only):
  assets/sprites/<stem>.xp
  docs/research/ascii/semantic_maps/layer_evidence_cards.jsonl
  docs/research/ascii/semantic_maps/source_layer_review_decisions.jsonl
  docs/research/ascii/semantic_maps/manual_candidate_review.json
  docs/research/ascii/semantic_maps/family_topology_contracts.json
  docs/research/ascii/semantic_maps/upstream_xp_cell_contract/family_contract_freeze.json
  docs/research/ascii/semantic_maps/upstream_xp_cell_contract/cell_role_decisions.jsonl
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import select
import sys
import termios
import tty
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import xp_core  # noqa: E402  (the shared XP parser — single owner)
import build_upstream_xp_cell_review_queue as cell_review  # noqa: E402
import compare_upstream_xp_cell_contracts as cell_contracts  # noqa: E402
import record_upstream_xp_coordinate_cell_decision as coordinate_recorder  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
SPRITES = REPO_ROOT / "assets/sprites"
CELL_CONTRACT = SM / "upstream_xp_cell_contract"
MAGENTA_KEY = (255, 0, 255)  # transparency key (idea borrowed from xp_uv_body_viewer)


# --------------------------------------------------------------------------- #
# Read-only data loading
# --------------------------------------------------------------------------- #
class ContractDataError(Exception):
    """FL-4162: a required read-only input was missing or malformed."""


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise ContractDataError(f"missing read-only input: {path}")
    out = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError as exc:
            raise ContractDataError(f"{path}:{lineno}: malformed JSONL: {exc}") from exc
    return out


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ContractDataError(f"missing read-only input: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ContractDataError(f"malformed JSON {path}: {exc}") from exc


def _sha256_file(path: Path) -> str:
    try:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError as exc:
        raise ContractDataError(f"cannot hash read-only input {path}: {exc}") from exc


def _index_jsonl(path: Path, key_field: str) -> tuple[
    dict[str, tuple[int, int]], str, dict[str, str]
]:
    """Validate a JSONL file and retain byte offsets instead of its large rows."""
    if not path.is_file():
        raise ContractDataError(f"missing read-only input: {path}")
    index: dict[str, tuple[int, int]] = {}
    source_paths: dict[str, str] = {}
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            lineno = 0
            while True:
                offset = handle.tell()
                line = handle.readline()
                if not line:
                    break
                lineno += 1
                digest.update(line)
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError as exc:
                    raise ContractDataError(
                        f"{path}:{lineno}: malformed JSONL: {exc}"
                    ) from exc
                key = str(row.get(key_field) or "")
                if not key or key in index:
                    raise ContractDataError(
                        f"{path}:{lineno}: missing or duplicate {key_field}: {key!r}"
                    )
                index[key] = (offset, len(line))
                source_path = str((row.get("source_xp") or {}).get("path") or "")
                if source_path:
                    source_paths[key] = source_path
    except OSError as exc:
        raise ContractDataError(f"cannot read {path}: {exc}") from exc
    return index, digest.hexdigest(), source_paths


def _read_indexed_json(path: Path, location: tuple[int, int]) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            handle.seek(location[0])
            return json.loads(handle.read(location[1]))
    except (OSError, ValueError) as exc:
        raise ContractDataError(f"cannot reload indexed JSONL row from {path}: {exc}") from exc


class ContractData:
    """FL-4162 evidence plus the read-only full-cell contract surfaces."""

    def __init__(self, sm: Path = SM, cell_contract: Path | None = None):
        self.cards = {str(c.get("source_key") or c.get("card_id")): c
                      for c in _read_jsonl(sm / "layer_evidence_cards.jsonl")}
        self.decisions = {str(d["source_key"]): d
                          for d in _read_jsonl(sm / "source_layer_review_decisions.jsonl")}
        packet = _read_json(sm / "manual_candidate_review.json")
        self.verdicts = {str(r["card_id"]): r for r in packet.get("reviewed", [])}
        contracts = _read_json(sm / "family_topology_contracts.json")
        self.topo_class: dict[str, str] = {}
        self.role_conflicts: dict[str, list[str]] = {}
        for fam, contract in contracts.get("contracts", {}).items():
            for pc in contract.get("per_card", []):
                self.topo_class[str(pc["card_id"])] = pc.get("classification")
            for conflict in contract.get("role_name_conflicts", []):
                for m in conflict.get("members", []):
                    self.role_conflicts.setdefault(str(m.get("card_id")), []).extend(
                        conflict.get("distinct_role_sets", []))
        self.cell_contract = cell_contract or sm / "upstream_xp_cell_contract"
        manifest = _read_json(self.cell_contract / "manifest.json")
        if manifest.get("authority") is not False or manifest.get("is_proposal") is not True:
            raise ContractDataError("full-cell ledger must be authority:false proposal")
        self._cell_record_index: dict[str, tuple[Path, int, int]] = {}
        self._source_path_by_key: dict[str, str] = {}
        for shard in manifest.get("shards") or []:
            shard_path = self.cell_contract / str(shard.get("path") or "")
            shard_index, digest, source_paths = _index_jsonl(shard_path, "source_key")
            if digest != shard.get("sha256"):
                raise ContractDataError(f"full-cell ledger shard hash mismatch: {shard_path}")
            if len(shard_index) != int(shard.get("records", -1)):
                raise ContractDataError(f"full-cell ledger shard count mismatch: {shard_path}")
            duplicates = set(self._cell_record_index) & set(shard_index)
            if duplicates:
                raise ContractDataError(f"duplicate full-cell ledger keys: {sorted(duplicates)}")
            self._cell_record_index.update({
                key: (shard_path, offset, length)
                for key, (offset, length) in shard_index.items()
            })
            self._source_path_by_key.update(source_paths)
        expected_layers = int((manifest.get("totals") or {}).get("layers", -1))
        if len(self._cell_record_index) != expected_layers:
            raise ContractDataError("full-cell ledger record count does not match manifest")
        self.review_doc = _read_json(self.cell_contract / "review_queue.json")
        if (
            self.review_doc.get("authority") is not False
            or self.review_doc.get("is_proposal") is not True
        ):
            raise ContractDataError("cell review queue must be authority:false proposal")
        self._cell_decision_path = self.cell_contract / "cell_role_decisions.jsonl"
        decision_index, decision_digest, _decision_source_paths = _index_jsonl(
            self._cell_decision_path, "review_unit_id"
        )
        self._cell_decision_index = decision_index
        freeze_path = self.cell_contract / "family_contract_freeze.json"
        freeze = _read_json(freeze_path)
        if (
            freeze.get("frozen") is not True
            or freeze.get("is_proposal") is not False
            or freeze.get("runtime_authoritative") is not False
            or freeze.get("contract_authority") != "reviewed_upstream_source_contract"
        ):
            raise ContractDataError("family contract freeze has an invalid authority boundary")
        freeze_hashes = freeze.get("source_hashes") or {}
        if freeze_hashes.get("cell_contract_manifest_sha256") != _sha256_file(
            self.cell_contract / "manifest.json"
        ):
            raise ContractDataError("family contract freeze manifest hash mismatch")
        if freeze_hashes.get("cell_role_decisions_sha256") != decision_digest:
            raise ContractDataError("family contract freeze cell-decision hash mismatch")
        self.contract_authority = str(freeze["contract_authority"])
        self.review_units_by_key: dict[str, dict[str, Any]] = {}
        for unit in self.review_doc.get("review_units") or []:
            for key in unit.get("member_source_keys") or []:
                if key in self.review_units_by_key:
                    raise ContractDataError(f"duplicate full-cell review membership: {key}")
                self.review_units_by_key[key] = unit
        if set(self.review_units_by_key) != set(self._cell_record_index):
            raise ContractDataError("full-cell review queue does not cover the ledger exactly")
        decided_in_queue = {
            unit["review_unit_id"] for unit in self.review_doc.get("review_units") or []
            if unit.get("decision_record") is not None
        }
        if decided_in_queue != set(self._cell_decision_index):
            raise ContractDataError("full-cell decisions do not match the generated review queue")
        self.assignment_preview_key: str | None = None
        self.assignment_preview_decision: dict[str, Any] | None = None
        self._cell_record_cache: dict[str, dict[str, Any]] = {}
        self._cell_decision_cache: dict[str, dict[str, Any]] = {}
        self._expanded_cells: dict[str, dict[tuple[int, int, int, int], dict[str, Any]]] = {}
        self._validated_decision_units: set[str] = set()
        self.corpus_totals = {
            "xp_files": len(self.stems()),
            "layers": expected_layers,
            "visual_layers": len(self.cards),
            "engine_metadata_layers": int(
                (manifest.get("totals") or {}).get("engine_metadata_layers", 0)
            ),
            "raw_cells": int((manifest.get("totals") or {}).get("raw_cells", 0)),
            "visible_cells": int((manifest.get("totals") or {}).get("visible_cells", 0)),
        }

    def layer_keys_for_stem(self, stem: str) -> list[str]:
        # FL-4162: the full-cell ledger is the corpus owner.  Evidence cards cover
        # only hand-labelled visual layers (L2+); using them as the picker silently
        # dropped all 230 reviewed upstream engine-metadata layers.
        xp_id = self.resolve_xp_id(stem)
        keys = [
            key for key in self._cell_record_index
            if self.xp_id_for_key(key) == xp_id
        ]
        return sorted(keys, key=lambda k: int(k.rsplit("-L", 1)[1]))

    def stems(self) -> list[str]:
        return sorted({self.xp_id_for_key(key) for key in self._cell_record_index})

    def corpus_layer_map(self) -> dict[str, list[str]]:
        return {stem: self.layer_keys_for_stem(stem) for stem in self.stems()}

    def xp_id_for_key(self, source_key: str) -> str:
        source_path = self._source_path_by_key.get(source_key)
        if not source_path:
            raise ContractDataError(f"missing indexed source XP path: {source_key}")
        return Path(source_path).stem

    def resolve_xp_id(self, value: str) -> str:
        physical_stems = {
            self.xp_id_for_key(key) for key in self._cell_record_index
        }
        if value in physical_stems:
            return value
        matches = {
            self.xp_id_for_key(key) for key in self._cell_record_index
            if key.rsplit("-L", 1)[0] == value
        }
        return next(iter(matches)) if len(matches) == 1 else value

    def join(self, source_key: str) -> dict[str, Any]:
        card = self.cards.get(source_key, {})
        decision = self.decisions.get(source_key, {})
        verdict_row = self.verdicts.get(source_key, {})
        verdict = verdict_row.get("agent_verdict", {})
        contract_record = self.cell_record(source_key)
        hand = card.get("hand") or contract_record.get("hand_evidence") or {}
        cells = card.get("cells", {})
        sim = card.get("glyph_similarity", {})
        layer_semantics = contract_record.get("layer_semantics") or {}
        implication = contract_record.get("actor_visual_profile_implication") or {}
        exceptions = contract_record.get("exceptions") or {}
        blockers = []
        cls = self.topo_class.get(source_key) or layer_semantics.get("topology_class")
        if cls in {"unresolved", "rejected"}:
            blockers.append(f"unowned:{cls}")
        if verdict.get("unresolved"):
            blockers.append("unresolved_proposal")
        if source_key in self.role_conflicts:
            blockers.append("role_name_conflict")
        if len(verdict.get("proposed_roles") or []) > 1:
            blockers.append("composite_layer")
        return {
            "source_key": source_key,
            "raw_layer_index": card.get("raw_layer_index", contract_record.get("raw_layer_index")),
            "hand_status": hand.get("status"),
            "hand_label": hand.get("corrected_label"),
            "hand_note": hand.get("note"),
            "machine_guess": hand.get("pre_guess"),
            "machine_guess_source": hand.get("pre_source"),
            "proposed_roles": decision.get("composite_roles")
            or verdict.get("proposed_roles")
            or layer_semantics.get("candidate_roles")
            or implication.get("candidate_roles") or [],
            "authority": decision.get("authority"),
            "topology_class": cls,
            "blockers": blockers,
            "exact_matches": sim.get("exact_matches") or card.get("glyph_exact_matches")
            or exceptions.get("glyph_exact_matches") or [],
            "near_matches": sim.get("near_matches") or card.get("glyph_near_matches")
            or exceptions.get("glyph_near_matches") or [],
            "contradictions": verdict.get("contradictions")
            or exceptions.get("contradictions") or [],
            "topology_note": verdict.get("topology_note")
            or exceptions.get("topology_note") or "",
            "queue_class": verdict_row.get("queue_class")
            or layer_semantics.get("review_state")
            or implication.get("state"),
            "frame_topology": (card.get("engine") or {}).get("frame_topology") or {},
            "frame_wh": cells.get("frame_wh") or [
                int((contract_record.get("frame_geometry") or {}).get("frame_width", 0)),
                int((contract_record.get("frame_geometry") or {}).get("frame_height", 0)),
            ],
        }

    def cell_record(self, source_key: str) -> dict[str, Any]:
        if source_key not in self._cell_record_cache:
            location = self._cell_record_index.get(source_key)
            if location is None:
                raise ContractDataError(f"missing full-cell ledger record: {source_key}")
            path, offset, length = location
            self._cell_record_cache[source_key] = _read_indexed_json(
                path, (offset, length)
            )
        return self._cell_record_cache[source_key]

    def source_xp_path(self, source_key: str) -> Path:
        record = self.cell_record(source_key)
        raw_path_value = str((record.get("source_xp") or {}).get("path") or "")
        if not raw_path_value:
            raise ContractDataError(f"missing source XP path: {source_key}")
        return Path(raw_path_value)

    def expanded_cells(self, source_key: str) -> dict[tuple[int, int, int, int], dict[str, Any]]:
        if source_key not in self._expanded_cells:
            try:
                self._expanded_cells[source_key] = cell_contracts.expand_cells(
                    self.cell_record(source_key)
                )
            except cell_contracts.ComparisonError as exc:
                raise ContractDataError(f"invalid cell ledger record: {exc}") from exc
        return self._expanded_cells[source_key]

    def _recorded_decision_for(self, source_key: str) -> dict[str, Any] | None:
        unit = self.review_units_by_key[source_key]
        unit_id = unit["review_unit_id"]
        decision = None
        if unit_id in self._cell_decision_index:
            if unit_id not in self._cell_decision_cache:
                self._cell_decision_cache[unit_id] = _read_indexed_json(
                    self._cell_decision_path, self._cell_decision_index[unit_id]
                )
            decision = self._cell_decision_cache[unit_id]
        if decision is not None and unit_id not in self._validated_decision_units:
            mini_doc = {
                "review_units": [copy.deepcopy(unit)],
                "coverage": {},
                "freeze_gate": {},
            }
            try:
                cell_review.apply_decisions(
                    mini_doc,
                    {unit_id: decision},
                    {unit["representative_source_key"]: self.cell_record(
                        unit["representative_source_key"]
                    )},
                )
            except cell_review.ReviewQueueError as exc:
                raise ContractDataError(f"invalid full-cell decision: {exc}") from exc
            self._validated_decision_units.add(unit_id)
        return decision

    def decision_for(self, source_key: str) -> tuple[dict[str, Any] | None, bool]:
        if source_key == self.assignment_preview_key:
            return self.assignment_preview_decision, True
        return self._recorded_decision_for(source_key), False

    def reviewed_roles(self, source_key: str) -> list[str]:
        decision = self._recorded_decision_for(source_key)
        if decision is None:
            return []
        return sorted({
            role
            for assignment in decision.get("cell_assignments") or []
            for role in ((assignment[6] or []) if len(assignment) > 6 else [])
            if role
        })

    def load_assignment_preview(self, path: Path) -> str:
        try:
            assignment = coordinate_recorder.load_assignment(path)
            source_key = str(assignment.get("source_key") or "")
            if source_key not in self._cell_record_index:
                raise cell_review.ReviewQueueError(
                    f"assignment preview has unknown source key: {source_key}"
                )
            unit = self.review_units_by_key[source_key]
            decision = coordinate_recorder.build_decision(
                unit,
                self.cell_record(source_key),
                assignment,
                "read-only assignment preview",
                [str(path)],
                [],
                "source_layer_contract_viewer",
                "read_only_preview",
            )
        except (OSError, cell_review.ReviewQueueError) as exc:
            raise ContractDataError(f"invalid assignment preview: {exc}") from exc
        self.assignment_preview_key = source_key
        self.assignment_preview_decision = decision
        return source_key

    def cell_review_frame(self, source_key: str, angle: int, frame: int) -> dict[str, Any]:
        record = self.cell_record(source_key)
        unit = self.review_units_by_key[source_key]
        decision, is_preview = self.decision_for(source_key)
        assigned = (
            cell_review._assignment_coordinates(decision.get("cell_assignments") or [])
            if decision is not None else {}
        )
        cells = self.expanded_cells(source_key)
        frame_cells = {
            coordinate: value for coordinate, value in cells.items()
            if coordinate[0] == angle and coordinate[1] == frame
        }
        visible = {
            coordinate for coordinate, value in frame_cells.items()
            if value.get("cell_type") != "transparent"
        }
        semantic_sets = sorted({
            semantic for coordinate, (_operation, semantic) in assigned.items()
            if coordinate in visible and semantic
        })
        token_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        tokens = {
            semantic: token_chars[index] if index < len(token_chars) else "*"
            for index, semantic in enumerate(semantic_sets)
        }
        geometry = record["frame_geometry"]
        rows = []
        unresolved = []
        for y in range(int(geometry["frame_height"])):
            row = []
            for x in range(int(geometry["frame_width"])):
                coordinate = (angle, frame, y, x)
                value = frame_cells.get(coordinate)
                if value is None or value.get("cell_type") == "transparent":
                    row.append(".")
                elif coordinate not in assigned or not assigned[coordinate][1]:
                    row.append("?")
                    unresolved.append(coordinate)
                else:
                    row.append(tokens[assigned[coordinate][1]])
            rows.append("".join(row))
        return {
            "review_unit_id": unit["review_unit_id"],
            "decision_state": unit["decision_state"],
            "decided": decision is not None and not is_preview,
            "is_preview": is_preview,
            "source_xp_path": str(self.source_xp_path(source_key)),
            "visible_cells": len(visible),
            "assigned_visible_cells": len(visible) - len(unresolved),
            "unresolved_coordinates": unresolved,
            "grid": rows,
            "legend": [(tokens[semantic], list(semantic)) for semantic in semantic_sets],
        }


class MicroscopeGroup:
    """FL-4162 microscope packet: per-group raw XP dumps + engine refs. READ-ONLY."""

    def __init__(self, path: Path):
        if not path.is_file():
            raise ContractDataError(f"missing microscope packet: {path}")
        try:
            self.packet = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise ContractDataError(f"malformed microscope packet {path}: {exc}") from exc
        if self.packet.get("authority"):
            raise ContractDataError(f"microscope packet claims authority (must be false): {path}")
        self.cards = {c["source_key"]: c for c in self.packet.get("cards", [])}
        self.engine_refs = self.packet.get("engine_refs", {})
        self.group_name = self.packet.get("group_name", path.stem)


# --------------------------------------------------------------------------- #
# Frame slicing (card geometry) + pure rendering
# --------------------------------------------------------------------------- #
# FL-4162: Python's cp437 codec maps the IBM-PC graphical control range to C0
# controls.  The XP contract owns these as visible one-cell glyphs, so preserve
# their exact identity instead of collapsing distinct bytes to "?".
CP437_GRAPHICAL_CONTROLS = {
    1: "☺", 2: "☻", 3: "♥", 4: "♦", 5: "♣", 6: "♠", 7: "•", 8: "◘",
    9: "○", 10: "◙", 11: "♂", 12: "♀", 13: "♪", 14: "♫", 15: "☼",
    16: "►", 17: "◄", 18: "↕", 19: "‼", 20: "¶", 21: "§", 22: "▬",
    23: "↨", 24: "↑", 25: "↓", 26: "→", 27: "←", 28: "∟", 29: "↔",
    30: "▲", 31: "▼", 127: "⌂",
}


def _glyph_char(glyph: int) -> str:
    if glyph in (0, 32):
        return " "
    if glyph in CP437_GRAPHICAL_CONTROLS:
        return CP437_GRAPHICAL_CONTROLS[glyph]
    if 33 <= glyph <= 126:
        return chr(glyph)
    if 0 <= glyph <= 255:
        try:
            ch = bytes([glyph]).decode("cp437")
            return ch if ch.isprintable() else "?"
        except Exception:
            return "?"
    return "?"


def slice_frame(layer: "xp_core.XPLayer", frame_wh, angle: int, frame: int):
    """Return the (glyph,fg,bg) grid for one frame/angle, using card geometry.

    Atlas is row-major data[y][x]; frame_wh=[fw,fh]; columns=W//fw frames per angle
    row, rows=H//fh angle rows. Clamped to the real grid so slightly-off metadata
    degrades to a valid frame instead of crashing.
    """
    if not frame_wh or len(frame_wh) != 2:
        return None
    fw, fh = int(frame_wh[0]), int(frame_wh[1])
    if fw <= 0 or fh <= 0:
        return None
    cols = max(1, layer.width // fw)
    rows = max(1, layer.height // fh)
    a = max(0, min(angle, rows - 1))
    f = max(0, min(frame, cols - 1))
    y0, x0 = a * fh, f * fw
    grid = []
    for yy in range(y0, min(y0 + fh, layer.height)):
        row = []
        for xx in range(x0, min(x0 + fw, layer.width)):
            row.append(layer.data[yy][xx])
        grid.append(row)
    return {"grid": grid, "cols": cols, "rows": rows, "fw": fw, "fh": fh}


def render_cells_ansi(grid, *, raw_metadata: bool = False,
                      highlight_mask: list[list[bool]] | None = None) -> list[str]:
    """Pure render with optional metadata visibility and per-cell highlighting."""
    lines = []
    for y, row in enumerate(grid):
        parts = []
        for x, (glyph, fg, bg) in enumerate(row):
            bg = tuple(bg)
            if not raw_metadata and (bg == MAGENTA_KEY or glyph in (0,)):
                parts.append(" ")
                continue
            fr, fgg, fb = fg
            br, bgg, bb = bg
            ch = "·" if raw_metadata and glyph in (0, 32) else _glyph_char(glyph)
            highlighted = bool(
                highlight_mask is not None
                and y < len(highlight_mask)
                and x < len(highlight_mask[y])
                and highlight_mask[y][x]
            )
            emphasis = "\x1b[7;1m" if highlighted else ""
            parts.append(
                f"{emphasis}\x1b[38;2;{fr};{fgg};{fb}m"
                f"\x1b[48;2;{br};{bgg};{bb}m{ch}\x1b[0m"
            )
        lines.append("".join(parts))
    return lines


# --------------------------------------------------------------------------- #
# View state + frame composition (text, no terminal control — testable)
# --------------------------------------------------------------------------- #
class ViewerState:
    def __init__(self, stem: str, layer_keys: list[str], microscope: "MicroscopeGroup | None" = None,
                 sprites: Path = SPRITES,
                 corpus_layer_keys: dict[str, list[str]] | None = None):
        self.stem = stem
        self.layer_keys = layer_keys
        self.corpus_layer_keys = corpus_layer_keys or {}
        self.corpus_stems = list(self.corpus_layer_keys)
        self.stem_idx = self.corpus_stems.index(stem) if stem in self.corpus_stems else 0
        self.microscope = microscope
        self.sprites = sprites
        self._xp_cache: dict[str, "xp_core.XPFile"] = {}
        self.layer_idx = 0
        self.angle = 0
        self.frame = 0
        self.autoplay = True
        self.autoplay_axis = "frame"   # or "angle"
        self.role_focus: str | None = None
        self.stack_mode = False
        self.highlight_current = True
        self.hidden_layer_keys: set[str] = set()
        self.status = ""

    @property
    def current_key(self) -> str:
        return self.layer_keys[self.layer_idx]

    def current_stem(self) -> str:
        if self.corpus_layer_keys:
            return self.stem
        return self.current_key.rsplit("-L", 1)[0]

    def change_stem(self, delta: int) -> None:
        if not self.corpus_stems:
            return
        self.stem_idx = (self.stem_idx + delta) % len(self.corpus_stems)
        self.stem = self.corpus_stems[self.stem_idx]
        self.layer_keys = self.corpus_layer_keys[self.stem]
        self.layer_idx = 0
        self.angle = 0
        self.frame = 0
        self.role_focus = None

    def xp_for_key(self, source_key: str, data: ContractData) -> "xp_core.XPFile":
        source_path = data.source_xp_path(source_key)
        candidate = self.sprites / source_path.name
        path = candidate if candidate.is_file() else REPO_ROOT / source_path
        cache_key = str(path.resolve())
        if cache_key not in self._xp_cache:
            self._xp_cache[cache_key] = load_xp_path(path)
        return self._xp_cache[cache_key]


def compose_layer_stack(state: ViewerState, data: ContractData):
    """Compose included visual layers for inspection; return cells and owner mask.

    This is a read-only discovery projection.  It applies ordinal visible-cell
    overwrite so reviewers can include, hide, and highlight source contributions;
    it does not claim compiler/runtime composition authority.
    """
    visual_keys = [
        key for key in state.layer_keys
        if int(key.rsplit("-L", 1)[1]) >= 2 and key not in state.hidden_layer_keys
    ]
    if not visual_keys:
        return None
    visual_keys.sort(key=lambda key: int(key.rsplit("-L", 1)[1]))
    xp = state.xp_for_key(visual_keys[0], data)
    composite = None
    owners: list[list[str | None]] = []
    cols = rows = fw = fh = 0
    for key in visual_keys:
        info = data.join(key)
        idx = info["raw_layer_index"]
        if not isinstance(idx, int) or idx >= len(xp.layers):
            continue
        sliced = slice_frame(xp.layers[idx], info["frame_wh"], state.angle, state.frame)
        if not sliced:
            continue
        if composite is None:
            composite = [[(0, (0, 0, 0), MAGENTA_KEY) for _ in row]
                         for row in sliced["grid"]]
            owners = [[None for _ in row] for row in sliced["grid"]]
            cols, rows, fw, fh = sliced["cols"], sliced["rows"], sliced["fw"], sliced["fh"]
        for y, row in enumerate(sliced["grid"]):
            if y >= len(composite):
                continue
            for x, cell in enumerate(row):
                if x >= len(composite[y]):
                    continue
                glyph, _fg, bg = cell
                if tuple(bg) == MAGENTA_KEY or glyph == 0:
                    continue
                composite[y][x] = cell
                owners[y][x] = key
    if composite is None:
        return None
    highlight_mask = [
        [state.highlight_current and owner == state.current_key for owner in row]
        for row in owners
    ]
    return {
        "grid": composite,
        "highlight_mask": highlight_mask,
        "included_keys": visual_keys,
        "cols": cols,
        "rows": rows,
        "fw": fw,
        "fh": fh,
    }


def _layer_is_cyan_swoosh(layer) -> bool:
    """A final layer is the weapon_swoosh when its occupied cells are predominantly
    cyan-fg (upstream sprite.cpp:361 special-case). Read-only check."""
    occ = cyan = 0
    for row in getattr(layer, "data", []):
        for glyph, fg, _bg in row:
            if glyph not in (0, 32):
                occ += 1
                if tuple(fg) == (0, 255, 255):
                    cyan += 1
    return occ > 0 and cyan / occ >= 0.5


def classify_cell(glyph: int, fg: tuple[int, int, int] | list[int], bg: tuple[int, int, int] | list[int], layer_idx: int, n_layers: int) -> str:
    """FL-4162 read-only cell taxonomy tied to the upstream sprite.cpp contract.

    Cell types:
      transparent   - magenta bg or zero glyph (REXPaint / engine hard-transparent key).
      color_key     - L0 bg carries the per-cell transparency key.
      height_digit  - L1 glyph encodes height/ID (sprite.cpp:351).
      body_pixel    - L2 primary visual base accumulator (sprite.cpp:352).
      swoosh_pixel  - final layer with cyan fg (upstream sprite.cpp:361 special-case).
      overlay_pixel - any other L3+ occupied cell.
    """
    bg_t = tuple(bg) if not isinstance(bg, tuple) else bg
    fg_t = tuple(fg) if not isinstance(fg, tuple) else fg
    if layer_idx == 0:
        return "color_key"
    if layer_idx == 1:
        return "height_digit"
    if bg_t == MAGENTA_KEY or glyph == 0:
        return "transparent"
    if layer_idx == 2:
        return "body_pixel"
    if layer_idx == n_layers - 1 and fg_t == (0, 255, 255):
        return "swoosh_pixel"
    return "overlay_pixel"


def _engine_ref(idx, n_layers: int, layer) -> str:
    """Upstream annotation pinned to upstream/master @ 8ff75d0c (ENGINE_REFS.json).
    Local correspondence is separate and live; see local_engine_correspondence()."""
    if not isinstance(idx, int):
        return "metadata / non-visual layer"
    if idx == 0:
        return "L0 color key (bg) -- upstream sprite.cpp:350"
    if idx == 1:
        return "L1 height channel glyph -- upstream sprite.cpp:351"
    if idx == 2:
        return "L2 primary visual / base accumulator -- upstream sprite.cpp:352"
    if idx == n_layers - 1:
        if layer is not None and _layer_is_cyan_swoosh(layer):
            return "final layer fg==cyan -> swoosh composition -- upstream sprite.cpp:361"
        return "final overlay -> folds into L2 -- upstream sprite.cpp:354-360"
    return f"overlay L{idx} -> folds into L2 in ordinal order -- upstream sprite.cpp:354-360"


def local_engine_correspondence(idx: int, n_layers: int, layer) -> str:
    """Live Y9-2 engine/sprite.cpp line ranges that implement the upstream contract.
    These are mutable; the upstream refs above are the authority surface."""
    if not isinstance(idx, int):
        return "metadata / non-visual layer"
    if idx == 0:
        return "L0 color key (bg) -- local engine/sprite.cpp:619"
    if idx == 1:
        return "L1 height channel glyph -- local engine/sprite.cpp:620"
    if idx == 2:
        return "L2 primary visual / base accumulator -- local engine/sprite.cpp:621"
    if idx == n_layers - 1:
        if layer is not None and _layer_is_cyan_swoosh(layer):
            return "final layer fg==cyan -> swoosh composition -- local engine/sprite.cpp:1034-1200"
        return "final overlay overwrites L2 -- local engine/sprite.cpp:1029-1044, 1201-1203"
    return f"overlay L{idx} overwrites L2 -- local engine/sprite.cpp:1029-1044, 1201-1203"


def compose_screen(state: ViewerState, data: ContractData) -> str:
    key = state.current_key
    info = data.join(key)
    idx = info["raw_layer_index"]
    stem = state.current_stem()
    xp = state.xp_for_key(key, data)
    layer = xp.layers[idx] if isinstance(idx, int) and 0 <= idx < len(xp.layers) else None

    out: list[str] = []
    foc = f"  ROLE-FOCUS={state.role_focus}" if state.role_focus else ""
    corpus_position = (
        f"  XP {state.stem_idx + 1}/{len(state.corpus_stems)}"
        if state.corpus_stems else ""
    )
    view_mode = "STACK" if state.stack_mode else "ISOLATED"
    inclusion = "HIDDEN-FROM-STACK" if key in state.hidden_layer_keys else "INCLUDED"
    highlight = "ON" if state.highlight_current else "OFF"
    out.append(f"== SOURCE LAYER CONTRACT VIEWER (READ-ONLY) :: {state.current_stem()} =="
               f"{corpus_position}"
               f"  layer {state.layer_idx + 1}/{len(state.layer_keys)}"
               f"  angle {state.angle}  frame {state.frame}"
               f"  view={view_mode}  highlight={highlight}  {inclusion}"
               f"  autoplay={'ON:' + state.autoplay_axis if state.autoplay else 'OFF'}{foc}")
    totals = data.corpus_totals
    out.append(
        "CORPUS: "
        f"{totals['xp_files']} XP / {totals['layers']} raw layers "
        f"({totals['visual_layers']} hand-reviewed visual + "
        f"{totals['engine_metadata_layers']} engine metadata) / "
        f"{totals['raw_cells']:,} cells / {totals['visible_cells']:,} visible"
    )
    out.append("")

    if state.stack_mode:
        stack = compose_layer_stack(state, data)
        if stack:
            selected_note = (
                f"selected {key} highlighted"
                if state.highlight_current and isinstance(idx, int) and idx >= 2
                else f"selected {key} unhighlighted"
            )
            out.append(
                f"-- DISPLAY-ONLY VISUAL STACK ({len(stack['included_keys'])} included; "
                f"{selected_note}; ordinal overwrite; not compiler authority) --"
            )
            out.extend(render_cells_ansi(
                stack["grid"], highlight_mask=stack["highlight_mask"]
            ))
        else:
            out.append("-- DISPLAY-ONLY VISUAL STACK: all visual layers hidden --")
    elif layer is not None and info["frame_wh"]:
        sliced = slice_frame(layer, info["frame_wh"], state.angle, state.frame)
        if sliced:
            out.append(f"-- {key}  (raw layer L{idx}, frame {state.frame + 1}/{sliced['cols']},"
                       f" angle {state.angle + 1}/{sliced['rows']}, {sliced['fw']}x{sliced['fh']}) --")
            current_mask = [
                [state.highlight_current for _ in row] for row in sliced["grid"]
            ]
            out.extend(render_cells_ansi(
                sliced["grid"],
                raw_metadata=isinstance(idx, int) and idx < 2,
                highlight_mask=current_mask,
            ))
    else:
        out.append(f"-- {key}: no renderable geometry (metadata layer?) --")

    out.append("")
    out.append("-- IMMUTABLE HAND + PROPOSAL EVIDENCE (authority:false) --")
    out.append(f"hand[{info['hand_status']}]: {info['hand_label']!r}")
    if info["hand_note"] and info["hand_note"] != info["hand_label"]:
        out.append(f"hand_note: {info['hand_note']!r}")
    out.append(f"machine_guess: {info['machine_guess']!r} ({info['machine_guess_source']})")
    out.append(f"PROPOSAL ROLE: {';'.join(info['proposed_roles']) or '<none>'}"
               f"   topology_class: {info['topology_class']}   queue: {info['queue_class']}")
    if state.microscope is not None:
        out.append("")
        out.append("-- MICROSCOPE PACKET (authority:false) --")
        mcard = state.microscope.cards.get(key)
        if mcard:
            out.append(f"group: {state.microscope.group_name}")
            out.append(f"dump_scope: frame 0 / angle 0 only; all_atlas_visible_count: {mcard.get('all_atlas_visible_count')} (full atlas)")
            dump = mcard.get("frame_dump", {})
            out.append(f"frame_dump: angle {dump.get('angle')}/{dump.get('angle_count')}, "
                       f"frame {dump.get('frame')}/{dump.get('frame_count')}, "
                       f"size {dump.get('fw')}x{dump.get('fh')}, "
                       f"visible_cells {len(dump.get('visible_cells', []))}")
            out.append(f"visible_glyph_set: {mcard.get('visible_glyph_set')}")
            hist = mcard.get("cell_type_histogram", {})
            if hist:
                non_empty = {k: v for k, v in hist.items() if v > 0 and k != "transparent"}
                out.append(f"cell_type_histogram: {non_empty}")
            coord_index = mcard.get("coordinate_index", {})
            occupied_coords = [k for k, v in coord_index.items() if v.get("cell_type") != "transparent"]
            out.append(f"coordinate_index_size: {len(coord_index)}  occupied_coords: {len(occupied_coords)}")
        refs = state.microscope.engine_refs
        upstream = refs.get("upstream_engine_ref", {})
        local = refs.get("local_engine_correspondence", {})
        if upstream:
            out.append("upstream_engine_ref (pinned @ 8ff75d0c):")
            for ref_name, ref in upstream.items():
                out.append(f"  {ref_name}: sprite.cpp {', '.join(ref['ranges'])} — {ref['summary']}")
        if local:
            out.append("local_engine_correspondence (mutable Y9-2 implementation):")
            for ref_name, ref in local.items():
                out.append(f"  {ref_name}: engine/sprite.cpp {', '.join(ref['ranges'])} — {ref['summary']}")
    out.append(f"blockers: {', '.join(info['blockers']) or 'none'}")
    # Engine anchor: which sprite.cpp role this raw layer plays (read-only annotation).
    out.append(f"engine (upstream 8ff75d0c): {_engine_ref(idx, len(xp.layers), layer)}")
    out.append(f"engine (local Y9-2): {local_engine_correspondence(idx, len(xp.layers), layer)}")
    # Neighboring-layer patterns: adjacent raw layers + frozen reviewed roles, for
    # convention comparison (is this the base, an overlay, the swoosh?). Only same stem.
    same_stem_keys = (
        state.layer_keys
        if state.corpus_layer_keys
        else [k for k in state.layer_keys if k.rsplit("-L", 1)[0] == stem]
    )
    by_idx = {data.join(k)["raw_layer_index"]: k for k in same_stem_keys}
    neigh = []
    for d in (idx - 1, idx + 1) if isinstance(idx, int) else ():
        if d < 2:
            neigh.append(f"L{d}=<metadata>")
        elif d in by_idx:
            nj = data.join(by_idx[d])
            reviewed = ";".join(data.reviewed_roles(by_idx[d])) or "<none>"
            neigh.append(f"L{d}={reviewed}[{nj['topology_class']}]")
    out.append(f"neighbors: {', '.join(neigh) or 'none'}")
    ex, nr = info["exact_matches"], info["near_matches"]
    out.append(f"glyph exact-match peers ({len(ex)}): "
               f"{', '.join(map(str, ex[:6]))}{' ...' if len(ex) > 6 else ''}")
    out.append(f"glyph near-match peers ({len(nr)}): "
               f"{', '.join(map(str, nr[:6]))}{' ...' if len(nr) > 6 else ''}")
    if info["contradictions"]:
        out.append(f"contradiction: {info['contradictions'][0]}")
    if info["topology_note"]:
        out.append(f"topology_note: {info['topology_note']}")

    cell_review_frame = data.cell_review_frame(key, state.angle, state.frame)
    out.append("")
    preview_label = "ASSIGNMENT PREVIEW" if cell_review_frame["is_preview"] else "FROZEN REVIEWED FULL-CELL SOURCE CONTRACT"
    authority = "authority:false" if cell_review_frame["is_preview"] else f"authority:{data.contract_authority}"
    out.append(f"-- {preview_label} ({authority}, runtime_authoritative:false, read-only) --")
    out.append(f"source_xp: {cell_review_frame['source_xp_path']}")
    out.append(
        f"review_unit: {cell_review_frame['review_unit_id']}  "
        f"state={cell_review_frame['decision_state']}  "
        f"decision={'preview' if cell_review_frame['is_preview'] else ('recorded' if cell_review_frame['decided'] else 'pending')}"
    )
    out.append(
        f"current_frame: visible={cell_review_frame['visible_cells']} "
        f"assigned={cell_review_frame['assigned_visible_cells']} "
        f"unresolved={len(cell_review_frame['unresolved_coordinates'])}"
    )
    out.append("assignment_grid: .=transparent ?=unresolved")
    out.extend(f"  {row}" for row in cell_review_frame["grid"])
    for token, semantics in cell_review_frame["legend"]:
        out.append(f"  {token}={';'.join(semantics)}")
    out.append(f"reviewed_roles: {';'.join(data.reviewed_roles(key)) or '<none>'}")
    if cell_review_frame["unresolved_coordinates"]:
        coords = cell_review_frame["unresolved_coordinates"][:12]
        suffix = " ..." if len(cell_review_frame["unresolved_coordinates"]) > 12 else ""
        out.append(f"unresolved_coordinates: {coords}{suffix}")

    out.append("")
    if state.microscope is not None:
        out.append("-- ROLE GRID (group members; current stem highlighted) --")
    else:
        out.append("-- ROLE GRID (this stem's visual layers) --")
    for k in state.layer_keys:
        ji = data.join(k)
        reviewed_role = ";".join(data.reviewed_roles(k)) or "<none>"
        proposal_role = ";".join(ji["proposed_roles"]) or "<none>"
        mark = ">" if k == key else " "
        focus_hit = "*" if (state.role_focus and state.role_focus in data.reviewed_roles(k)) else " "
        visible_mark = "-" if k in state.hidden_layer_keys else "+"
        highlight_mark = "H" if k == key and state.highlight_current else " "
        out.append(f"{mark}{focus_hit}{visible_mark}{highlight_mark} {k:18s} L{ji['raw_layer_index']}"
                   f"  reviewed={reviewed_role:28s} proposal={proposal_role}"
                   f" class={ji['topology_class']}")

    if state.role_focus:
        out.append("")
        out.append(f"-- ROLE-FOCUS EVIDENCE :: {state.role_focus} --")
        hits = [k for k in state.layer_keys if state.role_focus in data.reviewed_roles(k)]
        out.append(f"layers in this stem with reviewed role {state.role_focus}: {hits or 'none'}")
        cur_exact = info["exact_matches"]
        out.append(f"current layer byte-identical peers ({len(cur_exact)}): "
                   f"{', '.join(map(str, cur_exact[:8]))}{' ...' if len(cur_exact) > 8 else ''}")

    if state.status:
        out.append("")
        out.append(state.status)
    out.append("")
    out.append("{ } XP  [ ] layer  , . angle  n/p frame  space autoplay  x axis")
    out.append("c isolated/stack  h highlight  v include/hide layer  a include all  f role-focus  q quit")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Interactive loop (autoplay via select timeout — no sleep)
# --------------------------------------------------------------------------- #
def _advance_autoplay(state: ViewerState, data: ContractData) -> None:
    info = data.join(state.current_key)
    idx = info["raw_layer_index"]
    xp = state.xp_for_key(state.current_key, data)
    layer = xp.layers[idx] if isinstance(idx, int) and 0 <= idx < len(xp.layers) else None
    if layer is None or not info["frame_wh"]:
        return
    sliced = slice_frame(layer, info["frame_wh"], state.angle, state.frame)
    if not sliced:
        return
    if state.autoplay_axis == "frame":
        state.frame = (state.frame + 1) % sliced["cols"]
    else:
        state.angle = (state.angle + 1) % sliced["rows"]


def handle_key(state: ViewerState, ch: str, data: ContractData) -> bool:
    """Return False to quit. Pure state mutation (testable)."""
    n = len(state.layer_keys)
    if ch in ("q", "\x03"):
        return False
    elif ch == "}":
        state.change_stem(1)
    elif ch == "{":
        state.change_stem(-1)
    elif ch == "]":
        state.layer_idx = (state.layer_idx + 1) % n
        state.frame = state.angle = 0
    elif ch == "[":
        state.layer_idx = (state.layer_idx - 1) % n
        state.frame = state.angle = 0
    elif ch == ".":
        state.angle += 1
    elif ch == ",":
        state.angle = max(0, state.angle - 1)
    elif ch == "n":
        state.frame += 1
    elif ch == "p":
        state.frame = max(0, state.frame - 1)
    elif ch == " ":
        state.autoplay = not state.autoplay
    elif ch == "x":
        state.autoplay_axis = "angle" if state.autoplay_axis == "frame" else "frame"
    elif ch == "f":
        roles = data.reviewed_roles(state.current_key)
        state.role_focus = roles[0] if roles and not state.role_focus else None
    elif ch == "c":
        state.stack_mode = not state.stack_mode
    elif ch == "h":
        state.highlight_current = not state.highlight_current
    elif ch == "v":
        if state.current_key in state.hidden_layer_keys:
            state.hidden_layer_keys.remove(state.current_key)
        else:
            state.hidden_layer_keys.add(state.current_key)
    elif ch == "a":
        state.hidden_layer_keys.clear()
    return True


def run_interactive(state: ViewerState, data: ContractData, tick: float = 0.4) -> int:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while True:
            sys.stdout.write("\x1b[H\x1b[2J" + compose_screen(state, data) + "\n")
            sys.stdout.flush()
            ready, _, _ = select.select([sys.stdin], [], [], tick if state.autoplay else None)
            if ready:
                ch = sys.stdin.read(1)
                if not handle_key(state, ch, data):
                    break
            elif state.autoplay:
                _advance_autoplay(state, data)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "stem", nargs="?", default="",
        help="initial XP stem; omitted opens the complete reviewed corpus",
    )
    p.add_argument("--sprites", type=Path, default=SPRITES)
    p.add_argument("--sm", type=Path, default=SM)
    p.add_argument("--cell-contract", type=Path, default=None,
                   help="Full-cell ledger directory (defaults to <sm>/upstream_xp_cell_contract)")
    p.add_argument("--assignment", type=Path, default=None,
                   help="Coordinate assignment JSON to validate and preview read-only")
    p.add_argument("--group", type=Path, default=None,
                   help="Optional microscope packet JSON (read-only); when supplied, layer keys come from the packet and stem is ignored")
    p.add_argument("--source-key", default="",
                   help="Open one exact raw layer key, e.g. attack-1001-L3 (read-only)")
    p.add_argument("--once", action="store_true",
                   help="compose one screen to stdout and exit (no terminal control)")
    p.add_argument("--stack", action="store_true",
                   help="start in display-only included-layer stack mode")
    p.add_argument("--unhighlighted", action="store_true",
                   help="start with current-layer highlighting disabled")
    return p.parse_args(argv)


def load_microscope_group(args) -> "MicroscopeGroup | None":
    if args.group is None:
        return None
    return MicroscopeGroup(args.group)


def load_xp_for_stem(stem: str, sprites: Path) -> "xp_core.XPFile":
    return load_xp_path(sprites / f"{stem}.xp")


def load_xp_path(path: Path) -> "xp_core.XPFile":
    if not path.is_file():
        raise ContractDataError(f"XP not found: {path}")
    xp = xp_core.XPFile()
    # xp_core.load() prints progress to stdout; silence it so it cannot corrupt
    # the rendered terminal frame (this viewer owns the screen).
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        xp.load(str(path))
    return xp


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        data = ContractData(args.sm, args.cell_contract)
        if args.assignment is not None:
            assignment_key = data.load_assignment_preview(args.assignment)
            if args.source_key and args.source_key != assignment_key:
                raise ContractDataError("--source-key does not match --assignment")
            args.source_key = assignment_key
        microscope = load_microscope_group(args)
        if microscope is not None:
            layer_keys = sorted(microscope.cards.keys(), key=lambda k: int(k.rsplit("-L", 1)[1]))
            if not layer_keys:
                print(f"FAIL: empty microscope packet {args.group}", file=sys.stderr)
                return 2
            stem = layer_keys[0].rsplit("-L", 1)[0]
        else:
            corpus_layer_keys = data.corpus_layer_map()
            stem = (
                data.xp_id_for_key(args.source_key)
                if args.source_key else data.resolve_xp_id(args.stem) if args.stem
                else data.stems()[0]
            )
            layer_keys = data.layer_keys_for_stem(stem)
            if not layer_keys:
                print(f"FAIL: no frozen contract layers for stem {stem}", file=sys.stderr)
                return 2
        if args.source_key and args.source_key not in layer_keys:
            print(f"FAIL: source key not present in viewer scope: {args.source_key}", file=sys.stderr)
            return 2
    except ContractDataError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    state = ViewerState(
        stem,
        layer_keys,
        microscope=microscope,
        sprites=args.sprites,
        corpus_layer_keys=None if microscope is not None else corpus_layer_keys,
    )
    if args.source_key:
        state.layer_idx = layer_keys.index(args.source_key)
    state.stack_mode = args.stack
    state.highlight_current = not args.unhighlighted
    if args.once or not sys.stdin.isatty():
        print(compose_screen(state, data))
        return 0
    return run_interactive(state, data)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
