#!/usr/bin/env python3
"""FL-4162 — Source Layer Contract Viewer (READ-ONLY).

A fresh, read-only inspector for the FL-4162 review/contract surfaces. It is NOT a
fork of xp_uv_body_viewer.py: it deliberately does not carry the anchor-region
editor owner (frames[].regions[], assignment keys, save paths, body-map toggles,
composite/mutation state). It only renders pure pixels and joins read-only data.

It borrows ONLY the pure-rendering idea from xp_uv_body_viewer.py — a cell is
visible iff its bg is not the magenta key (255,0,255) and its glyph is non-zero —
with attribution here. Everything else is new and read-only.

What it shows for one XP stem (e.g. bigbee-0000):
  * every raw VISUAL layer (the ones with evidence cards, L2..LN),
  * the original cells sliced per frame/angle from card geometry, with autoplay,
  * the reviewed proposal role(s) (authority:false), topology class, blockers,
  * glyph exact/near match evidence, and a role-focus grid over the stem's layers.

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
"""
from __future__ import annotations

import argparse
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

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
SPRITES = REPO_ROOT / "assets/sprites"
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


class ContractData:
    """All four FL-4162 artifacts, loaded once, indexed by source_key/card_id."""

    def __init__(self, sm: Path = SM):
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

    def layer_keys_for_stem(self, stem: str) -> list[str]:
        keys = [k for k in self.cards if k.rsplit("-L", 1)[0] == stem]
        return sorted(keys, key=lambda k: int(k.rsplit("-L", 1)[1]))

    def join(self, source_key: str) -> dict[str, Any]:
        card = self.cards.get(source_key, {})
        decision = self.decisions.get(source_key, {})
        verdict_row = self.verdicts.get(source_key, {})
        verdict = verdict_row.get("agent_verdict", {})
        hand = card.get("hand", {})
        cells = card.get("cells", {})
        sim = card.get("glyph_similarity", {})
        blockers = []
        cls = self.topo_class.get(source_key)
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
            "raw_layer_index": card.get("raw_layer_index"),
            "hand_status": hand.get("status"),
            "hand_label": hand.get("corrected_label"),
            "hand_note": hand.get("note"),
            "machine_guess": hand.get("pre_guess"),
            "machine_guess_source": hand.get("pre_source"),
            "proposed_roles": decision.get("composite_roles")
            or verdict.get("proposed_roles") or [],
            "authority": decision.get("authority"),
            "topology_class": cls,
            "blockers": blockers,
            "exact_matches": sim.get("exact_matches") or card.get("glyph_exact_matches") or [],
            "near_matches": sim.get("near_matches") or card.get("glyph_near_matches") or [],
            "contradictions": verdict.get("contradictions") or [],
            "topology_note": verdict.get("topology_note") or "",
            "queue_class": verdict_row.get("queue_class"),
            "frame_topology": (card.get("engine") or {}).get("frame_topology") or {},
            "frame_wh": cells.get("frame_wh"),
        }


# --------------------------------------------------------------------------- #
# Frame slicing (card geometry) + pure rendering
# --------------------------------------------------------------------------- #
def _glyph_char(glyph: int) -> str:
    if glyph in (0, 32):
        return " "
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


def render_cells_ansi(grid) -> list[str]:
    """Pure render: truecolor ANSI per cell; magenta-key/zero-glyph = blank."""
    lines = []
    for row in grid:
        parts = []
        for glyph, fg, bg in row:
            bg = tuple(bg)
            if bg == MAGENTA_KEY or glyph in (0,):
                parts.append(" ")
                continue
            fr, fgg, fb = fg
            br, bgg, bb = bg
            ch = _glyph_char(glyph)
            parts.append(f"\x1b[38;2;{fr};{fgg};{fb}m\x1b[48;2;{br};{bgg};{bb}m{ch}\x1b[0m")
        lines.append("".join(parts))
    return lines


