#!/usr/bin/env python3
"""Repair the authored Wallace and Gromit actor sheets.

The actor variants are owned by pipeline-v3 under ``sprites/``. This command
repairs those source files and updates the two v3 review sessions without
changing session metadata. Projection 0 is authored; projection 1 is the
engine's vertical reflection, so it is rebuilt from projection 0 after
character treatment.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path


V3_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3_ROOT / "scripts"))
from xp_core import XPFile  # type: ignore  # noqa: E402


SPRITES = V3_ROOT / "sprites"
SESSIONS = V3_ROOT / "data" / "sessions"
BACKUP_ROOT = Path("/tmp/asciicker-actor-sheet-repair")

MAGENTA = (255, 0, 255)
GREY_CREAM = (170, 170, 170)
WARM_CREAM = (214, 191, 139)
YELLOW_SKIN = (255, 255, 85)
BLACK = (0, 0, 0)
NOSE = (26, 26, 26)
CYAN = (0, 170, 170)
RED = (170, 0, 0)
BROWN = (126, 91, 50)
PLAYER_SKIN = (255, 85, 85)
PLAYER_SHIRT = (170, 0, 170)
PLAYER_PANTS_LIGHT = (85, 85, 255)
PLAYER_PANTS_DARK = (0, 0, 170)
WALLACE_SKIN = (255, 228, 181)
WALLACE_SWEATER = (0, 102, 0)
WALLACE_SWEATER_SHADOW = (0, 68, 0)
WALLACE_TROUSERS = (170, 85, 0)
WALLACE_TIE = (170, 0, 0)
WHITE = (255, 255, 255)
VERTICAL_GLYPH_FLIP = {
    220: 223,
    223: 220,
    218: 192,
    192: 218,
    191: 217,
    217: 191,
    85: 227,
    227: 85,
    194: 193,
    193: 194,
    118: 94,
    94: 118,
    92: 47,
    47: 92,
}

TRANSPARENT_GLYPHS = {0, 32}

# Five reference-derived 10x6 cell rasters. Each token describes one XP cell:
# doubled letters are solid, two letters are a left/right half-block, and
# ``top/bottom`` is a horizontal half-block. ``.`` is transparency, T is warm
# cream, E is ear brown, K is black, and W is eye white. These rasters own only
# local rows 0-5. Wolfie's torso and locomotion own rows 6-11; keeping that
# boundary prevents the head from swallowing the body and reading as a head
# with four legs. Rows 5-7 are horizontal mirrors of rows 3-1.
GROMIT_HEAD_CELLS = {
    0: (
        ".. .. ./E ./T TT TT ./T ./E .. ..",
        ".. .E EE TT TT TT TT EE E. ..",
        ".. EE .T TT EY EY TT T. EE ..",
        ".. E. TT TT TT TT TT TT .E ..",
        ".. E/. .T TT TK KT TT T. E/. ..",
        ".. .. .. T/. TT TT T/. .. .. ..",
    ),
    1: (
        ".. .. ./E ./T TT TT ./T ./E .. ..",
        ".. .E EE TT TT TT TT EE E. ..",
        ".. EE .T TT TT EY EY TT T. ..",
        ".. E. .T TT TT TT TT TT TT ..",
        ".. E/. .T TT TT TT TT TT KK ..",
        ".. .. .. T/. TT TT T/. .. .. ..",
    ),
    2: (
        ".. ./E EE E/T ./T TT T/. .. .. ..",
        ".E EE E/T TT TT TT T. .. .. ..",
        "EE E/T TT TT TT EY TT T. .. ..",
        ".. E. .T TT TT TT TT TT T. ..",
        ".. E/. .T TT TT TT TT TT KK ..",
        ".. .. .. T/. TT TT T/. .. .. ..",
    ),
    3: (
        ".. .. ./E EE E/T ./T TT T/. .. ..",
        ".. .E EE E/T TT TT TT T. .. ..",
        ".. EE E/T TT TT TT TT T. .. ..",
        ".. E. .T TT TT TT TT T/. .. ..",
        ".. E/. .T TT TT TT TT T/. .. ..",
        ".. .. .. T/. TT TT T/. .. .. ..",
    ),
    4: (
        ".. .. ./E ./T TT TT ./T ./E .. ..",
        ".. .E EE TT TT TT TT EE E. ..",
        ".. EE .T TT TT TT TT T. EE ..",
        ".. E. TT TT TT TT TT TT .E ..",
        ".. E/. .T TT TT TT TT T. E/. ..",
        ".. .. .. T/. TT TT T/. .. .. ..",
    ),
}


def _mirror_raster_token(token: str) -> str:
    if token in ("..", "EY") or "/" in token:
        return token
    return token[::-1]


def _gromit_head_template(sprite_row: int) -> tuple[tuple[str, ...], ...]:
    source_row = sprite_row if sprite_row <= 4 else 8 - sprite_row
    template = tuple(tuple(row.split()) for row in GROMIT_HEAD_CELLS[source_row])
    if sprite_row <= 4:
        return template
    return tuple(tuple(_mirror_raster_token(token) for token in reversed(row)) for row in template)


def mirror_projection(layer, sprite_w: int, sprite_h: int) -> int:
    """Copy every authored frame in projection 0 into projection 1 vertically."""
    cols = layer.width // sprite_w
    rows = layer.height // sprite_h
    if cols % 2:
        raise ValueError(f"expected an even projection column count, got {cols}")
    source_cols = cols // 2
    changed = 0
    for sr in range(rows):
        for sc in range(source_cols):
            target_sc = sc + source_cols
            for ly in range(sprite_h):
                for lx in range(sprite_w):
                    source = layer.data[sr * sprite_h + ly][sc * sprite_w + lx]
                    source = (VERTICAL_GLYPH_FLIP.get(source[0], source[0]), source[1], source[2])
                    target_y = sr * sprite_h + (sprite_h - 1 - ly)
                    target_x = target_sc * sprite_w + lx
                    if layer.data[target_y][target_x] != source:
                        layer.data[target_y][target_x] = source
                        changed += 1
    return changed


def _is_ink(cell, key) -> bool:
    glyph, _fg, bg = cell
    return glyph not in TRANSPARENT_GLYPHS or tuple(bg) not in (key, MAGENTA)


def _solid_cell(color):
    # This sprite loader treats glyph 219 as background-filled. A visible solid
    # therefore uses a space with a non-key background, matching upstream XP.
    return (32, color, color)


def _raster_color(code: str, key):
    colors = {
        ".": key,
        "T": WARM_CREAM,
        "E": BROWN,
        "K": BLACK,
        "W": (255, 255, 255),
    }
    try:
        return colors[code]
    except KeyError as exc:
        raise ValueError(f"unknown Gromit raster color: {code}") from exc


def _raster_cell(token: str, key):
    if token == "..":
        return (0, BLACK, MAGENTA)
    if token == "EY":
        return (254, BLACK, (255, 255, 255))
    if "/" in token:
        top, bottom = token.split("/", 1)
        return (220, _raster_color(bottom, key), _raster_color(top, key))
    if len(token) != 2:
        raise ValueError(f"invalid Gromit raster token: {token}")
    left, right = token
    if left == right:
        return _solid_cell(_raster_color(left, key))
    return (221, _raster_color(left, key), _raster_color(right, key))


def restyle_gromit_body(layer, sprite_w: int, sprite_h: int, source_cols: int, rows: int, key) -> int:
    """Convert Wolfie's palette frame-by-frame without changing locomotion geometry."""
    base = {
        (85, 85, 85): WARM_CREAM,
        GREY_CREAM: WARM_CREAM,
        CYAN: WARM_CREAM,
        RED: BROWN,
    }
    changed = 0
    for sprite_row in range(rows):
        for sprite_col in range(source_cols):
            origin_x = sprite_col * sprite_w
            origin_y = sprite_row * sprite_h
            def ink(local_y: int, local_x: int) -> bool:
                if not (0 <= local_x < sprite_w and 0 <= local_y < sprite_h):
                    return False
                return _is_ink(layer.data[origin_y + local_y][origin_x + local_x], key)

            for local_y in range(sprite_h):
                for local_x in range(sprite_w):
                    y, x = origin_y + local_y, origin_x + local_x
                    glyph, fg, bg = layer.data[y][x]
                    if not ink(local_y, local_x):
                        continue
                    edge = any(
                        not ink(local_y + dy, local_x + dx)
                        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))
                    )
                    colors = dict(base)
                    colors[BLACK] = BROWN if edge else WARM_CREAM
                    new_fg = colors.get(tuple(fg), tuple(fg))
                    new_bg = tuple(bg) if tuple(bg) == key else colors.get(tuple(bg), tuple(bg))
                    if (new_fg, new_bg) != (tuple(fg), tuple(bg)):
                        layer.data[y][x] = (glyph, new_fg, new_bg)
                        changed += 1
    return changed


