#!/usr/bin/env python3
"""
Hand-authored Gromit heads, one template per viewing angle.

WHY TEMPLATES INSTEAD OF HEURISTICS
-----------------------------------
Two review rounds failed because features were placed by geometric rules
("top ink row = ears", "fourth ink row = muzzle"). Anatomy differs per angle, so
the nose landed on the throat in profile and at the head/neck junction head-on.
Every patch to a rule moved the error somewhere else. These are explicit
per-angle cell lists instead, authored against the supplied reference art.

CANONICAL PALETTE (from the reference sheet)
--------------------------------------------
    tan fur       #d6bf8b
    brown ears    #8e6e5a
    black nose    #1a1a1a
    eye sclera    #ffffff
    pupil         #000000

WHAT THE REFERENCE SHOWS
------------------------
Gromit has an oval tan head; two BROWN ears rooted at the crown that curve
outward and hang DOWN past the jaw; two eyes high on the face, each a white
sclera with a dark pupil; and one big black oval nose at the bottom-front of the
muzzle. Rear angles show the ears and the back of the skull but no face.

wolfie's head sits at cell rows y2-y5 of each 10x12 frame, with the neck at
y5-y6 and the body below, so the templates occupy y2-y5 and leave wolfie's body
and legs untouched.

CONNECTIVITY
------------
An earlier attempt added ear cells with a transparent gap to the skull, which
8-connectivity analysis showed as three separate objects per frame - floating
brown pips. Each ear cell below is orthogonally adjacent either to the head or
to the ear cell above it, so every frame stays a single connected object. The
ear roots step diagonally outward (crown -> shoulder of the head -> down), which
is what gives the outward curve seen in the reference.
"""

import shutil
import sys
from pathlib import Path

V3 = Path("/Users/r/Downloads/asciicker-pipeline-v3")
sys.path.insert(0, str(V3 / "scripts"))
from xp_core import XPFile  # noqa: E402

SP = Path("/private/tmp/claude-501/-Users-r-Downloads-asciicker-pipeline-v3/"
          "aa11f89f-6d79-4b4c-9dfa-9c01e91de39e/scratchpad")
sys.path.insert(0, str(SP))
from repair import rebuild_reflection, geom  # noqa: E402

OUTDIR = SP / "repaired"
KEY = (255, 255, 85)
MAGENTA = (255, 0, 255)
EMPTY = (0, 32)

TAN = (214, 191, 139)     # #d6bf8b
BROWN = (142, 110, 90)    # #8e6e5a
NOSE = (26, 26, 26)       # #1a1a1a
SCLERA = (255, 255, 255)
PUPIL = (0, 0, 0)

FULL = 219                # solid block
# The eye is a LOWER HALF-BLOCK: white sclera fills the top of the cell and the
# dark pupil the bottom, matching the reference where the pupils sit low in the
# eye. A half-block was chosen over a glyph such as 'o' deliberately - it needs
# no particular character to exist in the engine's font atlas, and it is drawn
# identically by every renderer, so what a reviewer sees is what ships.
EYE_GLYPH = 220