# --------------------------------------------------------------------------- #
# View state + frame composition (text, no terminal control — testable)
# --------------------------------------------------------------------------- #
class ViewerState:
    def __init__(self, stem: str, layer_keys: list[str]):
        self.stem = stem
        self.layer_keys = layer_keys
        self.layer_idx = 0
        self.angle = 0
        self.frame = 0
        self.autoplay = True
        self.autoplay_axis = "frame"   # or "angle"
        self.role_focus: str | None = None
        self.status = ""

    @property
    def current_key(self) -> str:
        return self.layer_keys[self.layer_idx]


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


def _engine_ref(idx, n_layers: int, layer) -> str:
    """Map a raw layer index to its upstream engine role (sprite.cpp @ upstream/master
    8ff75d0c; see ENGINE_REFS.json). Pure annotation; the viewer authors nothing."""
    if not isinstance(idx, int):
        return "metadata / non-visual layer"
    if idx == 0:
        return "L0 color key (bg) -- sprite.cpp:350"
    if idx == 1:
        return "L1 height channel -- sprite.cpp:351"
    if idx == 2:
        return "L2 image base accumulator (overlays fold into this) -- sprite.cpp:352"
    if idx == n_layers - 1:
        if layer is not None and _layer_is_cyan_swoosh(layer):
            return "final layer, cyan-fg -> weapon_swoosh special-case -- sprite.cpp:361"
        return "final merge layer -> folds into L2 -- sprite.cpp:354-360"
    return "merge overlay -> folds into L2 in order -- sprite.cpp:354-360"


def compose_screen(state: ViewerState, data: ContractData, xp: "xp_core.XPFile") -> str:
    key = state.current_key
    info = data.join(key)
    idx = info["raw_layer_index"]
    layer = xp.layers[idx] if isinstance(idx, int) and 0 <= idx < len(xp.layers) else None

    out: list[str] = []
    foc = f"  ROLE-FOCUS={state.role_focus}" if state.role_focus else ""
    out.append(f"== SOURCE LAYER CONTRACT VIEWER (READ-ONLY) :: {state.stem} =="
               f"  layer {state.layer_idx + 1}/{len(state.layer_keys)}"
               f"  angle {state.angle}  frame {state.frame}"
               f"  autoplay={'ON:' + state.autoplay_axis if state.autoplay else 'OFF'}{foc}")
    out.append("")

    if layer is not None and info["frame_wh"]:
        sliced = slice_frame(layer, info["frame_wh"], state.angle, state.frame)
        if sliced:
            out.append(f"-- {key}  (raw layer L{idx}, frame {state.frame + 1}/{sliced['cols']},"
                       f" angle {state.angle + 1}/{sliced['rows']}, {sliced['fw']}x{sliced['fh']}) --")
            out.extend(render_cells_ansi(sliced["grid"]))
    else:
        out.append(f"-- {key}: no renderable geometry (metadata layer?) --")

    out.append("")
    out.append("-- CONTRACT (authority:false proposal) --")
    out.append(f"hand[{info['hand_status']}]: {info['hand_label']!r}")
    if info["hand_note"] and info["hand_note"] != info["hand_label"]:
        out.append(f"hand_note: {info['hand_note']!r}")
    out.append(f"machine_guess: {info['machine_guess']!r} ({info['machine_guess_source']})")
    out.append(f"PROPOSED ROLE: {';'.join(info['proposed_roles']) or '<none>'}"
               f"   topology_class: {info['topology_class']}   queue: {info['queue_class']}")
    out.append(f"blockers: {', '.join(info['blockers']) or 'none'}")
    # Engine anchor: which sprite.cpp role this raw layer plays (read-only annotation).
    out.append(f"engine: {_engine_ref(idx, len(xp.layers), layer)}")
    # Neighboring-layer patterns: adjacent raw layers + their proposed roles, for
    # convention comparison (is this the base, an overlay, the swoosh?).
    by_idx = {data.join(k)["raw_layer_index"]: k for k in state.layer_keys}
    neigh = []
    for d in (idx - 1, idx + 1) if isinstance(idx, int) else ():
        if d < 2:
            neigh.append(f"L{d}=<metadata>")
        elif d in by_idx:
            nj = data.join(by_idx[d])
            neigh.append(f"L{d}={';'.join(nj['proposed_roles']) or '<none>'}[{nj['topology_class']}]")
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

    out.append("")
    out.append("-- ROLE GRID (this stem's visual layers) --")
    for k in state.layer_keys:
        ji = data.join(k)
        role = ";".join(ji["proposed_roles"]) or "<none>"
        mark = ">" if k == key else " "
        focus_hit = "*" if (state.role_focus and state.role_focus in ji["proposed_roles"]) else " "
        out.append(f"{mark}{focus_hit} {k:18s} L{ji['raw_layer_index']}"
                   f"  role={role:28s} class={ji['topology_class']}")

    if state.role_focus:
        out.append("")
        out.append(f"-- ROLE-FOCUS EVIDENCE :: {state.role_focus} --")
        hits = [k for k in state.layer_keys if state.role_focus in data.join(k)["proposed_roles"]]
        out.append(f"layers in this stem proposing {state.role_focus}: {hits or 'none'}")
        cur_exact = info["exact_matches"]
        out.append(f"current layer byte-identical peers ({len(cur_exact)}): "
                   f"{', '.join(map(str, cur_exact[:8]))}{' ...' if len(cur_exact) > 8 else ''}")

    if state.status:
        out.append("")
        out.append(state.status)
    out.append("")
    out.append("[ ]/[ ] layer  , . angle  n/p frame  space autoplay  x axis  f role-focus  q quit")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Interactive loop (autoplay via select timeout — no sleep)
