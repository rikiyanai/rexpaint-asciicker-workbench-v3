#!/usr/bin/env python3
"""
Apply the 2026-05-29 live-session fix (transcript line 718) to the XP file.

The save-session fix was applied to the browser session at line 718 but
NEVER saved back to 2026-05-28-wallace.xp. This script applies the same
transformations to the XP file so the session recovery matches what
the live Wallace tab actually showed.

Affected cells (from transcript analysis):
- warm-cream-swap.py already replaced CGA grey(170,170,170)→warm-cream(255,228,181)
- face-pass.py created BLACK-fg halfblocks on warm-cream bg at ly=0..2 head zone
  These look like "sideburn hair" on a character meant to be bald
- Fix: set fg = bg = warm-cream for halfblocks (219-223) in head zone where
  bg is warm-cream/peachy and fg is BLACK
- Preserve: eyes (glyph 34, 236, 111), mouth (118), and top hair (220 with HAIR bg)
"""
import os
import sys
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
REPO = _resolve_y9_root()
sys.path.insert(0, str(REPO / "scripts" / "pipeline"))
from xp_core import XPFile

TGT = REPO / "assets/sprites/2026-05-28-wallace.xp"

WARM_CREAM = (255, 228, 181)
BLACK = (0, 0, 0)
MAGENTA = (255, 0, 255)
HALFBLOCKS = {219, 220, 221, 222, 223}
PRESERVE_GLYPHS = {34, 118, 236, 111}  # eyes/mouth
HEAD_LY_MAX = 2
SPRITE_H = 9

def patch(xp):
    layer = xp.layers[2]
    n = 0
    for ay in range(layer.height):
        ly = ay % SPRITE_H
        if ly > HEAD_LY_MAX:
            continue
        for ax in range(layer.width):
            g, fg, bg = layer.data[ay][ax]
            # Skip transparent
            if bg == MAGENTA:
                continue
            # Skip cells not in head silhouette
            if bg != WARM_CREAM:
                continue
            # Skip preserved glyphs (eyes, mouth)
            if g in PRESERVE_GLYPHS:
                continue
            # Skip non-halfblock glyphs
            if g not in HALFBLOCKS:
                continue
            # If fg is dark (BLACK, BROWN, etc.) on warm-cream bg = sideburn hair
            if fg != WARM_CREAM:
                layer.data[ay][ax] = (g, list(WARM_CREAM), list(WARM_CREAM))
                n += 1
    return n

def main():
    if not TGT.exists():
        # Point $ASCIICKER_Y9_ROOT at the checkout that holds this sprite.
        sys.exit(
            f"missing {TGT}\n"
            "Set ASCIICKER_Y9_ROOT to the asciicker-Y9-2 checkout holding this sprite."
        )
    xp = XPFile()
    xp.load(str(TGT))
    n = patch(xp)
    xp.save(str(TGT))
    print(f"Wallace XP fix: {n} halfblock/hair cells cleared to warm-cream in head zone")
    print(f"This matches what the live session at transcript line 718 had.")

if __name__ == "__main__":
    main()