def author_gromit_heads(layer, sprite_w: int, sprite_h: int, source_cols: int, rows: int, key) -> int:
    """Replace Wolfie's head while leaving its torso and locomotion untouched."""
    changed = 0
    for sprite_row in range(rows):
        template = _gromit_head_template(sprite_row)
        if len(template) != 6 or any(len(row) != 10 for row in template):
            raise ValueError(f"invalid Gromit raster dimensions for row {sprite_row}")
        for sprite_col in range(source_cols):
            origin_x = sprite_col * sprite_w
            origin_y = sprite_row * sprite_h
            for template_y in range(6):
                for local_x in range(sprite_w):
                    y, x = origin_y + template_y, origin_x + local_x
                    cell = (0, BLACK, MAGENTA)
                    if layer.data[y][x] != cell:
                        layer.data[y][x] = cell
                        changed += 1
            for template_y, template_row in enumerate(template):
                local_y = template_y
                for raster_x, token in enumerate(template_row):
                    if token == "..":
                        continue
                    y = origin_y + local_y
                    x = origin_x + raster_x
                    cell = _raster_cell(token, key)
                    if layer.data[y][x] != cell:
                        layer.data[y][x] = cell
                        changed += 1
    return changed


def _wallace_head_cell(sprite_row: int, local_y: int, local_x: int):
    if (local_y, local_x) == (0, 3):
        return (220, WALLACE_SKIN, MAGENTA)
    if (local_y, local_x) == (1, 2):
        return (222, WALLACE_SKIN, MAGENTA)
    if (local_y, local_x) == (1, 4):
        return (221, WALLACE_SKIN, MAGENTA)
    if (local_y, local_x) == (1, 3):
        if sprite_row in (0, 1, 7):
            return (236, BLACK, WALLACE_SKIN)
        if sprite_row in (2, 6):
            return (111, BLACK, WALLACE_SKIN)
        return _solid_cell(WALLACE_SKIN)
    if (local_y, local_x) == (2, 3):
        face_glyphs = {0: 118, 1: 118, 2: 192, 6: 217, 7: 118}
        if sprite_row in face_glyphs:
            return (face_glyphs[sprite_row], BLACK, WALLACE_SKIN)
        if sprite_row in (3, 5):
            return (223, WALLACE_SKIN, WALLACE_SKIN)
        return (220, WALLACE_SKIN, WALLACE_SKIN)
    return None


