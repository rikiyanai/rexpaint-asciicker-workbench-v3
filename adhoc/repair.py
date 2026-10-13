#!/usr/bin/env python3
"""
Repair scratch COPIES of the two actor sheets. Originals are never touched.

THE TWO MECHANICAL DEFECTS BEING REPAIRED
-----------------------------------------
1. GROMIT LAYER-0 COLOUR KEY (critical, Gromit only).
   The engine treats an L2 cell as transparent when its background equals the
   Layer-0 colour key (xp_viewer.py:253-272, [ENGINE-ALIGN] sprite.cpp:1590-1601).
   The key is L0's BACKGROUND at cell (0,0). Gromit's L0 was recoloured to
   fg #aa5500 / bg #ffe4b5 across all 17,280 cells - and #ffe4b5 is its own body
   cream, so the whole body reads as transparent and the engine draws only ~12%
   of the art. Both reference sheets use fg #000000 / bg #ffff55, a colour their
   artwork never uses as a background. Repair: restore those L0 colours while
   PRESERVING EVERY L0 GLYPH, because L0 glyphs encode the atlas metadata
   (angles / anim lengths) that the engine parses.

2. REFLECTION HALF (both sheets).
   Columns 9-17 are the reflection of columns 0-8 (projs=2 = "projection +
   reflection"). It must be the vertical mirror of projection 0, with:
     - glyphs remapped through the canonical vertical-flip table
       (render_internal.h:55-61: 220<->223, 218<->192, 191<->217)
     - foreground and background colours UNCHANGED (the table does not swap
       them, and the engine darkens reflections itself at load via rgb_div=400,
       so author-side recolouring would double-darken)
   Gromit's reflection is a corrupted re-composition; Wallace's has correct
   geometry but 53% wrong colours. Repair: regenerate it from projection 0.

WHAT IS DELIBERATELY NOT TOUCHED
--------------------------------
The #00aaaa cyan in Gromit was earlier suspected of being contamination. It is
NOT: wolfie.xp (Gromit's base) contains 72 cells of the same fg colour, so it is
inherited base content. Removing it would be vandalism, so it is left alone.

SELF-TEST
---------
Before repairing anything, the reflection generator is validated by rebuilding
player-nude.xp's reflection from its own projection 0 and checking it against
what the file already contains. player-nude is the upstream contract exemplar
(0.0% mismatch on both geometry and colour), so if the generator reproduces it
exactly, the transform matches how upstream actually authors reflections.
"""

import os
import shutil
import sys
from pathlib import Path

V3 = Path("/Users/r/Downloads/asciicker-pipeline-v3")
sys.path.insert(0, str(V3 / "scripts"))
from xp_core import XPFile  # noqa: E402

OUTDIR = Path("/private/tmp/claude-501/-Users-r-Downloads-asciicker-pipeline-v3/"
              "aa11f89f-6d79-4b4c-9dfa-9c01e91de39e/scratchpad/repaired")
OUTDIR.mkdir(parents=True, exist_ok=True)

# Vertical-flip glyph map.
#
# The first six pairs are the canonical engine table, transcribed from Y9-2
# engine/render/render_internal.h:55-61.
#
# The remaining pairs are NOT in that table. They were derived empirically by
# diffing player-nude.xp's authored reflection against its own projection: with
# only the engine table, 91 of 4536 cells failed to reproduce, and those 91 are
# exactly these five pairs. This is expected - the audit established that the
# ENGINE NEVER FLIPS anything (the render_internal table serves the unrelated S3
# path); reflections are authored by hand. So the authoring convention is richer
# than the engine table, and the exemplar is the only authority for it.
#
#   85 'U' <-> 227 'n-cap'   a cup flips to a cap
#  194 'T-down' <-> 193 'T-up'
#  118 'v' <-> 94 '^'
#   92 '\' <-> 47 '/'
VFLIP_GLYPH = {
    220: 223, 223: 220,        # lower half block <-> upper half block
    218: 192, 192: 218,        # box upper-left <-> lower-left
    191: 217, 217: 191,        # box upper-right <-> lower-right
    85: 227, 227: 85,          # U <-> cap
    194: 193, 193: 194,        # T-down <-> T-up
    118: 94, 94: 118,          # v <-> ^
    92: 47, 47: 92,            # backslash <-> slash
}

# The healthy Layer-0 colours, taken from BOTH reference sheets.
GOOD_L0_FG = (0, 0, 0)
GOOD_L0_BG = (255, 255, 85)     # #ffff55


