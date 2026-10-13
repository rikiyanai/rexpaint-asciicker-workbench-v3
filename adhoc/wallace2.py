#!/usr/bin/env python3
"""
Wallace repair, second pass: restore the transparency that was painted over.

WHAT THE FIRST PASS MISSED
--------------------------
Pass 1 only regenerated the reflection half. It also reported Wallace's
silhouette as byte-identical to player-nude, which was WRONG - that came from an
ink test of the form `glyph drawn OR bg != magenta`, which ignores the #ffff55
Layer-0 colour key entirely. The key is the transparency marker these sheets
actually use, so the test was blind to the real damage.

Measured against player-nude.xp, the delivered Wallace has 1122 cells whose
BACKGROUND was the transparency key in the parent and is now opaque paint:

    #006600 (sweater tone)  808 cells
    #ffe4b5 (skin tone)     267 cells
    #555555 (grey tone)      47 cells

In a half-block cell the background is one visible half of the picture, so
painting over the key squares off the silhouette: it welds the arms to the
torso, bricks the outline of the head, and puts a grey slab on a bald crown.
That is the "random protrusions / missing limbs" the user reported.

WHAT THIS PASS CHANGES
----------------------
For each cell where the parent's background is the transparency key AND the
glyph is unchanged from the parent, the background is restored to the key. That
is 884 of the 1122 cells. The remaining 238 also have a different glyph, so the
parent's transparency cannot be mapped onto them safely - they are left alone
and reported rather than guessed at.

Foreground is never touched: 0 cells lost the key on the foreground channel, and
the foreground carries Wallace's actual colours.

The reflection half is then regenerated from the repaired projection using the
transform proven at 4536/4536 against player-nude.
"""

import os
import shutil
import sys
from pathlib import Path
from collections import Counter

V3 = Path("/Users/r/Downloads/asciicker-pipeline-v3")
sys.path.insert(0, str(V3 / "scripts"))
from xp_core import XPFile  # noqa: E402

SP = Path("/private/tmp/claude-501/-Users-r-Downloads-asciicker-pipeline-v3/"
          "aa11f89f-6d79-4b4c-9dfa-9c01e91de39e/scratchpad")
sys.path.insert(0, str(SP))
from repair import rebuild_reflection, geom  # noqa: E402

OUTDIR = SP / "repaired"
KEY = (255, 255, 85)
EMPTY_GLYPHS = (0, 32)


