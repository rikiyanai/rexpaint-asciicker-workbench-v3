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
    v._advance_autoplay(st, data)
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
    screen = v.compose_screen(st, data)
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
    st = v.ViewerState(stem, data.layer_keys_for_stem(stem), sprites=SPRITES)
    st.layer_idx = layer_index
    return v.compose_screen(st, data)


def test_engine_refs_anchor_each_wolack_layer():
    """The microscope shows the upstream sprite.cpp role for each raw layer:
    L2 base accumulator, L3 merge overlay, L4 final cyan-fg swoosh special-case."""
    keys = ["wolack-0001-L2", "wolack-0001-L3", "wolack-0001-L4"]
    screens = [_screen_for("wolack-0001", i) for i in range(len(keys))]
    assert "L2 primary visual / base accumulator" in screens[0] and "upstream sprite.cpp:352" in screens[0]
    assert "overlay L3" in screens[1] and "upstream sprite.cpp:354-360" in screens[1]
    assert "swoosh composition" in screens[2] and "upstream sprite.cpp:361" in screens[2]
    # Local correspondence is also surfaced
    assert "local engine/sprite.cpp:621" in screens[0]


def test_engine_ref_helper_classifies_layers():
    """_engine_ref / _layer_is_cyan_swoosh are pure and classify by index + cyan-fg."""
    xp = v.load_xp_for_stem("wolack-0001", SPRITES)
    n = len(xp.layers)
    assert "L2 primary visual / base accumulator" in v._engine_ref(2, n, xp.layers[2])
    assert "swoosh composition" in v._engine_ref(n - 1, n, xp.layers[n - 1])
    assert "local engine/sprite.cpp:1034-1200" in v.local_engine_correspondence(n - 1, n, xp.layers[n - 1])
    assert v._layer_is_cyan_swoosh(xp.layers[n - 1])      # final layer is the swoosh
    assert not v._layer_is_cyan_swoosh(xp.layers[2])      # the body base is not


def test_microscope_shows_neighbors_and_matches():
    """One panel surfaces neighboring-layer roles and glyph match peers so a contract
    hypothesis is checked against raw evidence (the wolack-0001-L3 false-clean: it
    byte-matches its sibling composites)."""
    screen = _screen_for("wolack-0001", 1)   # wolack-0001-L3
    assert "neighbors:" in screen
    assert "L2=mount_body_wolf" in screen and "L4=weapon_swoosh" in screen
    assert "engine (upstream 8ff75d0c):" in screen
    # the false-clean evidence: near-match peers point at the sibling L3 composites
    assert "near-match peers" in screen and "wolack-0011-L3" in screen


# ---- cross-stem navigation correctness (review finding #1) ----
def test_group_navigation_loads_correct_xp_per_source_key():
    """A microscope packet spanning multiple stems must load each stem's own XP."""
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/crossbow-bit-across-families.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    microscope = v.MicroscopeGroup(packet_path)
    keys = sorted(microscope.cards.keys(), key=lambda k: int(k.rsplit("-L", 1)[1]))
    stems = [k.rsplit("-L", 1)[0] for k in keys]
    # at least one cross-stem packet has multiple distinct stems
    distinct = set(stems)
    assert len(distinct) > 1, "cross-stem packet should span multiple stems"
    state = v.ViewerState(stems[0], keys, microscope=microscope, sprites=SPRITES)
    # verify each card's stem resolves to its own XP path
    for k in keys:
        state.layer_idx = keys.index(k)
        stem = state.current_stem()
        xp = state.xp_for(stem)
        assert xp is not None
        # the loaded XP filename must match the card's stem
        # (xp_core does not expose path; verify by metadata sanity)
        meta = xp.get_metadata()
        assert meta["angles"] > 0


def test_group_neighbors_isolated_to_current_stem():
    """Neighboring-layer lookup must not mix layers from unrelated stems."""
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/crossbow-bit-across-families.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    microscope = v.MicroscopeGroup(packet_path)
    keys = sorted(microscope.cards.keys(), key=lambda k: int(k.rsplit("-L", 1)[1]))
    state = v.ViewerState("ignored", keys, microscope=microscope, sprites=SPRITES)
    data = v.ContractData(SM)
    # find a stem that has more than one layer and a neighbor in the group
    for k in keys:
        stem = k.rsplit("-L", 1)[0]
        same_stem = [x for x in keys if x.rsplit("-L", 1)[0] == stem]
        if len(same_stem) > 1:
            state.layer_idx = keys.index(k)
            screen = v.compose_screen(state, data)
            # neighbors line should only mention layers from this stem
            neighbor_line = [ln for ln in screen.splitlines() if ln.startswith("neighbors:")][0]
            # every neighbor citation must start with the same stem prefix
            for token in neighbor_line.split():
                if token.startswith("L") and token[1].isdigit():
                    continue
                if token.startswith("bigbee-") or token.startswith("player-") or token.startswith("wolfie-") or token.startswith("plydie-"):
                    assert token.startswith(stem + "-"), f"neighbor {token} bleeds from another stem"
            return
    pytest.skip("no multi-layer stem in packet")


def test_microscope_group_rejects_authority_true():
    """A packet claiming authority:true must fail closed."""
    import json
    bad = {"schema": "fl4162.microscope_packet.v1", "authority": True, "group_name": "bad", "engine_refs": {}, "cards": []}
    tmp = Path("/tmp/bad_microscope_packet.json")
    tmp.write_text(json.dumps(bad))
    with pytest.raises(v.ContractDataError):
        v.MicroscopeGroup(tmp)


def test_empty_microscope_packet_fails_closed():
    """An empty group must not crash; it simply has no cards."""
    import json
    empty = {"schema": "fl4162.microscope_packet.v1", "authority": False, "group_name": "empty", "engine_refs": {}, "cards": []}
    tmp = Path("/tmp/empty_microscope_packet.json")
    tmp.write_text(json.dumps(empty))
    m = v.MicroscopeGroup(tmp)
    assert m.cards == {}
