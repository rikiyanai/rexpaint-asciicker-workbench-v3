"""Knight 24px smoke test for the FINAL-JSON-derived bias pipeline.

Source: Knight1_*.png from the 24px Mini Characters asset pack
(directory given by --knight-dir or $KNIGHT_24PX_DIR; typically
'<pack>/images/Characters'; legacy $ASCIICKER_KNIGHT_DIR also accepted):
  - Knight1_Idle.png    208x104  (4 frames × 2 angles, 52px tile)
  - Knight1_Move.png    208x416  (4 frames × 8 angles)
  - Knight1_Attack.png  208x416  (4 frames × 8 angles)
  - Knight1_Faint.png    52x52   (1 frame × 1 angle)

The existing converter (convert_24px_mini_template_2x.py) expects:
  - player family: 9 frames × 8 angles (1 idle + 8 walk)  → 468x416
  - attack family: 8 frames × 8 angles                     → 416x416
  - plydie family: 5 frames × 8 angles                     → 260x416

This script pads/duplicates the knight frames to match those layouts,
writes them into pipeline-v3/output/24px-mini-characters/source_sheets/
as `knight1-{family}-source.png`, then invokes the existing converter.

Run:
  KNIGHT_24PX_DIR='/path/to/24px Mini Characters/images/Characters' \
    python3 pipeline-v3/scripts/convert_knight_24px.py
  # or: python3 pipeline-v3/scripts/convert_knight_24px.py --knight-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHEETS = ROOT / "output" / "24px-mini-characters" / "source_sheets"
OUT_DIR = ROOT / "output" / "24px-mini-characters-template-2x"

TILE_PX = 52
ANGLES = 8


def _resolve_knight_dir(cli_value: str | Path | None) -> Path:
    """Knight1_*.png source directory.

    Precedence: --knight-dir, then $KNIGHT_24PX_DIR, then legacy
    $ASCIICKER_KNIGHT_DIR. The pack lives outside this repo, so there is
    no repo-relative default: fail fast instead of silently composing
    sheets from the wrong source.
    """
    raw = cli_value or os.environ.get("KNIGHT_24PX_DIR") or os.environ.get("ASCIICKER_KNIGHT_DIR")
    if not raw:
        raise SystemExit(
            "Knight source directory not configured. Pass --knight-dir DIR or set "
            "KNIGHT_24PX_DIR to the 24px Mini Characters 'images/Characters' folder "
            "holding Knight1_Idle.png / Knight1_Move.png / Knight1_Attack.png / "
            "Knight1_Faint.png."
        )
    knight_dir = Path(raw).expanduser()
    if not knight_dir.is_dir():
        raise SystemExit(f"Knight source directory does not exist: {knight_dir}")
    missing = [
        name for name in (
            "Knight1_Attack.png", "Knight1_Move.png",
            "Knight1_Idle.png", "Knight1_Faint.png",
        ) if not (knight_dir / name).is_file()
    ]
    if missing:
        raise SystemExit(
            f"--knight-dir {knight_dir} is missing: {', '.join(missing)}"
        )
    return knight_dir


def _read_knight_strip(path: Path, expected_w: int, expected_h: int) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(path)
    img = Image.open(path).convert("RGBA")
    if img.width != expected_w or img.height != expected_h:
        raise ValueError(
            f"{path.name} size {img.width}x{img.height} != expected "
            f"{expected_w}x{expected_h}"
        )
    return img


def _compose_attack_sheet(knight_attack: Image.Image) -> Image.Image:
    """4 frames × 8 angles → 8 frames × 8 angles by duplicating each frame.

    Frame layout 0,1,2,3 → 0,0,1,1,2,2,3,3. Doubles the animation length;
    fine for a smoke test since we only care about per-cell glyph assignment.
    """
    src = knight_attack  # 208 (4 frames) × 416 (8 angles)
    out = Image.new("RGBA", (8 * TILE_PX, ANGLES * TILE_PX), (255, 0, 255, 0))
    for angle in range(ANGLES):
        for frame_in in range(4):
            tile = src.crop(
                (frame_in * TILE_PX, angle * TILE_PX,
                 (frame_in + 1) * TILE_PX, (angle + 1) * TILE_PX)
            )
            for dup in range(2):
                dst_frame = frame_in * 2 + dup
                out.paste(tile, (dst_frame * TILE_PX, angle * TILE_PX), tile)
    return out


def _compose_player_sheet(knight_idle: Image.Image, knight_move: Image.Image) -> Image.Image:
    """1 idle frame + 8 walk frames × 8 angles.

    Knight_Idle is 4 frames × 2 angles — we take frame 0 of angle 0 and
    replicate to all 8 target angles. Knight_Move is 4 frames × 8 angles
    — we duplicate each move frame to fill 8 walk slots.
    """
    out = Image.new("RGBA", (9 * TILE_PX, ANGLES * TILE_PX), (255, 0, 255, 0))
    # Idle frame: take Knight_Idle frame 0, angle 0; replicate to all 8 angles
    idle_tile = knight_idle.crop((0, 0, TILE_PX, TILE_PX))
    for angle in range(ANGLES):
        # If knight_idle has angle row for this angle (angles 0-1), use it;
        # else mirror angle 0
        if angle < knight_idle.height // TILE_PX:
            tile = knight_idle.crop(
                (0, angle * TILE_PX, TILE_PX, (angle + 1) * TILE_PX)
            )
        else:
            tile = idle_tile
        out.paste(tile, (0, angle * TILE_PX), tile)
    # Walk frames 0..7: duplicate Knight_Move 4 frames × 2
    for angle in range(ANGLES):
        for frame_in in range(4):
            tile = knight_move.crop(
                (frame_in * TILE_PX, angle * TILE_PX,
                 (frame_in + 1) * TILE_PX, (angle + 1) * TILE_PX)
            )
            for dup in range(2):
                dst_frame = 1 + frame_in * 2 + dup
                out.paste(tile, (dst_frame * TILE_PX, angle * TILE_PX), tile)
    return out


def _compose_plydie_sheet(knight_faint: Image.Image) -> Image.Image:
    """1 frame × 1 angle → 5 frames × 8 angles by tiling the single faint frame."""
    out = Image.new("RGBA", (5 * TILE_PX, ANGLES * TILE_PX), (255, 0, 255, 0))
    tile = knight_faint  # 52x52, single tile
    for angle in range(ANGLES):
        for frame in range(5):
            out.paste(tile, (frame * TILE_PX, angle * TILE_PX), tile)
    return out


def preprocess(knight_dir: Path) -> dict:
    # knight_dir comes from --knight-dir / $KNIGHT_24PX_DIR (see _resolve_knight_dir).
    knight_attack = _read_knight_strip(
        knight_dir / "Knight1_Attack.png", 4 * TILE_PX, ANGLES * TILE_PX
    )
    knight_move = _read_knight_strip(
        knight_dir / "Knight1_Move.png", 4 * TILE_PX, ANGLES * TILE_PX
    )
    knight_idle = _read_knight_strip(
        knight_dir / "Knight1_Idle.png", 4 * TILE_PX, 2 * TILE_PX
    )
    knight_faint = _read_knight_strip(
        knight_dir / "Knight1_Faint.png", TILE_PX, TILE_PX
    )

    SOURCE_SHEETS.mkdir(parents=True, exist_ok=True)
    composed = {}
    for family, sheet in [
        ("attack", _compose_attack_sheet(knight_attack)),
        ("player", _compose_player_sheet(knight_idle, knight_move)),
        ("plydie", _compose_plydie_sheet(knight_faint)),
    ]:
        out_path = SOURCE_SHEETS / f"knight1-{family}-source.png"
        sheet.save(out_path)
        composed[family] = {
            "path": str(out_path),
            "size": list(sheet.size),
        }
    return composed


def _read_manifest_entries(filter_name: str) -> list[dict]:
    manifest_path = OUT_DIR / "conversion_manifest.json"
    if not manifest_path.exists():
        return []
    data = json.loads(manifest_path.read_text())
    return [entry for entry in data if entry.get("name") == filter_name]


def run_converter() -> None:
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "convert_24px_mini_template_2x.py"),
    ]
    print(f"running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--preprocess-only", action="store_true",
        help="compose knight source sheets but do not run the converter",
    )
    parser.add_argument(
        "--knight-dir", type=Path, default=None,
        help="directory holding Knight1_*.png (defaults to $KNIGHT_24PX_DIR, "
             "legacy $ASCIICKER_KNIGHT_DIR); required unless --skip-preprocess",
    )
    args = parser.parse_args()

    if not args.skip_preprocess:
        # Source dir resolved from --knight-dir / $KNIGHT_24PX_DIR (see _resolve_knight_dir).
        knight_dir = _resolve_knight_dir(args.knight_dir)
        print("preprocessing knight source sheets...")
        composed = preprocess(knight_dir)
        for family, info in composed.items():
            print(f"  knight1-{family}-source.png  {info['size'][0]}x{info['size'][1]}")
        print()

    if args.preprocess_only:
        return 0

    run_converter()

    print()
    print("KNIGHT RESULTS (from conversion_manifest.json):")
    entries = _read_manifest_entries("knight1")
    if not entries:
        print("  no knight1-* entries found in manifest")
        return 1
    for entry in entries:
        print(
            f"  knight1-{entry['family']:6s} "
            f"cells={entry.get('dimensions','?')} "
            f"low_conf={entry.get('low_confidence_cells','?')} "
            f"transparent={entry.get('transparent_cells','?')} "
            f"top_glyphs={[g['glyph'] for g in entry.get('top_glyphs', [])[:5]]}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