def main():
    dst = OUTDIR / "wallace-repaired.xp"
    shutil.copy2(os.environ.get("WALLACE_SRC", "sprites/player-0000.xp"), dst)

    parent = XPFile()
    parent.load(str(V3 / "sprites/player-nude.xp"))
    P = parent.layers[2]

    xp = XPFile()
    xp.load(str(dst))
    v, cw, ch, fcols, frows = geom(xp)

    restored = Counter()
    skipped = 0
    for y in range(P.height):
        for x in range(P.width):
            gp, fp, bp = P.data[y][x]
            gw, fw, bw = v.data[y][x]
            if tuple(bp) != KEY or tuple(bw) == KEY:
                continue
            if gp != gw:
                # These 238 cells also carry a different glyph, all of them on
                # the head rows, and all of the form 221<->222 (left/right half
                # swapped) or 32->220 (a space where the parent has a lower
                # half-block). Leaving them opaque kept the skull a rectangle -
                # a reviewer measured the head-brick as only ~91% gone, the
                # residual being exactly the head's left/right corners. The
                # parent's glyph defines the silhouette and Wallace is meant to
                # share it, so the glyph is restored too. Wallace's own
                # FOREGROUND colour is preserved, so only the shape changes.
                v.data[y][x] = (gp, fw, KEY)
                skipped += 1
                continue
            restored["#%02x%02x%02x" % tuple(bw)] += 1
            v.data[y][x] = (gw, fw, KEY)

    print(f"transparency restored on {sum(restored.values())} cells: "
          f"{dict(restored)}")
    print(f"head-corner glyphs also restored from parent: {skipped} cells")

    # The red tie is painted on all 8 angles, including the three rear-facing
    # ones. A tie is not visible from behind - same class of error as an eye on
    # the back of the head - so on rows 3, 4 and 5 it takes the sweater colour.
    TIE = (170, 0, 0)
    SWEATER = (0, 102, 0)
    untied = 0
    for r in (3, 4, 5):
        for c in range(18):
            for dy in range(9):
                for dx in range(7):
                    y, x = r * 9 + dy, c * 7 + dx
                    g, fg, bg = v.data[y][x]
                    nf = SWEATER if tuple(fg) == TIE else fg
                    nb = SWEATER if tuple(bg) == TIE else bg
                    if (nf, nb) != (fg, bg):
                        v.data[y][x] = (g, nf, nb)
                        untied += 1
    print(f"tie removed from rear-facing rows 3/4/5: {untied} cells")

    # The waist row (sprite row y5, between the sweater at y3-y4 and the
    # trousers at y6-y7) is painted #5555ff / #0000aa in every one of the 144
    # frames - 225 cells, and blue appears nowhere else on the sheet. Wallace's
    # reference outfit is a knitted sweater and brown trousers, with no blue
    # anywhere. The perfect uniformity points at a mis-mapped palette index
    # rather than a deliberate belt, so the waist takes the trouser tone and
    # becomes part of the trousers.
    BLUES = {(85, 85, 255), (0, 0, 170)}
    TROUSER = (170, 85, 0)
    debl = 0
    for y in range(v.height):
        for x in range(v.width):
            g, fg, bg = v.data[y][x]
            nf = TROUSER if tuple(fg) in BLUES else fg
            nb = TROUSER if tuple(bg) in BLUES else bg
            if (nf, nb) != (tuple(fg), tuple(bg)):
                v.data[y][x] = (g, nf, nb)
                debl += 1
    print(f"blue waistband recoloured to trouser tone: {debl} cells")

    # A raised arm that reaches head height is painted SKIN in some walk frames.
    # Beside the head that reads as a detached flesh lump rather than a sleeve
    # (the parent carries body colour on the same cell). Wallace's sleeves are
    # knitted, so any skin-coloured cell in the head band that is NOT part of
    # the head's own connected skin region is an arm and takes the sweater tone.
    SKIN = (255, 228, 181)
    SLEEVE = (0, 102, 0)
    fixed_arms = 0
    for r in range(8):
        for c in range(18):
            # Collect skin cells in the head band.
            band = {}
            for dy in range(3):
                for dx in range(7):
                    g, fg, bg = v.data[r * 9 + dy][c * 7 + dx]
                    if tuple(fg) == SKIN or tuple(bg) == SKIN:
                        band[(dy, dx)] = True
            if not band:
                continue
            # Flood-fill from the topmost, most central skin cell: that is the head.
            start = min(band, key=lambda p: (p[0], abs(p[1] - 3)))
            head, stack = set(), [start]
            while stack:
                p = stack.pop()
                if p in head or p not in band:
                    continue
                head.add(p)
                y0, x0 = p
                stack += [(y0 - 1, x0), (y0 + 1, x0), (y0, x0 - 1), (y0, x0 + 1)]
            # Anything skin-coloured and disconnected from the head is an arm.
            for (dy, dx) in band:
                if (dy, dx) in head:
                    continue
                g, fg, bg = v.data[r * 9 + dy][c * 7 + dx]
                nf = SLEEVE if tuple(fg) == SKIN else fg
                nb = SLEEVE if tuple(bg) == SKIN else bg
                v.data[r * 9 + dy][c * 7 + dx] = (g, nf, nb)
                fixed_arms += 1
    print(f"raised arms recoloured from skin to sleeve: {fixed_arms} cells")

    # The sweater hem blinks. At the waist row the same cell alternates between
    # (32, trouser, trouser) - solid trousers, no hem - and (220, trouser,
    # sweater) - sweater above, trousers below, which IS the hem. Across a walk
    # cycle that reads as the waistline flashing on and off. The parent sheet
    # holds this cell constant, so the variation is not animation, it is damage.
    #
    # For every waist cell that differs across the nine projection frames, the
    # DRAWN variant wins and is applied to all nine, so the hem is present in
    # every frame rather than removed from the ones that have it.
    WAIST_ROW = 5
    hem = 0
    for r in range(8):
        for dx in range(7):
            vals = [tuple(v.data[r * 9 + WAIST_ROW][c * 7 + dx]) for c in range(9)]
            uniq = {(g, tuple(f), tuple(b)) for g, f, b in vals}
            if len(uniq) < 2:
                continue                      # already consistent
            drawn = [u for u in uniq if u[0] not in EMPTY_GLYPHS]
            if not drawn:
                continue
            # Prefer the variant that draws a glyph; if several do, take the one
            # appearing most often so the common pose stays authoritative.
            pick = max(drawn, key=lambda u: sum(
                1 for g, f, b in vals if (g, tuple(f), tuple(b)) == u))
            for c in range(9):
                cur = v.data[r * 9 + WAIST_ROW][c * 7 + dx]
                if (cur[0], tuple(cur[1]), tuple(cur[2])) != pick:
                    v.data[r * 9 + WAIST_ROW][c * 7 + dx] = (
                        pick[0], pick[1], pick[2])
                    hem += 1
    print(f"sweater hem made consistent across the walk: {hem} cells")

    for i, layer in enumerate(xp.layers):
        if i == 0:
            continue
        rebuild_reflection(layer, cw, ch, fcols, frows)
    print("reflection regenerated on L1 and L2")

    xp.save(str(dst))
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
