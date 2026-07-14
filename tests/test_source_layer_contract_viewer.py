"""FL-4162 — Source Layer Contract Viewer is read-only and shows the trap."""
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import xp_core  # noqa: E402
import source_layer_contract_viewer as v  # noqa: E402

SM = PIPELINE_V3.parent / "docs/research/ascii/semantic_maps"
SPRITES = PIPELINE_V3.parent / "assets/sprites"


# ---- pure units (no disk) ----
def _layer(w, h, fill=(0, (0, 0, 0), (255, 0, 255))):
    data = [[fill for _ in range(w)] for _ in range(h)]
    return xp_core.XPLayer(w, h, data)


def test_slice_frame_geometry_and_clamp():
    layer = _layer(66, 104)
    s = v.slice_frame(layer, [11, 13], angle=0, frame=0)
    assert s["cols"] == 6 and s["rows"] == 8 and s["fw"] == 11 and s["fh"] == 13
    assert len(s["grid"]) == 13 and len(s["grid"][0]) == 11
    # out-of-range angle/frame clamp instead of crashing
    s2 = v.slice_frame(layer, [11, 13], angle=99, frame=99)
    assert len(s2["grid"]) == 13


def test_render_blanks_magenta_key_and_zero_glyph():
    grid = [[(0, (1, 1, 1), (2, 2, 2)), (65, (255, 255, 255), (255, 0, 255)),
             (66, (10, 20, 30), (40, 50, 60))]]
    lines = v.render_cells_ansi(grid)
    assert lines[0].startswith("  ")           # zero glyph + magenta-key cell both blank
    assert "B" in lines[0] and "38;2;10;20;30" in lines[0]  # opaque cell rendered truecolor


def test_handle_key_transitions():
    st = v.ViewerState("bigbee-0000", ["bigbee-0000-L2", "bigbee-0000-L3"])
    data = v.ContractData(SM)
    assert v.handle_key(st, "]", data) is True and st.layer_idx == 1
    assert v.handle_key(st, "[", data) is True and st.layer_idx == 0
    v.handle_key(st, ".", data); assert st.angle == 1
    v.handle_key(st, "n", data); assert st.frame == 1
    assert st.autoplay is True
    v.handle_key(st, " ", data); assert st.autoplay is False
    v.handle_key(st, "x", data); assert st.autoplay_axis == "angle"
    v.handle_key(st, "f", data); assert st.role_focus == "bee_body"  # L2 role
    assert v.handle_key(st, "q", data) is False


def test_advance_autoplay_wraps_within_bounds():
    data = v.ContractData(SM)
    xp = v.load_xp_for_stem("bigbee-0000", SPRITES)
    st = v.ViewerState("bigbee-0000", data.layer_keys_for_stem("bigbee-0000"))
    st.frame = 5  # last frame (6 frames per angle)
    v._advance_autoplay(st, data, xp)
    assert st.frame == 0  # wrapped


# ---- integration over the committed artifacts ----
def test_contract_data_joins_the_bee_body_trap():
    data = v.ContractData(SM)
    info = data.join("bigbee-0000-L2")
    assert info["machine_guess"] == "armor;mount_body_wolf"
    assert info["proposed_roles"] == ["bee_body"]
    assert info["topology_class"] == "owned"
    assert len(info["exact_matches"]) >= 20            # all bigbee L2 byte-identical
    assert any("bee" in c.lower() for c in info["contradictions"])


def test_compose_screen_makes_the_trap_visible():
    data = v.ContractData(SM)
    xp = v.load_xp_for_stem("bigbee-0000", SPRITES)
    st = v.ViewerState("bigbee-0000", data.layer_keys_for_stem("bigbee-0000"))
    screen = v.compose_screen(st, data, xp)
    assert "READ-ONLY" in screen
    assert "armor;mount_body_wolf" in screen           # the wrong machine guess
    assert "bee_body" in screen                        # the human-corrected role
    assert "contradicted by hand" in screen            # the trap, spelled out
    assert "ROLE GRID" in screen


def test_layer_keys_for_stem_sorted_and_scoped():
    data = v.ContractData(SM)
    keys = data.layer_keys_for_stem("bigbee-0000")
    assert keys == ["bigbee-0000-L2", "bigbee-0000-L3"]
    # stem scoping must not bleed into bigbee-0001
    assert all(k.startswith("bigbee-0000-L") for k in keys)


def test_missing_inputs_fail_closed(tmp_path):
    with pytest.raises(v.ContractDataError):
        v.ContractData(tmp_path)


def test_viewer_module_writes_nothing_to_disk():
    """Read-only guarantee: no file-write primitives in the module source."""
    src = (PIPELINE_V3 / "scripts" / "source_layer_contract_viewer.py").read_text()
    for forbidden in ("open(", "json.dump", "mkstemp", "os.replace", "Path.write_text", ".write_text("):
        assert forbidden not in src, f"viewer must not write: found {forbidden!r}"


# --- FL-4162 microscope: engine refs, neighbors, hand_note, match ids in one panel ---
def _screen_for(stem, layer_index=0):
    data = v.ContractData(SM)
    xp = v.load_xp_for_stem(stem, SPRITES)
    st = v.ViewerState(stem, data.layer_keys_for_stem(stem))
    st.layer_idx = layer_index
    return v.compose_screen(st, data, xp)


def test_engine_refs_anchor_each_wolack_layer():
    """The microscope shows the upstream sprite.cpp role for each raw layer:
    L2 base accumulator, L3 merge overlay, L4 final cyan-fg swoosh special-case."""
    keys = ["wolack-0001-L2", "wolack-0001-L3", "wolack-0001-L4"]
    screens = [_screen_for("wolack-0001", i) for i in range(len(keys))]
    assert "L2 primary visual / base accumulator" in screens[0] and "engine/sprite.cpp:620" in screens[0]
    assert "overlay L3" in screens[1] and "engine/sprite.cpp:1029-1044" in screens[1]
    assert "swoosh composition" in screens[2] and "engine/sprite.cpp:1034-1185" in screens[2]


def test_engine_ref_helper_classifies_layers():
    """_engine_ref / _layer_is_cyan_swoosh are pure and classify by index + cyan-fg."""
    xp = v.load_xp_for_stem("wolack-0001", SPRITES)
    n = len(xp.layers)
    assert "L2 primary visual / base accumulator" in v._engine_ref(2, n, xp.layers[2])
    assert "swoosh composition" in v._engine_ref(n - 1, n, xp.layers[n - 1])
    assert v._layer_is_cyan_swoosh(xp.layers[n - 1])      # final layer is the swoosh
    assert not v._layer_is_cyan_swoosh(xp.layers[2])      # the body base is not


def test_microscope_shows_neighbors_and_matches():
    """One panel surfaces neighboring-layer roles and glyph match peers so a contract
    hypothesis is checked against raw evidence (the wolack-0001-L3 false-clean: it
    byte-matches its sibling composites)."""
    screen = _screen_for("wolack-0001", 1)   # wolack-0001-L3
    assert "neighbors:" in screen
    assert "L2=mount_body_wolf" in screen and "L4=weapon_swoosh" in screen
    assert "engine:" in screen
    # the false-clean evidence: near-match peers point at the sibling L3 composites
    assert "near-match peers" in screen and "wolack-0011-L3" in screen
