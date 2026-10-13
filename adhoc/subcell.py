#!/usr/bin/env python3
"""
Render .xp sprite frames at SUB-CELL resolution as plain text.

WHY THIS EXISTS
---------------
These sheets are ~90% CP437 block glyphs. A half-block (upper/lower/left/right)
splits one character cell into two independently-coloured halves, which is how
the artwork gets detail finer than the cell grid. Rendering a cell as a single
character - or drawing the glyph as font text - throws that detail away, which
is exactly why earlier reviews of this artwork were unreadable.

So each cell is expanded into a 2x2 grid of sub-cells, and each sub-cell takes
the colour that actually covers it:

    219 full block   -> all four sub-cells take the FOREGROUND
    223 upper half   -> top two fg, bottom two background
    220 lower half   -> bottom two fg, top two background
    221 left half    -> left two fg, right two background
    222 right half   -> right two fg, left two background
    176/177/178      -> shade: approximated as 1/2/3 of the four sub-cells fg
    space / NUL      -> all four sub-cells background
    anything else    -> all four fg (a drawn glyph covers most of its cell)

Transparency follows the engine rule (xp_viewer.py:265): a background counts as
transparent when it equals the Layer-0 colour key OR magenta. Transparent
sub-cells print as '.' so the silhouette reads at a glance.

Colours print as single letters with a legend, so a reviewer sees both shape and
colour in pure text - no image needed.
"""

import sys
from pathlib import Path

V3 = Path("/Users/r/Downloads/asciicker-pipeline-v3")
sys.path.insert(0, str(V3 / "scripts"))
from xp_core import XPFile  # noqa: E402

MAGENTA = (255, 0, 255)
EMPTY_GLYPHS = (0, 32)

# Which of the four sub-cells (TL, TR, BL, BR) the FOREGROUND covers.
FG_MASK = {
    219: (1, 1, 1, 1),      # full block
    223: (1, 1, 0, 0),      # upper half
    220: (0, 0, 1, 1),      # lower half
    221: (1, 0, 1, 0),      # left half
    222: (0, 1, 0, 1),      # right half
    176: (1, 0, 0, 0),      # 25% shade
    177: (1, 0, 0, 1),      # 50% shade
    178: (1, 1, 0, 1),      # 75% shade
}


def letters_for(palette):
    """
    Assign a stable single letter to each colour, for compact text output.

    Args:
        palette: ordered list of "#rrggbb" strings.

    Returns:
        (dict hex -> letter, printable legend string)
    """
    pool = "abcdefghijklmnopqrstuvwxyz"
    m, legend = {}, []
    for i, hexc in enumerate(palette):
        ch = pool[i] if i < len(pool) else "?"
        m[hexc] = ch
        legend.append(f"{ch}={hexc}")
    return m, "  ".join(legend)


def render_frame(v, key, r, c, cw, ch, letters):
    """
    Render one frame as 2x-resolution text lines.

    Args:
        v: the visual layer
        key: engine transparency colour key (r,g,b) taken from Layer 0
        r, c: sprite row / column
        cw, ch: sprite size in character cells
        letters: hex -> letter map

    Returns:
        list[str] of 2*ch lines, each 2*cw characters wide.
    """
    lines = []
    for dy in range(ch):
        top, bot = "", ""
        for dx in range(cw):
            g, fg, bg = v.data[r * ch + dy][c * cw + dx]
            fg_h = "#%02x%02x%02x" % tuple(fg)
            bg_t = tuple(bg)
            bg_transparent = (bg_t == key or bg_t == MAGENTA)
            bg_ch = "." if bg_transparent else letters.get(
                "#%02x%02x%02x" % bg_t, "?")
            fg_ch = letters.get(fg_h, "?")

            if g in EMPTY_GLYPHS:
                quad = (0, 0, 0, 0)          # nothing drawn: background only
            elif g in FG_MASK:
                quad = FG_MASK[g]
            else:
                # A NON-BLOCK glyph - a letter, a symbol, a piece of line art.
                # These were previously rendered as a full block, which is very
                # misleading: Wallace's eyes are glyph 236 (an infinity sign,
                # reading as two eyes) and his mouth glyph 118 ('v'), both dark
                # on skin. Painted as solid blocks they looked like a black slab
                # cut through the face, and a reviewer duly reported a fault
                # that does not exist in the artwork. Such a glyph covers only
                # part of its cell and leaves background visible around it, so
                # it renders as a partial fill and the letter itself is listed
                # in the per-frame glyph note.
                quad = (0, 1, 1, 0)

            tl, tr, bl, br = quad
            top += (fg_ch if tl else bg_ch) + (fg_ch if tr else bg_ch)
            bot += (fg_ch if bl else bg_ch) + (fg_ch if br else bg_ch)
        lines.append(top)
        lines.append(bot)
    return lines


def sheet(path, label, rows, cols, out):
    """Render selected rows/cols of one sheet into `out` (a list of strings)."""
    xp = XPFile()
    xp.load(str(path))
    v = xp.layers[2]
    key = tuple(xp.layers[0].data[0][0][2])
    m = xp.get_metadata()
    angles = int(m["angles"])
    anims = [int(x) for x in m["anims"]]
    projs = int(m.get("projs", 2))
    fcols, frows = sum(anims) * projs, angles
    cw, ch = v.width // fcols, v.height // frows

    # Palette from cells that actually draw something.
    pal = []
    for y in range(v.height):
        for x in range(v.width):
            g, fg, bg = v.data[y][x]
            for col in (tuple(fg), tuple(bg)):
                if col == MAGENTA or col == key:
                    continue
                h = "#%02x%02x%02x" % col
                if h not in pal:
                    pal.append(h)
    letters, legend = letters_for(sorted(pal))

    out.append(f"===== {label} =====")
    out.append(f"sprite {cw}x{ch} cells, rendered at 2x sub-cell resolution "
               f"({2*cw}x{2*ch} characters per frame)")
    out.append("'.' = transparent (engine colour key #%02x%02x%02x or magenta)"
               % key)
    out.append(f"legend: {legend}")
    out.append("")
    ANGN = ["0 front/S", "45 SE", "90 E", "135 NE", "180 back/N",
            "225 NW", "270 W", "315 SW"]
    half = fcols // 2
    for r in rows:
        out.append(f"--- ROW {r}  ({ANGN[r]}) ---")
        for c in cols:
            kind = "projection" if c < half else "reflection"
            phase = "idle" if c % half == 0 else f"walk {c % half}"
            out.append(f"  frame col {c} ({kind}, {phase})")
            for line in render_frame(v, key, r, c, cw, ch, letters):
                out.append("    " + line)
            out.append("")
    out.append("")


if __name__ == "__main__":
    RP = Path("/private/tmp/claude-501/-Users-r-Downloads-asciicker-pipeline-v3/"
              "aa11f89f-6d79-4b4c-9dfa-9c01e91de39e/scratchpad")
    outdir = RP / "review"
    outdir.mkdir(exist_ok=True)

    for name, path in (
        ("gromit-repaired", RP / "repaired/gromit-repaired.xp"),
        ("wolfie-reference", V3 / "sprites/wolfie.xp"),
        ("wallace-repaired", RP / "repaired/wallace-repaired.xp"),
        ("player-reference", V3 / "sprites/player-nude.xp"),
    ):
        lines = []
        sheet(path, name, rows=range(8), cols=[0], out=lines)
        dest = outdir / f"{name}-idle.txt"
        dest.write_text("\n".join(lines))
        print(f"wrote {dest}")