# --------------------------------------------------------------------------- #
def _advance_autoplay(state: ViewerState, data: ContractData, xp: "xp_core.XPFile") -> None:
    info = data.join(state.current_key)
    idx = info["raw_layer_index"]
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
        roles = data.join(state.current_key)["proposed_roles"]
        state.role_focus = roles[0] if roles and not state.role_focus else None
    return True


def run_interactive(state: ViewerState, data: ContractData, xp: "xp_core.XPFile",
                    tick: float = 0.4) -> int:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while True:
            sys.stdout.write("\x1b[H\x1b[2J" + compose_screen(state, data, xp) + "\n")
            sys.stdout.flush()
            ready, _, _ = select.select([sys.stdin], [], [], tick if state.autoplay else None)
            if ready:
                ch = sys.stdin.read(1)
                if not handle_key(state, ch, data):
                    break
            elif state.autoplay:
                _advance_autoplay(state, data, xp)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("stem", help="XP stem, e.g. bigbee-0000")
    p.add_argument("--sprites", type=Path, default=SPRITES)
    p.add_argument("--sm", type=Path, default=SM)
    p.add_argument("--once", action="store_true",
                   help="compose one screen to stdout and exit (no terminal control)")
    return p.parse_args(argv)


def load_xp_for_stem(stem: str, sprites: Path) -> "xp_core.XPFile":
    path = sprites / f"{stem}.xp"
    if not path.is_file():
        # base/monolith stems resolve to the family monolith
        raise ContractDataError(f"XP not found for stem {stem}: {path}")
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
        data = ContractData(args.sm)
        layer_keys = data.layer_keys_for_stem(args.stem)
        if not layer_keys:
            print(f"FAIL: no evidence-card layers for stem {args.stem}", file=sys.stderr)
            return 2
        xp = load_xp_for_stem(args.stem, args.sprites)
    except ContractDataError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    state = ViewerState(args.stem, layer_keys)
    if args.once or not sys.stdin.isatty():
        print(compose_screen(state, data, xp))
        return 0
    return run_interactive(state, data, xp)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
