#!/usr/bin/env python3
"""
RECOVERY: Recreate Wallace session JSON from XP file + transcript evidence.

The Wallace session (UUID 7a7dd262-6c1c-47f4-b2f5-3a267c01c373) was lost
when Chrome was closed. The XP source file has all script passes applied.
This script rebuilds the session from the XP file with correct metadata.

Transcript evidence (from session e8ee7451):
- Original XP was player-body.xp (7x9 sprite cells, 18 cols x 8 rows = 126x72)
- Script passes: initial recolor → face pass → bald back → back ears
- Wallace had 8 divergent cells from cp/paste debugging (fixed by unpaste script)
- Session was opened at http://127.0.0.1:5071/workbench?session=7a7dd262-...
"""
import json, sys, shutil, os, time
from pathlib import Path

V3 = Path(__file__).resolve().parent


def _resolve_y9_root() -> Path:
    """Locate the asciicker-Y9-2 checkout.

    Precedence: $ASCIICKER_Y9_ROOT, else the in-repo asciicker-Y9-2 submodule.
    No absolute machine path is baked in; fails fast when neither is usable.
    """
    marker = Path("scripts") / "pipeline" / "xp_core.py"
    env = os.environ.get("ASCIICKER_Y9_ROOT")
    if env:
        root = Path(env).expanduser().resolve()
        if not (root / marker).is_file():
            sys.exit(
                f"ASCIICKER_Y9_ROOT={root} is not an asciicker-Y9-2 checkout "
                f"(missing {marker})"
            )
        return root
    submodule = V3 / "asciicker-Y9-2"
    if (submodule / marker).is_file():
        return submodule
    sys.exit(
        "Cannot locate the asciicker-Y9-2 checkout.\n"
        "Set ASCIICKER_Y9_ROOT to it, e.g.\n"
        f"  ASCIICKER_Y9_ROOT=/path/to/asciicker-Y9-2 python3 {Path(__file__).name}"
    )


# Y9-2 checkout root is controlled by $ASCIICKER_Y9_ROOT (repo submodule fallback).
Y9 = _resolve_y9_root()
sys.path.insert(0, str(Y9 / "scripts" / "pipeline"))
from xp_core import XPFile

SESSION_ID = "7a7dd262-6c1c-47f4-b2f5-3a267c01c373"
XP_PATH = Y9 / "assets/sprites/2026-05-28-wallace.xp"
if not XP_PATH.is_file():
    # Point $ASCIICKER_Y9_ROOT at the checkout that holds this sprite.
    sys.exit(
        f"missing XP source {XP_PATH}\n"
        "Set ASCIICKER_Y9_ROOT to the asciicker-Y9-2 checkout holding this sprite."
    )
DEST = V3 / "data/sessions" / f"{SESSION_ID}.json"

print("=== WALLACE SESSION RECOVERY ===")
print(f"XP source: {XP_PATH}")
print(f"Session destination: {DEST}")

# Load the XP file
xp = XPFile()
xp.load(str(XP_PATH))
print(f"Loaded: {xp.layers[2].width}x{xp.layers[2].height}, {len(xp.layers)} layers")

COLS = xp.layers[2].width
ROWS = xp.layers[2].height

def layer_cells(layer):
    cells = []
    for ay in range(ROWS):
        for ax in range(COLS):
            g, fg, bg = layer.data[ay][ax]
            cells.append({
                "idx": ay * COLS + ax,
                "glyph": g,
                "fg": list(fg),
                "bg": list(bg)
            })
    return cells

# Wallace/player angles: standard 8-direction
angles = [
    {"angle": 0, "cols": 18}, {"angle": 45, "cols": 18}, {"angle": 90, "cols": 18},
    {"angle": 135, "cols": 18}, {"angle": 180, "cols": 18}, {"angle": 225, "cols": 18},
    {"angle": 270, "cols": 18}, {"angle": 315, "cols": 18},
]
frame_groups = [
    {"name": f"anim-{a}-dir-{d}", "frames": list(range(18))}
    for a in range(1, 5) for d in range(6)
]

session = {
    "session_id": SESSION_ID,
    "job_id": "recovered-from-xp-2026-06-03",
    "angles": angles,
    "anims": [1, 2, 3, 4],
    "projs": [1, 2, 3, 4, 5, 6, 7, 8],
    "cell_w": 7,
    "cell_h": 9,
    "grid_cols": COLS,
    "grid_rows": ROWS,
    "cells": layer_cells(xp.layers[2]),
    "layers": [layer_cells(L) for L in xp.layers],
    "session_kind": "raw_xp",
    "metadata_status": "complete",
    "family": "player",
    "name": "2026-05-28-wallace.xp",
    "source_projs": [],
    "row_categories": [{"row": i} for i in range(8)],
    "layer_names": ["control", "idle", "visual"],
    "active_layer": 2,
    "visible_layers": [0, 1, 2],
    "locked_layers": [0],
    "whole_sheet_canvas_zoom": 1.0,
    "whole_sheet_grid_visible": False,
    "whole_sheet_grid_step": 1,
    "whole_sheet_grid_custom_w": 7,
    "whole_sheet_grid_custom_h": 9,
    "frame_groups": frame_groups,
    "source_boxes": [],
    "source_anchor_box": None,
    "source_draft_box": None,
    "source_cuts_v": None,
    "filename_prefix": "",
    "skin_family": "player"
}

# Backup existing session if any
if DEST.exists():
    bak = V3 / "asciicker-dumpster" / f"{SESSION_ID}.bak-{int(time.time())}.json"
    bak.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DEST, bak)
    print(f"Backed up old session -> {bak}")

DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(json.dumps(session, indent=2))
print(f"\n✅ Wallace session written ({len(session['cells'])} cells, {len(session['layers'])} layers)")
print(f"   File: {DEST}")
print(f"   Size: {DEST.stat().st_size} bytes")
print()
print("NOTE: The 8 divergent cells from cp/paste debugging are already")
print("corrected in the XP file (wallace-unpaste.py was applied).")
print()
print("To open: http://127.0.0.1:5071/workbench?session=7a7dd262-...")
