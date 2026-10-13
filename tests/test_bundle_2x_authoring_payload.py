"""Bundle payload regression: 2x authored XPs downsample to native at payload
time and clear all structural gates.

Covers the 2026-05-15 fix where bundle authoring of 2x knight player/attack/
plydie XPs hit G12 (L0 metadata) after the first downsample landed. The new
downsampler is layer-aware:

  - L0/L1 metadata layers: native-position slice (no stride). Preserves family
    codes ("818", "88", "85") and anim-row markers that the 2x authoring path
    keeps at native column positions with zero padding.
  - L0 post-process: zero-glyph cells filled with space (32) + family bg colour.
  - L1 post-process: if all zeros after slice, filled with l1_marker_glyph.
  - L2/L3 art layers: stride-N nearest-neighbour visual downsample.
  - Layer count is clamped to action_spec.layers (drops extras like 2x plydie's
    4th layer when native death expects 3).

The bundle-action session rebind path is exercised separately since these
tests run against the live service helpers directly.
"""
from __future__ import annotations

import shutil
from pathlib import Path

L1_MARKER_BY_FAMILY: dict[str, int] = {
    "player": 57,   # '9'
    "attack": 57,   # '9'
    "plydie": 65,   # 'A'
}

import pytest

from pipeline_v2.config import EXPORT_DIR, ensure_dirs
from pipeline_v2.gates import THRESHOLD_BREACHED
from pipeline_v2.service import (
    _downsample_xp_to_native,
    _run_structural_gates,
    load_template_registry,
)
from pipeline_v2.xp_codec import read_xp


REPO = Path(__file__).resolve().parents[1]
TWOX_DIR = REPO / "output" / "24px-mini-characters-template-2x" / "xps"

KNIGHT_2X = {
    "idle":   TWOX_DIR / "knight1-player.xp",
    "attack": TWOX_DIR / "knight1-attack.xp",
    "death":  TWOX_DIR / "knight1-plydie.xp",
}

EXPECTED_NATIVE_DIMS = {
    "idle":   (126, 80),
    "attack": (144, 80),
    "death":  (110, 88),
}

EXPECTED_L0_FAMILY_HEAD = {
    "idle":   ["8", "1", "8"],  # _FAMILY_L0_COL0["player"]
    "attack": ["8", "8"],       # _FAMILY_L0_COL0["attack"]
    "death":  ["8", "5"],       # _FAMILY_L0_COL0["plydie"]
}


@pytest.fixture(autouse=True)
def _ensure_export_dir(tmp_path, monkeypatch):
    ensure_dirs()
    yield


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    d = tmp_path / "downsample-out"
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture
def action_specs() -> dict:
    reg = load_template_registry()
    return reg["template_sets"]["player_native_full"]["actions"]


@pytest.mark.parametrize("action_key", ["idle", "attack", "death"])
def test_2x_knight_downsamples_to_native_dims_and_layer_count(action_key, action_specs, out_dir):
    """2x knight XPs downsample to native dimensions and the expected layer
    count (4 / 4 / 3). L0 is filled with spaces, L1 with marker glyph."""
    src = KNIGHT_2X[action_key]
    spec = action_specs[action_key]
    expected_w, expected_h = EXPECTED_NATIVE_DIMS[action_key]
    expected_layers = int(spec["layers"])
    family = spec["family"]
    l1_marker = L1_MARKER_BY_FAMILY.get(family, 0)

    out = _downsample_xp_to_native(src, spec["xp_dims"], expected_layers, out_dir, l1_marker_glyph=l1_marker)
    assert out != src, f"{action_key}: downsampler did not run (returned input path unchanged)"
    assert out.exists(), f"{action_key}: downsample output missing"

    xp = read_xp(str(out))
    assert xp["width"] == expected_w, f"{action_key}: width {xp['width']} != {expected_w}"
    assert xp["height"] == expected_h, f"{action_key}: height {xp['height']} != {expected_h}"
    assert len(xp["cells"]) == expected_layers, (
        f"{action_key}: layer count {len(xp['cells'])} != expected {expected_layers}"
    )


@pytest.mark.parametrize("action_key", ["idle", "attack", "death"])
def test_2x_knight_downsample_fills_L0_with_spaces(action_key, action_specs, out_dir):
    """L0 must have every cell non-zero after downsampling. Zero-glyph cells
    get replaced with space (32) and the family-marker's background colour."""
    src = KNIGHT_2X[action_key]
    spec = action_specs[action_key]
    family = spec["family"]
    l1_marker = L1_MARKER_BY_FAMILY.get(family, 0)

    out = _downsample_xp_to_native(src, spec["xp_dims"], int(spec["layers"]), out_dir, l1_marker_glyph=l1_marker)
    xp = read_xp(str(out))
    l0 = xp["cells"][0]
    cell_count = xp["width"] * xp["height"]

    # Every cell must be non-zero
    zero_count = sum(1 for g, _fg, _bg in l0 if g == 0)
    assert zero_count == 0, f"{action_key}: L0 has {zero_count} zero-glyph cells (expected 0)"

    # Verify non-family-marker cells are spaces (32)
    # The family marker occupies the first len(EXPECTED_L0_FAMILY_HEAD) cells
    family_len = len(EXPECTED_L0_FAMILY_HEAD[action_key])
    space_cells = [g for g, _fg, _bg in l0[family_len:] if g == 32]
    assert len(space_cells) == cell_count - family_len, (
        f"{action_key}: L0 has {len(space_cells)} spaces, expected {cell_count - family_len}"
    )

    # Background should be consistent (from first non-zero cell = family marker)
    bg_colors = set(bg for _g, _fg, bg in l0)
    # All cells should share bg from family marker (which was (255,0,255) in source
    # but post-process uses the FIRST non-zero cell's bg)
    assert len(bg_colors) == 1, f"{action_key}: L0 has {len(bg_colors)} distinct bg colors"