# Per-angle head templates, as {(dy, dx): kind}.
# kinds: 'E' ear, 'F' fur, 'Y' eye, 'N' nose.
# Authored for rows 0-4; rows 5,6,7 are produced by mirroring 3,2,1.
#
# SILHOUETTE RULE (learned the hard way): these templates are ADDITIVE.
# An earlier version blanked cell rows y2-y5 and stamped a solid rectangle,
# which destroyed wolfie's rounded skull - the crown lost its taper, the head
# became a brick wider than the body, and the eyes and nose filled the entire
# face with no fur left around them. wolfie's head silhouette is good art and is
# now preserved: only EAR cells are added outside it, and eyes/nose are painted
# onto cells that already exist.
HEADS_UNUSED_RECTANGLE = {
    # FRONT. Ears root on the crown at x3/x6, step out to x2/x7 and hang to y5.
    # Eyes sit side by side at y3, the nose fills the centre of y4.
    0: {
        (2, 3): 'E', (2, 6): 'E',
        (3, 2): 'E', (4, 2): 'E', (5, 2): 'E',
        (3, 7): 'E', (4, 7): 'E', (5, 7): 'E',
        (2, 4): 'F', (2, 5): 'F',
        (3, 3): 'F', (3, 6): 'F',
        (4, 3): 'F', (4, 6): 'F',
        (5, 4): 'F', (5, 5): 'F',
        (3, 4): 'Y', (3, 5): 'Y',
        (4, 4): 'N', (4, 5): 'N',
    },
    # 45 SE. Head shifted right; the far ear is mostly hidden behind the skull,
    # so only the near (left) ear hangs full length.
    1: {
        (2, 4): 'E', (2, 7): 'E',
        (3, 3): 'E', (4, 3): 'E', (5, 3): 'E',
        (3, 8): 'E', (4, 8): 'E',
        (2, 5): 'F', (2, 6): 'F',
        (3, 4): 'F', (3, 7): 'F',
        (4, 4): 'F', (4, 7): 'F',
        (5, 5): 'F', (5, 6): 'F',
        (3, 5): 'Y', (3, 6): 'Y',
        (4, 5): 'N', (4, 6): 'N',
    },
    # 90 EAST profile, snout pointing right. One visible eye; the nose is a
    # single black cell at the snout tip, not a bar across the throat.
    2: {
        (2, 6): 'E',
        (3, 5): 'E', (4, 5): 'E', (5, 5): 'E',
        (2, 7): 'F', (2, 8): 'F',
        (3, 6): 'F', (3, 8): 'F',
        (4, 6): 'F', (4, 7): 'F', (4, 8): 'F',
        (5, 6): 'F', (5, 7): 'F',
        (3, 7): 'Y',
        (4, 9): 'N',
    },
    # 135 NE, rear three-quarter: back of the skull and both ears, no face.
    3: {
        (2, 4): 'E', (2, 7): 'E',
        (3, 3): 'E', (4, 3): 'E', (5, 3): 'E',
        (3, 8): 'E', (4, 8): 'E',
        (2, 5): 'F', (2, 6): 'F',
        (3, 4): 'F', (3, 5): 'F', (3, 6): 'F', (3, 7): 'F',
        (4, 4): 'F', (4, 5): 'F', (4, 6): 'F', (4, 7): 'F',
        (5, 5): 'F', (5, 6): 'F',
    },
    # 180 BACK: symmetric skull, both ears hanging, no face at all.
    4: {
        (2, 3): 'E', (2, 6): 'E',
        (3, 2): 'E', (4, 2): 'E', (5, 2): 'E',
        (3, 7): 'E', (4, 7): 'E', (5, 7): 'E',
        (2, 4): 'F', (2, 5): 'F',
        (3, 3): 'F', (3, 4): 'F', (3, 5): 'F', (3, 6): 'F',
        (4, 3): 'F', (4, 4): 'F', (4, 5): 'F', (4, 6): 'F',
        (5, 4): 'F', (5, 5): 'F',
    },
}


