#!/usr/bin/env python3
"""Read-only parser for the REXPaint XP subset used by contract inspection."""
from __future__ import annotations

import gzip
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import cast


MAX_DECOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_LAYERS = 64
MAX_CELLS_PER_LAYER = 10_000_000

Cell = tuple[int, tuple[int, int, int], tuple[int, int, int]]


@dataclass(frozen=True)
class XPLayer:
    width: int
    height: int
    data: list[list[Cell]]


@dataclass(frozen=True)
class XPFile:
    version: int
    layers: list[XPLayer]

    def get_metadata(self) -> dict[str, object] | None:
        if not self.layers:
            return None
        layer = self.layers[0]

        def digit(cell: Cell) -> int:
            glyph = cell[0]
            if 48 <= glyph <= 57:
                return glyph - 48
            if 65 <= glyph <= 90:
                return glyph - 65 + 10
            if 97 <= glyph <= 122:
                return glyph - 97 + 10
            return -1

        raw_angles = digit(layer.data[0][0])
        angles, projections = (raw_angles, 2) if raw_angles > 0 else (1, 1)
        animations: list[int] = []
        for column in range(1, layer.width):
            length = digit(layer.data[0][column])
            if length <= 0:
                break
            animations.append(length)
        return {"angles": angles, "projs": projections, "anims": animations}


def load_xp(path: Path) -> XPFile:
    """Load one gzip-compressed XP file without exposing any write operation."""
    with gzip.open(path, "rb") as handle:
        content = handle.read(MAX_DECOMPRESSED_BYTES + 1)
    if len(content) > MAX_DECOMPRESSED_BYTES:
        raise ValueError(f"XP exceeds decompressed size limit: {path}")
    if len(content) < 8:
        raise ValueError(f"XP file is too small: {path}")

    offset = 0
    version = struct.unpack_from("<i", content, offset)[0]
    offset += 4
    layer_count = struct.unpack_from("<I", content, offset)[0]
    offset += 4
    if layer_count > MAX_LAYERS:
        raise ValueError(f"XP claims {layer_count} layers, maximum is {MAX_LAYERS}: {path}")

    layers: list[XPLayer] = []
    for layer_index in range(layer_count):
        if offset + 8 > len(content):
            raise ValueError(f"XP is truncated at layer {layer_index} header: {path}")
        width, height = struct.unpack_from("<ii", content, offset)
        offset += 8
        if width <= 0 or height <= 0:
            raise ValueError(f"XP layer {layer_index} has invalid size {width}x{height}: {path}")
        if width * height > MAX_CELLS_PER_LAYER:
            raise ValueError(f"XP layer {layer_index} exceeds the cell limit: {path}")
        byte_count = width * height * 10
        if offset + byte_count > len(content):
            raise ValueError(f"XP is truncated in layer {layer_index}: {path}")

        data: list[list[Cell | None]] = [
            [None for _column in range(width)] for _row in range(height)
        ]
        for column in range(width):
            for row in range(height):
                glyph = struct.unpack_from("<I", content, offset)[0]
                offset += 4
                foreground = tuple(content[offset:offset + 3])
                offset += 3
                background = tuple(content[offset:offset + 3])
                offset += 3
                data[row][column] = (glyph, foreground, background)
        if any(cell is None for row in data for cell in row):
            raise ValueError(f"XP layer {layer_index} did not decode every cell: {path}")
        layers.append(XPLayer(
            width=width,
            height=height,
            data=cast(list[list[Cell]], data),
        ))

    if offset != len(content):
        raise ValueError(f"XP contains {len(content) - offset} trailing bytes: {path}")
    return XPFile(version=version, layers=layers)