@pytest.mark.parametrize("action_key", ["idle", "attack", "death"])
def test_2x_knight_downsample_fills_L1_with_marker_glyph(action_key, action_specs, out_dir):
    """L1 must be fully populated with the anim-row marker glyph after
    downsampling when the 2x source L1 is empty."""
    src = KNIGHT_2X[action_key]
    spec = action_specs[action_key]
    family = spec["family"]
    l1_marker = L1_MARKER_BY_FAMILY.get(family, 0)
    expected_w, expected_h = EXPECTED_NATIVE_DIMS[action_key]

    out = _downsample_xp_to_native(src, spec["xp_dims"], int(spec["layers"]), out_dir, l1_marker_glyph=l1_marker)
    xp = read_xp(str(out))
    l1 = xp["cells"][1]
    cell_count = expected_w * expected_h

    # Every cell must use the marker glyph
    marker_count = sum(1 for g, _fg, _bg in l1 if g == l1_marker)
    assert marker_count == cell_count, (
        f"{action_key}: L1 has {marker_count}/{cell_count} cells with marker {chr(l1_marker)}, "
        f"expected all {cell_count}"
    )

    # All L1 cells must have white background
    for g, fg, bg in l1:
        assert bg == (255, 255, 255), f"{action_key}: L1 has bg={bg}, expected (255,255,255)"
        assert fg == (0, 0, 0), f"{action_key}: L1 has fg={fg}, expected (0,0,0)"


@pytest.mark.parametrize("action_key", ["idle", "attack", "death"])
def test_2x_knight_downsample_preserves_L0_family_marker(action_key, action_specs, out_dir):
    """L0 row 0 family marker ('818') must survive downsampling at native
    positions. Stride-N sampling would drop cell (1) and replace it with cell
    (2), corrupting the family code that G12 checks. The L0 metadata code
    path slices at native (col, row) directly to preserve these cells.
    """
    src = KNIGHT_2X[action_key]
    spec = action_specs[action_key]
    family = spec["family"]
    l1_marker = L1_MARKER_BY_FAMILY.get(family, 0)
    out = _downsample_xp_to_native(src, spec["xp_dims"], int(spec["layers"]), out_dir, l1_marker_glyph=l1_marker)
    xp = read_xp(str(out))
    l0 = xp["cells"][0]
    actual = []
    for c in range(len(EXPECTED_L0_FAMILY_HEAD[action_key])):
        cell = l0[c]
        glyph = cell[0] if cell is not None else 0
        actual.append(chr(glyph) if glyph >= 32 else "")
    assert actual == EXPECTED_L0_FAMILY_HEAD[action_key], (
        f"{action_key}: L0 row-0 head {actual} != expected {EXPECTED_L0_FAMILY_HEAD[action_key]}"
    )


@pytest.mark.parametrize("action_key", ["idle", "attack", "death"])
def test_2x_knight_downsampled_xp_clears_structural_gates(action_key, action_specs, out_dir):
    """After layer-aware downsample, the runtime XP must clear every G7-G12
    gate. Captures regressions in G7 (cell count), G10 (action dims),
    G11 (layer count), G12 (L0 metadata)."""
    src = KNIGHT_2X[action_key]
    spec = action_specs[action_key]
    family = spec["family"]
    l1_marker = L1_MARKER_BY_FAMILY.get(family, 0)
    out = _downsample_xp_to_native(src, spec["xp_dims"], int(spec["layers"]), out_dir, l1_marker_glyph=l1_marker)

    gate_results = _run_structural_gates(str(out), spec, req_id="test")
    blocked = [(g.gate, g.details) for g in gate_results if g.verdict == THRESHOLD_BREACHED]
    assert blocked == [], (
        f"{action_key}: structural gates blocked the downsampled runtime XP: {blocked}"
    )


def test_downsampler_skips_native_dim_inputs(tmp_path: Path):
    """If an authored XP already matches expected dims AND layer count, the
    downsampler must return the input path unchanged (no rewrite, no copy)."""
    native = REPO / "output" / "24px-mini-characters" / "xps" / "knight1-player.xp"
    if not native.exists():
        pytest.skip("native knight XP not present in this checkout")
    expected_dims = (126, 80)
    expected_layers = 4
    out_dir = tmp_path / "noop"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = _downsample_xp_to_native(native, expected_dims, expected_layers, out_dir)
    assert out == native
    assert not any(out_dir.iterdir())


def test_downsampler_drops_extra_layers_to_match_expected(action_specs, out_dir):
    """2x knight1-plydie ships 4 layers; native death template wants 3. The
    downsampler must clamp the layer count so G11 passes."""
    src = KNIGHT_2X["death"]
    src_xp = read_xp(str(src))
    assert len(src_xp["cells"]) == 4, "test fixture: 2x plydie should ship 4 layers"
    out = _downsample_xp_to_native(src, [110, 88], 3, out_dir)
    out_xp = read_xp(str(out))
    assert len(out_xp["cells"]) == 3