def _replace_colors(cell, fg_map, bg_map, key):
    glyph, fg, bg = cell
    fg = MAGENTA if tuple(fg) == key else fg_map.get(tuple(fg), tuple(fg))
    bg = MAGENTA if tuple(bg) == key else bg_map.get(tuple(bg), tuple(bg))
    return (glyph, fg, bg)


def style_wallace_projection(layer, key) -> int:
    """Apply Wallace styling while retaining player-0000 animation geometry."""
    changed = 0
    for sprite_row in range(8):
        for sprite_col in range(9):
            origin_x = sprite_col * 7
            origin_y = sprite_row * 9
            for local_y in range(9):
                for local_x in range(7):
                    y, x = origin_y + local_y, origin_x + local_x
                    source = layer.data[y][x]
                    head = (
                        _wallace_head_cell(sprite_row, local_y, local_x)
                        if local_y <= 2
                        else None
                    )
                    if head is not None:
                        styled = head
                    elif local_y <= 2:
                        # Player arm animation reaches into the head band. Keep
                        # its exact half-block geometry and turn it into sleeve.
                        styled = _replace_colors(
                            source,
                            {PLAYER_SKIN: WALLACE_SWEATER, PLAYER_SHIRT: WALLACE_SWEATER},
                            {PLAYER_SKIN: WALLACE_SWEATER, PLAYER_SHIRT: WALLACE_SWEATER},
                            key,
                        )
                    elif local_y <= 5:
                        styled = _replace_colors(
                            source,
                            {
                                PLAYER_SKIN: WALLACE_SWEATER_SHADOW,
                                PLAYER_SHIRT: WALLACE_SWEATER_SHADOW,
                                PLAYER_PANTS_LIGHT: WALLACE_TROUSERS,
                                PLAYER_PANTS_DARK: WALLACE_TROUSERS,
                            },
                            {
                                PLAYER_SKIN: WALLACE_SWEATER,
                                PLAYER_SHIRT: WALLACE_SWEATER,
                                PLAYER_PANTS_LIGHT: WALLACE_TROUSERS,
                                PLAYER_PANTS_DARK: WALLACE_TROUSERS,
                            },
                            key,
                        )
                    else:
                        styled = _replace_colors(
                            source,
                            {
                                PLAYER_PANTS_LIGHT: WALLACE_TROUSERS,
                                PLAYER_PANTS_DARK: WALLACE_TROUSERS,
                            },
                            {
                                PLAYER_PANTS_LIGHT: WALLACE_TROUSERS,
                                PLAYER_PANTS_DARK: WALLACE_TROUSERS,
                            },
                            key,
                        )
                    if local_y == 3 and local_x == 3:
                        styled = (
                            (31, WALLACE_TIE, WHITE)
                            if sprite_row in (0, 1, 2, 6, 7)
                            else _solid_cell(WALLACE_SWEATER)
                        )
                    if styled != source:
                        layer.data[y][x] = styled
                        changed += 1

    # Keep the sweater/trouser boundary present in every walk pose. The most
    # common drawn source variant owns each varying waist cell.
    for sprite_row in range(8):
        for local_x in range(7):
            cells = [layer.data[sprite_row * 9 + 5][sprite_col * 7 + local_x] for sprite_col in range(9)]
            unique = {(g, tuple(fg), tuple(bg)) for g, fg, bg in cells}
            drawn = [cell for cell in unique if cell[0] not in TRANSPARENT_GLYPHS]
            if len(unique) < 2 or not drawn:
                continue
            selected = max(drawn, key=lambda cell: sum(
                1 for glyph, fg, bg in cells
                if (glyph, tuple(fg), tuple(bg)) == cell
            ))
            for sprite_col in range(9):
                y, x = sprite_row * 9 + 5, sprite_col * 7 + local_x
                if layer.data[y][x] != selected:
                    layer.data[y][x] = selected
                    changed += 1
    return changed


