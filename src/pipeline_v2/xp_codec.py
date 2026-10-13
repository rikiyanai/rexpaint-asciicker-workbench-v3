from __future__ import annotations

import gzip
import io
import struct
from pathlib import Path


# Color-key transparency.
#
# Upstream sprite.cpp compares every visual cell against the corresponding
# layer-0 background cell. A magenta visual background is a stronger legacy
# sentinel that discards both foreground and background unconditionally.
#
# Legacy monolithic sprites (the originals: player, wolfie, bigbee, attack,
# plydie, wolack, etc.) author their key as bright yellow. Newer sprites use
# magenta. Both must be honored by every renderer.
MAGENTA_KEY_RGB: tuple[int, int, int] = (255, 0, 255)
LEGACY_YELLOW_KEY_RGB: tuple[int, int, int] = (255, 255, 85)


def layer0_color_key(layers) -> tuple[int, int, int] | None:
    """Return the per-sprite transparency key from L0 cell (0,0)'s background.

    Accepts either:
      - png2xp2png-style layers: list of ``(width, height, cells)`` tuples
        where ``cells`` is a flat column-major list of ``(glyph, fg, bg)``.
      - ``read_xp`` dict ``cells`` form: list of flat lists of ``(glyph, fg, bg)``.

    Returns ``None`` if the structure can't be interpreted.
    """
    if not layers:
        return None
    first = layers[0]
    if isinstance(first, tuple) and len(first) == 3 and hasattr(first[2], "__getitem__"):
        cells = first[2]
    elif isinstance(first, list):
        cells = first
    else:
        return None
    if not cells:
        return None
    cell = cells[0]
    if len(cell) < 3:
        return None
    bg = cell[2]
    return (int(bg[0]), int(bg[1]), int(bg[2]))


def sprite_transparency_keys(layers) -> set[tuple[int, int, int]]:
    """Return the full set of transparent color keys for a parsed XP.

    Always includes magenta and the legacy yellow key, plus the per-sprite
    ``L0[0,0].bg`` value when readable. Mirrors upstream sprite.cpp behavior
    (per-sprite L0 key + hardcoded magenta fallback) and adds legacy-yellow
    coverage for compatibility with this codebase's monolithic sources.
    """
    keys: set[tuple[int, int, int]] = {MAGENTA_KEY_RGB, LEGACY_YELLOW_KEY_RGB}
    sprite_key = layer0_color_key(layers)
    if sprite_key is not None:
        keys.add(sprite_key)
    return keys


def write_xp(path: str | Path, width: int, height: int, layers: list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]]) -> None:
    """Write a minimal REXPaint-like XP file.

    layers: list of flattened layer cell arrays, each size width*height.
    Cell tuple: (glyph, (fg_r,fg_g,fg_b), (bg_r,bg_g,bg_b))
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(p, "wb") as f:
        f.write(struct.pack("<i", -1))
        f.write(struct.pack("<I", len(layers)))
        for layer in layers:
            if len(layer) != width * height:
                raise ValueError("layer cell count mismatch")
            f.write(struct.pack("<i", width))
            f.write(struct.pack("<i", height))
            # REXPaint/xp_core contract: column-major stream order.
            for x in range(width):
                for y in range(height):
                    glyph, fg, bg = layer[y * width + x]
                    f.write(struct.pack("<I", int(glyph)))
                    f.write(bytes([fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]]))


def encode_xp(
    width: int,
    height: int,
    layers: list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]],
) -> bytes:
    """Encode parsed row-major XP layers to deterministic gzip bytes."""
    payload = io.BytesIO()
    payload.write(struct.pack("<i", -1))
    payload.write(struct.pack("<I", len(layers)))
    for layer in layers:
        if len(layer) != width * height:
            raise ValueError("layer cell count mismatch")
        payload.write(struct.pack("<i", width))
        payload.write(struct.pack("<i", height))
        for x in range(width):
            for y in range(height):
                glyph, fg, bg = layer[y * width + x]
                payload.write(struct.pack("<I", int(glyph)))
                payload.write(bytes([fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]]))
    return gzip.compress(payload.getvalue(), mtime=0)


def read_xp(path: str | Path | bytes) -> dict:
    if isinstance(path, bytes):
        raw = path
    else:
        p = Path(path)
        raw = p.read_bytes()
    if raw.startswith(b"\x1f\x8b"):
        data = gzip.decompress(raw)
    else:
        data = raw
    offset = 0

    def u32() -> int:
        nonlocal offset
        v = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        return v

    def i32() -> int:
        nonlocal offset
        v = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        return v

    version = i32()
    if version not in (-1,):
        raise ValueError(f"unsupported xp version: {version}")
    layer_count = u32()
    layers = []
    width = None
    height = None
    for _ in range(layer_count):
        w = i32()
        h = i32()
        if width is None:
            width, height = w, h
        if w != width or h != height:
            raise ValueError("non-uniform layer dimensions")
        cells = [None] * (w * h)
        for x in range(w):
            for y in range(h):
                glyph = u32()
                fg = tuple(data[offset:offset + 3])
                bg = tuple(data[offset + 3:offset + 6])
                offset += 6
                cells[y * w + x] = (glyph, fg, bg)
        layers.append(cells)

    return {
        "version": version,
        "layers": layer_count,
        "width": width or 0,
        "height": height or 0,
        "cells": layers,
    }
