"""Derive {family}-spatial.json from per-layer PNG alpha masks.

For each verified layer in FINAL JSON with a canonical region, the
per-layer PNG at <PNG_ROOT>/{family}-{ahsw}_L{idx}.png carries the spatial
truth: non-transparent cells of that PNG ARE the spatial mask for the
layer's role within the frame. This script extracts that mask, collapses
it across all frames in the sheet to one canonical frame, and emits
per-region bboxes in the schema build_regions_grid() consumes.

For families that already have human-painted maps via the launcher's
xp_uv_body_viewer --anchor-review path, this file complements rather
than replaces — both are read by load_optional_semantic_bias via
{role}-*.json globs.

Run:
  python3 pipeline-v3/scripts/derive_spatial_maps_from_layer_pngs.py \
    --final-json <STATE_FINAL_JSON> --png-root <PNG_LAYERS_DIR>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

from glyph_assignment.final_json_ingest import build_layer_regions_index

XP_DIR = ROOT / "sprites"
SEMANTIC_MAPS_DIR = ROOT / "docs" / "research" / "ascii" / "semantic_maps"


def _resolve_required(value: str | Path | None, env_key: str, flag: str) -> Path:
    raw = value or os.environ.get(env_key)
    if not raw:
        raise SystemExit(
            f"missing required input: pass {flag} <path> or set ${env_key}"
        )
    path = Path(raw)
    if not path.exists():
        raise SystemExit(f"{flag} does not exist: {path}")
    return path


def _load_xp_metadata(family: str, ahsw: str) -> dict | None:
    """Return {frame_w, frame_h, total_horiz_frames, angles} from XP layer 0."""
    from xp_core import XPFile

    xp_path = XP_DIR / f"{family}-{ahsw}.xp"
    if not xp_path.exists():
        return None
    xp = XPFile()
    xp.load(str(xp_path))
    if not xp.layers:
        return None
    layer0 = xp.layers[0]
    meta = xp.get_metadata()
    angles = int(meta.get("angles", 1)) or 1
    projs = int(meta.get("projs", 1)) or 1
    anims = [int(n) for n in meta.get("anims", [1])]
    total_horiz_frames = projs * sum(anims)
    if total_horiz_frames <= 0:
        return None
    frame_w_cells = layer0.width // total_horiz_frames
    frame_h_cells = layer0.height // angles
    if frame_w_cells <= 0 or frame_h_cells <= 0:
        return None
    return {
        "frame_w": frame_w_cells,
        "frame_h": frame_h_cells,
        "total_horiz_frames": total_horiz_frames,
        "angles": angles,
        "layer_w_cells": layer0.width,
        "layer_h_cells": layer0.height,
    }


def _collapse_alpha_to_frame_mask(
    png_path: Path,
    frame_w_cells: int,
    frame_h_cells: int,
    layer_w_cells: int,
    layer_h_cells: int,
) -> set[tuple[int, int]]:
    """Open per-layer PNG, detect cell-grid alpha, collapse all frames to one canonical frame.

    Returns the set of (cx, cy) cell positions WITHIN one frame where any of
    the sheet's frames had non-transparent content.
    """
    if not png_path.exists():
        return set()
    img = Image.open(png_path).convert("RGBA")
    cell_px_w = img.width / layer_w_cells if layer_w_cells > 0 else 0
    cell_px_h = img.height / layer_h_cells if layer_h_cells > 0 else 0
    if cell_px_w <= 0 or cell_px_h <= 0:
        return set()

    alpha = img.split()[-1].load()
    occupied: set[tuple[int, int]] = set()
    for cx in range(frame_w_cells):
        for cy in range(frame_h_cells):
            # Sample center of every frame's instance of this cell.
            # If ANY frame has non-zero alpha in this cell, mark it occupied.
            hit = False
            for frame_x in range(layer_w_cells // frame_w_cells):
                for frame_y in range(layer_h_cells // frame_h_cells):
                    # cell coordinate within full sheet
                    abs_cx = frame_x * frame_w_cells + cx
                    abs_cy = frame_y * frame_h_cells + cy
                    if abs_cx >= layer_w_cells or abs_cy >= layer_h_cells:
                        continue
                    # sample 4 pixels (corners) of this cell — if any has alpha > threshold
                    for dx in (0.25, 0.75):
                        for dy in (0.25, 0.75):
                            px = int((abs_cx + dx) * cell_px_w)
                            py = int((abs_cy + dy) * cell_px_h)
                            if 0 <= px < img.width and 0 <= py < img.height:
                                if alpha[px, py] > 16:
                                    hit = True
                                    break
                        if hit:
                            break
                    if hit:
                        break
                if hit:
                    break
            if hit:
                occupied.add((cx, cy))
    return occupied


def _cells_to_bbox(cells: set[tuple[int, int]]) -> tuple[int, int, int, int] | None:
    if not cells:
        return None
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    return (min(xs), min(ys), max(xs), max(ys))


def _build_frame_regions(
    region_cells: dict[str, set[tuple[int, int]]],
) -> list[dict]:
    """Convert {region: {(cx,cy)}} to per-cell entries the converter accepts.

    Emits one tight bbox per region for compactness. Where regions overlap,
    later regions in the iteration order win in build_regions_grid since it
    overwrites regions_dict[(ax, ay)] each pass — we therefore order
    SMALLER regions LAST so they layer on top of larger ones (e.g. helmet
    cells should override armor.body cells if a layer counts as both).
    """
    sized = sorted(region_cells.items(), key=lambda kv: -len(kv[1]))
    out = []
    for region, cells in sized:
        # Emit per-cell unit bboxes — preserves irregular shape, no overlap
        # ambiguity within a region. build_regions_grid handles any bbox.
        for (cx, cy) in sorted(cells):
            out.append({"name": region, "bbox": [cx, cy, cx, cy]})
    return out


def derive_family_spatial(
    family: str, layer_index_entry: dict, png_root: Path
) -> dict | None:
    """Build {family}-spatial.json payload from per-layer PNG alpha masks."""
    # All layers within a family share the same XP metadata (frame_w/h) by
    # convention. Pick the first verified ahsw to read it from.
    if not layer_index_entry:
        return None

    sample_ahsw = next(iter(layer_index_entry.keys()))[0]
    xp_meta = _load_xp_metadata(family, sample_ahsw)
    if xp_meta is None:
        print(f"  WARN: no XP metadata for {family} (sample ahsw={sample_ahsw})")
        return None

    frame_w = xp_meta["frame_w"]
    frame_h = xp_meta["frame_h"]
    layer_w = xp_meta["layer_w_cells"]
    layer_h = xp_meta["layer_h_cells"]
    n_frames = layer_w // frame_w * (layer_h // frame_h)
    print(
        f"  {family}: frame={frame_w}x{frame_h}  "
        f"layer={layer_w}x{layer_h}  est_frames={n_frames}"
    )

    # Aggregate per-cell occupancy by canonical region across all verified
    # layers in this family.
    region_cells: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for (ahsw, layer_idx), entry in layer_index_entry.items():
        region = entry["region"]
        if region in ("unknown",):
            continue
        png_path = png_root / f"{family}-{ahsw}_L{layer_idx}.png"
        cells = _collapse_alpha_to_frame_mask(
            png_path, frame_w, frame_h, layer_w, layer_h
        )
        if not cells:
            continue
        # Composite layers contribute ONLY to the "composite" region —
        # we cannot tell which cells in a composite layer belong to which
        # constituent role, so distributing the cells across all constituents
        # would smear (e.g. mount.wolf and body.player ending up with
        # identical masks). Bias-glyph counts still propagate to each
        # constituent in extract_glyph_frequencies; spatial assignment is
        # the strictly-known half.
        if region == "composite":
            region_cells["composite"].update(cells)
            continue
        if region == "unknown":
            continue
        region_cells[region].update(cells)

    if not region_cells:
        return None

    # Build per-frame region list (same for every frame in the sheet).
    regions = _build_frame_regions(region_cells)

    # Emit frames covering all (angle, anim) slots.
    angles = xp_meta["angles"]
    anims_horiz = xp_meta["total_horiz_frames"] // 2  # projs=2 mirror; first half
    frames = {}
    key = 0
    for angle in range(angles):
        for anim in range(anims_horiz):
            frames[str(key)] = {
                "angle": angle,
                "anim_index": anim,
                "regions": regions,
            }
            key += 1
    return {
        "family": family,
        "frame_w": frame_w,
        "frame_h": frame_h,
        "frames": frames,
        "derived_from": "per_layer_png_alpha_masks",
        "stats": {
            "region_count": len(region_cells),
            "regions": {r: len(cells) for r, cells in region_cells.items()},
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--final-json", type=Path, default=None)
    parser.add_argument("--png-root", type=Path, default=None)
    args = parser.parse_args(argv)
    final_json = _resolve_required(
        args.final_json, "ASCIICKER_FINAL_JSON", "--final-json"
    )
    png_root = _resolve_required(args.png_root, "ASCIICKER_PNG_ROOT", "--png-root")
    layer_index = build_layer_regions_index(final_json)

    SEMANTIC_MAPS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for family in ("wolfie", "bigbee", "wolack"):
        print(f"deriving {family}-spatial.json...")
        payload = derive_family_spatial(family, layer_index.get(family, {}), png_root)
        if payload is None:
            print(f"  SKIP: no derivable data for {family}")
            continue
        out_path = SEMANTIC_MAPS_DIR / f"{family}-spatial.json"
        out_path.write_text(json.dumps(payload, indent=2) + "\n")
        written.append(out_path)
        stats = payload["stats"]
        print(
            f"  {out_path.name}  "
            f"frame={payload['frame_w']}x{payload['frame_h']}  "
            f"regions={stats['region_count']}  "
            f"({out_path.stat().st_size} bytes)"
        )
        for r, c in sorted(stats["regions"].items(), key=lambda kv: -kv[1]):
            print(f"    {r:32s} cells={c}")

    print()
    print(f"wrote {len(written)} derived spatial maps:")
    for p in written:
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