def _cell_quadrants(cell, key):
    glyph, fg, bg = cell
    fg_ink = tuple(fg) not in (key, MAGENTA)
    bg_ink = tuple(bg) not in (key, MAGENTA)
    if glyph == 220:
        return (bg_ink, bg_ink, fg_ink, fg_ink)
    if glyph == 221:
        return (fg_ink, bg_ink, fg_ink, bg_ink)
    if glyph == 222:
        return (bg_ink, fg_ink, bg_ink, fg_ink)
    if glyph == 223:
        return (fg_ink, fg_ink, bg_ink, bg_ink)
    if glyph in TRANSPARENT_GLYPHS:
        return (bg_ink,) * 4
    return (fg_ink or bg_ink,) * 4


def assert_wallace(xp: XPFile, player: XPFile) -> None:
    if xp.layers[0].data != player.layers[0].data or xp.layers[1].data != player.layers[1].data:
        raise AssertionError("Wallace metadata/height layers diverged from player-0000")
    layer = xp.layers[2]
    base = player.layers[2]
    key = tuple(xp.layers[0].data[0][0][2])
    for sprite_row in range(8):
        for sprite_col in range(9):
            for local_y in range(9):
                for local_x in range(7):
                    y = sprite_row * 9 + local_y
                    x = sprite_col * 7 + local_x
                    if _cell_quadrants(layer.data[y][x], key) != _cell_quadrants(base.data[y][x], key):
                        raise AssertionError(
                            "Wallace silhouette diverged from player-0000 "
                            f"row={sprite_row} col={sprite_col} cell=({local_x},{local_y})"
                        )
            left_ear = layer.data[sprite_row * 9 + 1][sprite_col * 7 + 2]
            right_ear = layer.data[sprite_row * 9 + 1][sprite_col * 7 + 4]
            if left_ear != (222, WALLACE_SKIN, MAGENTA) or right_ear != (221, WALLACE_SKIN, MAGENTA):
                raise AssertionError(f"Wallace half-block ears missing at row={sprite_row} col={sprite_col}")
            face = [
                layer.data[sprite_row * 9 + local_y][sprite_col * 7 + 3][0]
                for local_y in (1, 2)
            ]
            if sprite_row in (0, 1, 7) and face != [236, 118]:
                raise AssertionError(f"Wallace two-eye face mismatch at row={sprite_row} col={sprite_col}")
            if sprite_row == 2 and face != [111, 192]:
                raise AssertionError(f"Wallace right profile mismatch at col={sprite_col}")
            if sprite_row == 6 and face != [111, 217]:
                raise AssertionError(f"Wallace left profile mismatch at col={sprite_col}")
            if sprite_row in (3, 4, 5) and any(glyph in (111, 118, 192, 217, 236) for glyph in face):
                raise AssertionError(f"Wallace rear view has a face at row={sprite_row} col={sprite_col}")
            if sprite_row in (3, 4, 5):
                chest = layer.data[sprite_row * 9 + 3][sprite_col * 7 + 3]
                if chest != _solid_cell(WALLACE_SWEATER):
                    raise AssertionError(f"Wallace rear view has a tie/bib at row={sprite_row} col={sprite_col}")