# ADDITIVE per-angle features, authored against wolfie's actual head geometry
# (read off its ink maps) so every added cell is orthogonally adjacent to
# existing art and every feature lands on a cell that already exists.
#
#   'ears'  cells added OUTSIDE the silhouette, hanging beside the skull
#   'eyes'  existing head cells repainted as sclera-over-pupil
#   'nose'  existing head cells repainted black, at the muzzle front
#
# wolfie head geometry per angle, for reference while reading these:
#   row 0  y2:x4-5   y3:x3-6  y4:x3-6   (neck y5:x4-5)
#   row 2  y2:x6-7   y3:x6-8  y4:x5-9   y5:x4-8
FEATURES = {
    # FRONT: ears hang at x2/x7 beside the widest head rows; eyes side by side
    # on y3; the big nose fills the centre of y4. Crown at y2 is left alone so
    # the skull keeps its taper.
    #
    # NOSE IS ONE ROW BELOW THE EYES, NOT DIRECTLY UNDER THEM. The pupil is
    # #000000 and the nose #1a1a1a - indistinguishable at this scale - so when
    # the pupil band sat directly on the nose band they fused into a single
    # black slab with a white bar above it, reading as a visor rather than a
    # face. Leaving the muzzle row tan between them is what separates the two,
    # and it matches the reference: eyes high, tan muzzle, nose at the bottom.
    #
    # 'tail' cells are painted brown like the ears, per the reference. Only the
    # two profile angles carry one: row 2 has an unmistakable protrusion at
    # (5,1) separated from the body by a gap, with (6,1) beneath it, and row 6
    # mirrors that at x8. On the three-quarter angles the tail does not stick
    # out of the silhouette at all, so there is nothing to identify and nothing
    # is painted - guessing a tail position there would just put a brown smear
    # on the flank.
    0: {"ears": [(3, 2), (4, 2), (5, 2), (6, 2), (7, 2), (3, 7), (4, 7), (5, 7), (6, 7), (7, 7)],
        "eyes": [(3, 4), (3, 5)],
        "nose": [(5, 4), (5, 5)],
        "tail": []},
    # 45 SE: head sits one cell right of centre.
    1: {"ears": [(3, 3), (4, 3), (5, 3), (6, 3), (7, 3), (3, 8), (4, 8), (5, 8), (6, 8)],
        "eyes": [(3, 5), (3, 6)],
        "nose": [(5, 5), (5, 6)],
        "tail": []},
    # 90 EAST profile: the ear hangs at the BACK of the skull (its left), and
    # the nose is a single cell at the SNOUT TIP (the rightmost muzzle cell),
    # not a bar across the throat.
    2: {"ears": [(2, 5), (3, 5), (4, 4), (5, 4)],
        "eyes": [(3, 7)],
        "nose": [(4, 9)],
        "tail": [(5, 1), (6, 1)]},
    # 135 NE rear three-quarter: ears visible, no face.
    3: {"ears": [(3, 3), (4, 3), (5, 3), (6, 3), (7, 3), (3, 8), (4, 8), (5, 8), (6, 8)],
        "eyes": [], "nose": [], "tail": []},
    # 180 BACK: both ears, no face at all.
    4: {"ears": [(3, 2), (4, 2), (5, 2), (6, 2), (7, 2), (3, 7), (4, 7), (5, 7), (6, 7), (7, 7)],
        "eyes": [], "nose": [], "tail": []},
}


def mirror_features(f, cw):
    """Mirror a feature set horizontally, for the opposite viewing angle."""
    return {k: [(dy, cw - 1 - dx) for dy, dx in v] for k, v in f.items()}


def head_to_tan(layer, r, c, cw, ch, key, head_rows=4):
    """
    Make the head solid TAN before any feature is painted on it.

    The body restyle gives every silhouette-edge cell the brown outline colour.
    On the head that is ruinous: the skull is only about four cells across, so a
    one-cell brown edge on each side leaves a two-cell interior - and once the
    eyes and nose are painted there, no tan fur remains visible at all. The face
    then reads as outline-plus-features with no dog in between.

    Gromit's head is tan; the brown belongs to the EARS framing it. So the head
    band is flattened to tan here, and the ears (added afterwards, outside the
    silhouette) supply the brown.
    """
    def ink(dy, dx):
        g, fg, bg = layer.data[r * ch + dy][c * cw + dx]
        return (g not in EMPTY) or (tuple(bg) not in (key, MAGENTA))

    rows = [dy for dy in range(ch) if any(ink(dy, dx) for dx in range(cw))]
    n = 0
    for dy in rows[:head_rows]:
        for dx in range(cw):
            if not ink(dy, dx):
                continue
            g, fg, bg = layer.data[r * ch + dy][c * cw + dx]
            nf = TAN if tuple(fg) == BROWN else fg
            nb = TAN if tuple(bg) == BROWN else bg
            ng = g
            # wolfie is a WOLF: its crown carries pointed triangular ears drawn
            # with glyphs 30 and 31. Gromit's ears are the floppy brown ones
            # added at the sides of the head, so the pointed pair has to go -
            # left in place they sit as spikes on top of the skull, which is
            # exactly the "slab/antlers on the crown" that reviewers kept
            # reporting. Replacing them with a solid block gives the rounded
            # tan crown the reference shows.
            if g in (30, 31):
                ng = FULL
                nf = TAN
            if (ng, nf, nb) != (g, tuple(fg), tuple(bg)):
                layer.data[r * ch + dy][c * cw + dx] = (ng, nf, nb)
                n += 1
    return n