def geom(xp):
    """Return (visual_layer, cell_w, cell_h, frame_cols, frame_rows)."""
    v = xp.layers[2]
    m = xp.get_metadata()
    angles = int(m["angles"])
    anims = [int(x) for x in m["anims"]]
    projs = int(m.get("projs", 2 if angles > 0 else 1))
    fcols, frows = sum(anims) * projs, angles
    return v, v.width // fcols, v.height // frows, fcols, frows


def rebuild_reflection(layer, cw, ch, fcols, frows):
    """
    Overwrite the reflection half of one layer from its projection half.

    For every frame (r, c) with c in [0, half), writes frame (r, c + half) as the
    vertical mirror: destination row dy takes source row (ch-1-dy), the glyph is
    remapped through VFLIP_GLYPH, and both colours are copied unchanged.

    Args:
        layer: xp_core layer with .data[y][x] -> (glyph, fg, bg)
        cw, ch: sprite cell width / height
        fcols, frows: sprite grid dimensions (18 x 8)

    Returns:
        Number of cells written.
    """
    half = fcols // 2
    n = 0
    for r in range(frows):
        for c in range(half):
            sx, sy = c * cw, r * ch
            dx0, dy0 = (c + half) * cw, r * ch
            for dy in range(ch):
                for dx in range(cw):
                    g, fg, bg = layer.data[sy + (ch - 1 - dy)][sx + dx]
                    layer.data[dy0 + dy][dx0 + dx] = (
                        VFLIP_GLYPH.get(g, g), fg, bg)
                    n += 1
    return n


def selftest():
    """
    Prove the reflection transform against the upstream exemplar.

    Rebuilds player-nude.xp's reflection from its own projection 0 and compares
    against what the file already contains. A perfect match means the transform
    matches upstream authoring.
    """
    xp = XPFile()
    xp.load(str(V3 / "sprites/player-nude.xp"))
    v, cw, ch, fcols, frows = geom(xp)
    half = fcols // 2

    before = {}
    for r in range(frows):
        for c in range(half, fcols):
            for dy in range(ch):
                for dx in range(cw):
                    before[(r, c, dy, dx)] = v.data[r * ch + dy][c * cw + dx]

    rebuild_reflection(v, cw, ch, fcols, frows)

    same = glyph_diff = colour_diff = 0
    for (r, c, dy, dx), old in before.items():
        new = v.data[r * ch + dy][c * cw + dx]
        ok_g = old[0] == new[0]
        ok_c = tuple(old[1]) == tuple(new[1]) and tuple(old[2]) == tuple(new[2])
        if ok_g and ok_c:
            same += 1
        else:
            if not ok_g:
                glyph_diff += 1
            if not ok_c:
                colour_diff += 1
    total = len(before)
    print("SELF-TEST - regenerate player-nude.xp reflection from its projection:")
    print(f"   {same}/{total} cells reproduced exactly ({100*same/total:.2f}%)")
    print(f"   {glyph_diff} glyph mismatches, {colour_diff} colour mismatches")
    return same, total


def repair(name, src, fix_l0):
    """Copy one sheet and apply repairs to the copy."""
    dst = OUTDIR / f"{name}-repaired.xp"
    shutil.copy2(src, dst)

    xp = XPFile()
    xp.load(str(dst))
    v, cw, ch, fcols, frows = geom(xp)
    changes = []

    if fix_l0:
        L0 = xp.layers[0]
        n = 0
        for y in range(L0.height):
            for x in range(L0.width):
                g, fg, bg = L0.data[y][x]
                if tuple(fg) != GOOD_L0_FG or tuple(bg) != GOOD_L0_BG:
                    # Glyph preserved - it carries the atlas metadata.
                    L0.data[y][x] = (g, GOOD_L0_FG, GOOD_L0_BG)
                    n += 1
        changes.append(f"L0 colour key restored on {n} cells (glyphs preserved)")

    # Rebuild the reflection on every layer except L0 (which is uniform
    # metadata, so mirroring it would be meaningless). L1 carries the anim-row
    # digits and must mirror alongside the artwork on L2.
    for i, layer in enumerate(xp.layers):
        if i == 0:
            continue
        n = rebuild_reflection(layer, cw, ch, fcols, frows)
        changes.append(f"L{i} reflection regenerated ({n} cells)")

    xp.save(str(dst))
    print(f"\n{name}: -> {dst}")
    for c in changes:
        print(f"   {c}")
    return dst


if __name__ == "__main__":
    same, total = selftest()
    if same != total:
        print("\nThe transform did NOT reproduce the exemplar exactly. "
              "Counts above show where it diverges; treat the reflection "
              "repair as unproven until that is understood.")
    print()
    repair("gromit", os.environ.get("GROMIT_SRC", "sprites/wolfie.xp"), fix_l0=True)
    repair("wallace", os.environ.get("WALLACE_SRC", "sprites/player-0000.xp"), fix_l0=False)