def repair_wallace() -> tuple[XPFile, int, int]:
    source = SPRITES / "player-0000.xp"
    xp = XPFile()
    xp.load(str(source))
    layer = xp.layers[2]
    if (layer.width, layer.height) != (126, 72):
        raise ValueError(f"Wallace visual layer has unexpected size {layer.width}x{layer.height}")
    key = tuple(xp.layers[0].data[0][0][2])
    styled = style_wallace_projection(layer, key)
    mirrored = mirror_projection(layer, 7, 9)
    return xp, styled, mirrored


def repair_gromit() -> tuple[XPFile, int, int, int]:
    source = SPRITES / "wolfie.xp"
    xp = XPFile()
    xp.load(str(source))
    layer = xp.layers[2]
    if (layer.width, layer.height) != (180, 96):
        raise ValueError(f"Wolfie visual layer has unexpected size {layer.width}x{layer.height}")
    sprite_w, sprite_h = 10, 12
    rows = 8
    source_cols = 9
    key = tuple(xp.layers[0].data[0][0][2])
    recolored = restyle_gromit_body(layer, sprite_w, sprite_h, source_cols, rows, key)
    lower_body = {
        (sprite_row, sprite_col, local_y, local_x): layer.data[
            sprite_row * sprite_h + local_y
        ][sprite_col * sprite_w + local_x]
        for sprite_row in range(rows)
        for sprite_col in range(source_cols)
        for local_y in range(6, 12)
        for local_x in range(sprite_w)
        if _is_ink(
            layer.data[sprite_row * sprite_h + local_y][sprite_col * sprite_w + local_x],
            key,
        )
    }
    authored = author_gromit_heads(layer, sprite_w, sprite_h, source_cols, rows, key)
    for (sprite_row, sprite_col, local_y, local_x), cell in lower_body.items():
        layer.data[sprite_row * sprite_h + local_y][sprite_col * sprite_w + local_x] = cell
    for (sprite_row, sprite_col, local_y, local_x), expected in lower_body.items():
        actual = layer.data[sprite_row * sprite_h + local_y][sprite_col * sprite_w + local_x]
        if actual != expected:
            raise AssertionError(
                "Gromit head overwrote locomotion "
                f"row={sprite_row} col={sprite_col} cell=({local_x},{local_y})"
            )
    mirrored = mirror_projection(layer, 10, 12)
    return xp, recolored, authored, mirrored