def head_top_row(layer, r, c, cw, ch, key):
    """Return the first cell row of this frame that contains any ink."""
    for dy in range(ch):
        for dx in range(cw):
            g, fg, bg = layer.data[r * ch + dy][c * cw + dx]
            if (g not in EMPTY) or (tuple(bg) not in (key, MAGENTA)):
                return dy
    return 0


def apply_features(layer, r, c, cw, ch, feat, key, dy_offset=0):
    """
    Add ears and paint eyes/nose onto ONE frame, leaving the silhouette intact.

    Ear cells are only written where nothing is drawn yet, and only when they
    touch existing art - so they can never become floating islands. Eye and nose
    cells are only painted where art already exists, so they can never bulge the
    outline.
    """
    def ink(dy, dx):
        if not (0 <= dy < ch and 0 <= dx < cw):
            return False
        g, fg, bg = layer.data[r * ch + dy][c * cw + dx]
        return (g not in EMPTY) or (tuple(bg) not in (key, MAGENTA))

    added = painted = 0
    for dy0, dx in feat["ears"]:
        dy = dy0 + dy_offset
        if not (0 <= dy < ch and 0 <= dx < cw) or ink(dy, dx):
            continue
        touches = any(ink(dy + a, dx + b)
                      for a, b in ((-1, 0), (1, 0), (0, -1), (0, 1)))
        if not touches:
            continue                       # would be a floating pip - skip it
        layer.data[r * ch + dy][c * cw + dx] = (FULL, BROWN, key)
        added += 1
    for kind, colour_cell in (("eyes", None),
                              ("nose", (FULL, NOSE, key)),
                              ("tail", (FULL, BROWN, key))):
        cells = feat.get(kind, [])
        if kind == "eyes":
            # Sort by column so the LEFTMOST eye always takes the left-half
            # pupil. mirror_features() reverses list order, which previously
            # flipped the pupils inward on every mirrored angle (row 7 read
            # `e a a e` - one solid bar - instead of `a e e a`).
            cells = sorted(cells, key=lambda t: t[1])
        for i, (dy0, dx) in enumerate(cells):
            dy = dy0 + dy_offset
            if not (0 <= dy < ch) or not ink(dy, dx):
                continue                   # never paint a feature into space
            if kind == "eyes":
                # A pair of adjacent sclera-over-pupil cells painted as one
                # 4-wide white band over a 4-wide dark band, which reads as a
                # visor rather than two eyes. Splitting them vertically - pupil
                # on the OUTER half of each cell - leaves white sclera between
                # the two pupils, so they read as a pair. A lone eye (the
                # profile angles) keeps sclera-above-pupil.
                if len(cells) == 2:
                    glyph = 221 if i == 0 else 222
                else:
                    glyph = 220
                cell = (glyph, PUPIL, SCLERA)
            else:
                cell = colour_cell
            layer.data[r * ch + dy][c * cw + dx] = cell
            painted += 1
    return added, painted


def mirrored(tpl, cw):
    """Mirror a head template horizontally, for the opposite viewing angle."""
    return {(dy, cw - 1 - dx): kind for (dy, dx), kind in tpl.items()}


def cell_for(kind):
    """Return the (glyph, fg, bg) triple that paints one template cell."""
    if kind == 'E':
        return (FULL, BROWN, KEY)
    if kind == 'F':
        return (FULL, TAN, KEY)
    if kind == 'N':
        return (FULL, NOSE, KEY)
    if kind == 'Y':
        # Dark pupil drawn on a white sclera background.
        return (EYE_GLYPH, PUPIL, SCLERA)
    raise ValueError(kind)


def clear_head(layer, r, c, cw, ch, rows=(2, 3, 4, 5)):
    """Blank the head band so a template is not composited over old art."""
    for dy in rows:
        for dx in range(cw):
            layer.data[r * ch + dy][c * cw + dx] = (0, (0, 0, 0), KEY)


def stamp(layer, r, c, cw, ch, tpl):
    """Write one head template into one frame."""
    for (dy, dx), kind in tpl.items():
        if 0 <= dx < cw and 0 <= dy < ch:
            layer.data[r * ch + dy][c * cw + dx] = cell_for(kind)