def layer_cells(layer) -> list[dict]:
    cells = []
    for y, row in enumerate(layer.data):
        for x, (glyph, fg, bg) in enumerate(row):
            cells.append({
                "idx": y * layer.width + x,
                "glyph": glyph,
                "fg": list(fg),
                "bg": list(bg),
            })
    return cells


def update_session(session_id: str, layer) -> None:
    path = SESSIONS / f"{session_id}.json"
    if not path.is_file():
        raise FileNotFoundError(path)
    session = json.loads(path.read_text())
    expected = int(session.get("grid_cols", 0)) * int(session.get("grid_rows", 0))
    cells = layer_cells(layer)
    if expected != len(cells):
        raise ValueError(f"{path.name}: session grid has {expected} cells, XP has {len(cells)}")
    session["cells"] = cells
    layers = session.get("layers")
    if not isinstance(layers, list) or len(layers) <= 2:
        raise ValueError(f"{path.name}: missing visual layer")
    layers[2] = cells
    path.write_text(json.dumps(session, separators=(",", ":")))


def find_actor_session(actor: str, width: int, height: int) -> tuple[str, Path]:
    """Return the newest live raw-XP session matching an actor source."""
    matches = []
    for path in SESSIONS.glob("*.json"):
        try:
            session = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        name = str(session.get("name", "")).lower()
        if (
            actor in name
            and int(session.get("grid_cols", 0)) == width
            and int(session.get("grid_rows", 0)) == height
        ):
            matches.append(path)
    if not matches:
        raise FileNotFoundError(f"no {actor} {width}x{height} workbench session under {SESSIONS}")
    path = max(matches, key=lambda candidate: candidate.stat().st_mtime_ns)
    return path.stem, path


def assert_exact_reflections(xp: XPFile, sprite_w: int, sprite_h: int) -> None:
    layer = xp.layers[2]
    cols = layer.width // sprite_w
    rows = layer.height // sprite_h
    for sr in range(rows):
        for sc in range(cols // 2):
            for ly in range(sprite_h):
                for lx in range(sprite_w):
                    left = layer.data[sr * sprite_h + ly][sc * sprite_w + lx]
                    left = (VERTICAL_GLYPH_FLIP.get(left[0], left[0]), left[1], left[2])
                    right = layer.data[sr * sprite_h + (sprite_h - 1 - ly)][(sc + cols // 2) * sprite_w + lx]
                    if left != right:
                        raise AssertionError(f"reflection mismatch at row={sr} frame={sc} cell=({lx},{ly})")


def assert_gromit_heads(xp: XPFile) -> None:
    layer = xp.layers[2]
    key = tuple(xp.layers[0].data[0][0][2])
    if key != YELLOW_SKIN:
        raise AssertionError(f"Gromit transparency key changed to {key}")
    expected_eyes = {0: 2, 1: 2, 2: 1, 3: 0, 4: 0, 5: 0, 6: 1, 7: 2}
    for sprite_row in range(8):
        for sprite_col in range(9):
            cells = [
                layer.data[sprite_row * 12 + y][sprite_col * 10 + x]
                for y in range(6)
                for x in range(10)
            ]
            eyes = sum(1 for glyph, _fg, _bg in cells if glyph == 254)
            visible_colors = []
            for glyph, fg, bg in cells:
                if tuple(bg) not in (key, MAGENTA):
                    visible_colors.append(tuple(bg))
                if glyph not in TRANSPARENT_GLYPHS and tuple(fg) not in (key, MAGENTA):
                    visible_colors.append(tuple(fg))
            black = sum(
                1 for color in visible_colors if color == BLACK
            )
            brown = sum(1 for color in visible_colors if color == BROWN)
            if eyes != expected_eyes[sprite_row]:
                raise AssertionError(
                    f"Gromit eye topology mismatch at row={sprite_row} "
                    f"col={sprite_col}: eyes={eyes}, expected={expected_eyes[sprite_row]}"
                )
            if expected_eyes[sprite_row] and black < eyes + 1:
                raise AssertionError(
                    f"Gromit nose missing at row={sprite_row} col={sprite_col}: "
                    f"eyes={eyes} black_channels={black}"
                )
            if not expected_eyes[sprite_row] and black:
                raise AssertionError(
                    f"Gromit rear view has face colors at row={sprite_row} col={sprite_col}: "
                    f"black_channels={black}"
                )
            if brown < 4:
                raise AssertionError(f"Gromit ears missing at row={sprite_row} col={sprite_col}")
            invisible_solids = sum(
                1 for glyph, _fg, bg in cells if glyph == 219 and tuple(bg) in (key, MAGENTA)
            )
            if invisible_solids:
                raise AssertionError(
                    f"Gromit has {invisible_solids} transparent solid-block cells "
                    f"at row={sprite_row} col={sprite_col}"
                )


def backup(paths: list[Path]) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_ROOT / stamp
    dest.mkdir(parents=True, exist_ok=False)
    for path in paths:
        shutil.copy2(path, dest / path.name)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write repaired XP files and sessions")
    parser.add_argument(
        "--actor",
        choices=("gromit", "wallace", "both"),
        default="both",
        help="limit the repair to one actor",
    )
    args = parser.parse_args()

    wallace_path = SPRITES / "2026-06-08-wallace.xp"
    gromit_path = SPRITES / "2026-06-08-gromit.xp"
    required = []
    wallace_session_id = gromit_session_id = None
    if args.actor in ("wallace", "both"):
        required.append(wallace_path)
        if args.apply:
            wallace_session_id, wallace_session = find_actor_session("wallace", 126, 72)
            required.append(wallace_session)
    if args.actor in ("gromit", "both"):
        required.append(gromit_path)
        if args.apply:
            gromit_session_id, gromit_session = find_actor_session("gromit", 180, 96)
            required.append(gromit_session)
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        print(json.dumps({"ok": False, "missing": missing}))
        return 2

    report = {
        "ok": True,
        "apply": args.apply,
        "actor": args.actor,
    }
    wallace = gromit = None
    if args.actor in ("wallace", "both"):
        wallace, wallace_styled, wallace_changed = repair_wallace()
        wallace_player = XPFile(str(SPRITES / "player-0000.xp"))
        assert_exact_reflections(wallace, 7, 9)
        assert_wallace(wallace, wallace_player)
        report.update({
            "wallace_style_cells_replaced": wallace_styled,
            "wallace_reflection_cells_replaced": wallace_changed,
            "wallace_source": "player-0000 topology + Wallace directional head/outfit",
        })
    if args.actor in ("gromit", "both"):
        gromit, gromit_recolored, gromit_authored, gromit_changed = repair_gromit()
        assert_exact_reflections(gromit, 10, 12)
        assert_gromit_heads(gromit)
        report.update({
            "gromit_palette_cells_replaced": gromit_recolored,
            "gromit_head_cells_replaced": gromit_authored,
            "gromit_reflection_cells_replaced": gromit_changed,
            "gromit_source": "compact reference-derived head + Wolfie torso/locomotion",
        })
    if not args.apply:
        print(json.dumps(report, indent=2))
        return 0

    backup_dir = backup(required)
    if wallace is not None:
        wallace.save(str(wallace_path))
        update_session(wallace_session_id, wallace.layers[2])
        report["wallace_session_id"] = wallace_session_id
    if gromit is not None:
        gromit.save(str(gromit_path))
        update_session(gromit_session_id, gromit.layers[2])
        report["gromit_session_id"] = gromit_session_id
    report["backup"] = str(backup_dir)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