def restyle_body(layer, key):
    """
    Recolour wolfie's body into the canonical Gromit palette.

    The dark channel is split by silhouette boundary: edge cells become the
    brown outline, interior cells become tan. Without that split the sprite
    inherits wolfie's dark fur MASS and reads as a dark animal.
    """
    def ink(y, x):
        g, fg, bg = layer.data[y][x]
        return (g not in EMPTY) or (tuple(bg) not in (key, MAGENTA))

    def edge(y, x):
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if ny < 0 or nx < 0 or ny >= layer.height or nx >= layer.width:
                return True
            if not ink(ny, nx):
                return True
        return False

    base = {(85, 85, 85): TAN, (170, 170, 170): TAN,
            (0, 170, 170): TAN, (170, 0, 0): BROWN}
    n = 0
    for y in range(layer.height):
        for x in range(layer.width):
            g, fg, bg = layer.data[y][x]
            fg_t, bg_t = tuple(fg), tuple(bg)
            m = dict(base)
            m[(0, 0, 0)] = BROWN if edge(y, x) else TAN
            nf = m.get(fg_t, fg_t)
            nb = bg_t if bg_t == key else m.get(bg_t, bg_t)
            if (nf, nb) != (fg_t, bg_t):
                layer.data[y][x] = (g, nf, nb)
                n += 1
    return n


def connected_objects(layer, r, c, cw, ch, key):
    """Count 4-connected ink blobs in one frame (should always be 1)."""
    def ink(dy, dx):
        g, fg, bg = layer.data[r*ch+dy][c*cw+dx]
        return (g not in EMPTY) or (tuple(bg) not in (key, MAGENTA))
    cells = {(dy, dx) for dy in range(ch) for dx in range(cw) if ink(dy, dx)}
    seen, blobs = set(), 0
    for s in cells:
        if s in seen:
            continue
        blobs += 1
        stack = [s]
        while stack:
            y, x = stack.pop()
            if (y, x) in seen:
                continue
            seen.add((y, x))
            for n in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                if n in cells and n not in seen:
                    stack.append(n)
    return blobs


def main():
    dst = OUTDIR / "gromit-rederived.xp"
    shutil.copy2(V3 / "sprites/wolfie.xp", dst)
    xp = XPFile()
    xp.load(str(dst))
    v, cw, ch, fcols, frows = geom(xp)
    key = tuple(xp.layers[0].data[0][0][2])

    print(f"   body restyled to canonical palette: {restyle_body(v, key)} cells")

    feats = dict(FEATURES)
    feats[5] = mirror_features(FEATURES[3], cw)
    feats[6] = mirror_features(FEATURES[2], cw)
    feats[7] = mirror_features(FEATURES[1], cw)

    half = fcols // 2
    # Reference head-top per angle, taken from each row's idle frame - the
    # templates were authored against those frames.
    ref_top = {r: head_top_row(v, r, 0, cw, ch, key) for r in range(frows)}
    ears = painted = 0
    for r in range(frows):
        for c in range(half):
            # Anchor the template to THIS frame's head. wolfie's head drops a
            # row during the walk cycle, so absolute template coordinates put
            # the eye row on the crown and deleted the tan dome on every walk
            # frame - the idle column looked right and the walk frames broke.
            off = head_top_row(v, r, c, cw, ch, key) - ref_top[r]
            head_to_tan(v, r, c, cw, ch, key)
            a, p = apply_features(v, r, c, cw, ch, feats[r], key, off)
            ears += a
            painted += p
    print(f"   ear cells added {ears}, eye/nose cells painted {painted} "
          f"(silhouette otherwise untouched)")

    for i, layer in enumerate(xp.layers):
        if i == 0:
            continue
        rebuild_reflection(layer, cw, ch, fcols, frows)
    print("   reflection regenerated on L1 and L2")

    blobs = [connected_objects(v, r, 0, cw, ch, key) for r in range(frows)]
    print(f"   connected objects per idle frame (want all 1): {blobs}")

    xp.save(str(dst))
    print(f"\nwrote {dst}")


if __name__ == "__main__":
    main()
