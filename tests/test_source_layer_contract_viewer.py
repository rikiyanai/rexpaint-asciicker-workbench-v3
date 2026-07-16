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
_SHARED_CONTRACT_DATA = None


def _data():
    global _SHARED_CONTRACT_DATA
    if _SHARED_CONTRACT_DATA is None:
        _SHARED_CONTRACT_DATA = v.ContractData(SM)
    return _SHARED_CONTRACT_DATA


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


def test_cell_classifier_taxonomy():
    """Every cell in a frame dump is typed according to the upstream sprite.cpp contract."""
    assert v.classify_cell(0, (0, 0, 0), (255, 0, 255), 2, 4) == "transparent"
    assert v.classify_cell(65, (0, 0, 0), (255, 0, 255), 2, 4) == "transparent"
    assert v.classify_cell(65, (1, 2, 3), (4, 5, 6), 0, 4) == "color_key"
    assert v.classify_cell(0, (0, 0, 0), (255, 0, 255), 0, 4) == "color_key"
    assert v.classify_cell(ord("5"), (1, 2, 3), (4, 5, 6), 1, 4) == "height_digit"
    assert v.classify_cell(0, (0, 0, 0), (255, 0, 255), 1, 4) == "height_digit"
    assert v.classify_cell(118, (170, 0, 170), (255, 255, 85), 2, 4) == "body_pixel"
    assert v.classify_cell(220, (0, 255, 255), (255, 85, 85), 3, 4) == "swoosh_pixel"
    assert v.classify_cell(220, (170, 0, 170), (255, 85, 85), 3, 5) == "overlay_pixel"


def test_microscope_card_has_coordinate_index_and_histogram():
    """Generated microscope cards expose coordinate-level cell type and aggregate stats."""
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/bigbee-L3_limbless_rider_torso.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    microscope = v.MicroscopeGroup(packet_path)
    for key, card in microscope.cards.items():
        idx = card.get("coordinate_index", {})
        assert idx, f"{key}: missing coordinate_index"
        assert len(idx) == card["frame_dump"]["fw"] * card["frame_dump"]["fh"], f"{key}: coordinate_index size mismatch"
        hist = card.get("cell_type_histogram", {})
        assert set(hist.keys()) == {"transparent", "color_key", "height_digit", "body_pixel", "overlay_pixel", "swoosh_pixel"}
        assert hist["body_pixel"] > 0 or hist["overlay_pixel"] > 0 or hist["swoosh_pixel"] > 0


def test_cell_comparison_report_is_read_only_and_authority_false():
    """The cell-coordinate comparison artifact is authority:false and JSON-serializable."""
    import json, subprocess, sys
    script = Path(__file__).resolve().parents[2] / "scripts" / "adhoc" / "2026-07-14-FL-4162-cell-coordinate-comparison-report.py"
    if not script.exists():
        pytest.skip("comparison report script not present")
    result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    out_dir = script.parents[2] / "docs/research/ascii/verification/fl4162/2026-07-14-source-contract-discovery-reframing/cell_comparisons"
    report = json.loads((out_dir / "bigbee-L3_limbless_rider_torso_cell_comparison.json").read_text())
    assert report.get("authority") is False
    assert report.get("schema") == "fl4162.cell_comparison_report.v1"
    assert len(report.get("pair_comparisons", [])) > 0


def test_handle_key_transitions():
    st = v.ViewerState("bigbee-0000", ["bigbee-0000-L2", "bigbee-0000-L3"])
    data = _data()
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
    data = _data()
    xp = v.load_xp_for_stem("bigbee-0000", SPRITES)
    st = v.ViewerState("bigbee-0000", data.layer_keys_for_stem("bigbee-0000"))
    st.frame = 5  # last frame (6 frames per angle)
    v._advance_autoplay(st, data)
    assert st.frame == 0  # wrapped


# ---- integration over the committed artifacts ----
def test_contract_data_joins_the_bee_body_trap():
    data = _data()
    info = data.join("bigbee-0000-L2")
    assert info["machine_guess"] == "armor;mount_body_wolf"
    assert info["proposed_roles"] == ["bee_body"]
    assert info["topology_class"] == "owned"
    assert len(info["exact_matches"]) >= 20            # all bigbee L2 byte-identical
    assert any("bee" in c.lower() for c in info["contradictions"])


def test_compose_screen_makes_the_trap_visible():
    data = _data()
    xp = v.load_xp_for_stem("bigbee-0000", SPRITES)
    st = v.ViewerState("bigbee-0000", data.layer_keys_for_stem("bigbee-0000"))
    screen = v.compose_screen(st, data)
    assert "READ-ONLY" in screen
    assert "armor;mount_body_wolf" in screen           # the wrong machine guess
    assert "bee_body" in screen                        # the human-corrected role
    assert "contradicted by hand" in screen            # the trap, spelled out
    assert "ROLE GRID" in screen


def test_layer_keys_for_stem_sorted_and_scoped():
    data = _data()
    keys = data.layer_keys_for_stem("bigbee-0000")
    assert keys == ["bigbee-0000-L2", "bigbee-0000-L3"]
    # stem scoping must not bleed into bigbee-0001
    assert all(k.startswith("bigbee-0000-L") for k in keys)


def test_missing_inputs_fail_closed(tmp_path):
    with pytest.raises(v.ContractDataError):
        v.ContractData(tmp_path)


def test_viewer_module_writes_nothing_to_disk():
    """Read-only guarantee: no file-write primitives in the module source."""
    import ast

    src = (PIPELINE_V3 / "scripts" / "source_layer_contract_viewer.py").read_text()
    for forbidden in ("json.dump", "mkstemp", "os.replace", "Path.write_text", ".write_text("):
        assert forbidden not in src, f"viewer must not write: found {forbidden!r}"
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Call):
            continue
        is_builtin_open = isinstance(node.func, ast.Name) and node.func.id == "open"
        is_path_open = isinstance(node.func, ast.Attribute) and node.func.attr == "open"
        if not (is_builtin_open or is_path_open):
            continue
        mode_node = None
        positional_index = 1 if is_builtin_open else 0
        if len(node.args) > positional_index:
            mode_node = node.args[positional_index]
        for keyword in node.keywords:
            if keyword.arg == "mode":
                mode_node = keyword.value
        mode = mode_node.value if isinstance(mode_node, ast.Constant) else "r"
        assert isinstance(mode, str) and not any(flag in mode for flag in "wax+")


# --- FL-4162 microscope: engine refs, neighbors, hand_note, match ids in one panel ---
def _screen_for(stem, layer_index=0):
    data = _data()
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
    """A microscope packet spanning multiple stems must load each stem's own XP.
    We prove this by checking distinctive layer dimensions and rendered fingerprints
    across at least two stems."""
    import hashlib
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/crossbow-bit-across-families.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    microscope = v.MicroscopeGroup(packet_path)
    keys = sorted(microscope.cards.keys(), key=lambda k: int(k.rsplit("-L", 1)[1]))
    stems = [k.rsplit("-L", 1)[0] for k in keys]
    distinct = set(stems)
    assert len(distinct) > 1, "cross-stem packet should span multiple stems"
    state = v.ViewerState(stems[0], keys, microscope=microscope, sprites=SPRITES)
    data = _data()
    # choose two stems with clearly different dimensions
    # Use the first two distinct stems present in the packet.
    distinct_stems = sorted(set(stems), key=lambda s: stems.index(s))
    chosen = [(s, stems.index(s)) for s in distinct_stems[:2]]
    assert len(chosen) >= 2, f"packet must have at least 2 distinct stems, got {distinct_stems}"

    def _fingerprint(key):
        info = data.join(key)
        layer_i = info["raw_layer_index"]
        fw, fh = info["frame_wh"]
        stem = key.rsplit("-L", 1)[0]
        xp = state.xp_for_key(key, data)
        layer = xp.layers[layer_i]
        sliced = v.slice_frame(layer, [fw, fh], 0, 0)
        cells = [(g, tuple(fg), tuple(bg)) for row in sliced["grid"] for g, fg, bg in row if tuple(bg) != (255, 0, 255)]
        return hashlib.sha256(str(cells).encode()).hexdigest()[:16], len(xp.layers), (layer.width, layer.height)

    fingerprints = {}
    dimensions = {}
    for stem, idx in chosen:
        state.layer_idx = idx
        assert state.current_stem() == stem, "state stem mismatch"
        fp, n_layers, dim = _fingerprint(keys[idx])
        fingerprints[stem] = fp
        dimensions[stem] = (n_layers, dim)

    # dimensions must differ between families
    assert len(set(dimensions.values())) >= 2, f"all dimensions identical: {dimensions}"
    # every chosen stem must have a unique rendered fingerprint
    assert len(set(fingerprints.values())) == len(fingerprints), f"duplicate fingerprints across stems: {fingerprints}"


def test_group_neighbors_isolated_to_current_stem():
    """Neighboring-layer lookup must not mix layers from unrelated stems.
    The armor+shield packet has cards across many stems; every card has no
    within-packet peers, so neighbors must be 'none'."""
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/armor-with-shield-contamination.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    microscope = v.MicroscopeGroup(packet_path)
    keys = sorted(microscope.cards.keys(), key=lambda k: int(k.rsplit("-L", 1)[1]))
    stems = [k.rsplit("-L", 1)[0] for k in keys]
    state = v.ViewerState(stems[0], keys, microscope=microscope, sprites=SPRITES)
    data = _data()
    for i, k in enumerate(keys):
        state.layer_idx = i
        stem = state.current_stem()
        same_stem = [kk for kk in keys if kk.startswith(stem + "-")]
        screen = v.compose_screen(state, data)
        neighbor_section = screen.split("neighbors:", 1)[1].split("glyph exact-match", 1)[0]
        info = data.join(k)
        raw_idx = info["raw_layer_index"]
        if len(same_stem) == 1:
            # For an isolated stem the only possible neighbor is a metadata layer
            # (L0/L1); any other stem reference is a cross-stem leak.
            for token in neighbor_section.split():
                if token.startswith("L") and len(token) > 1 and token[1].isdigit():
                    continue
                if any(token.startswith(p) for p in ("bigbee-", "player-", "wolfie-", "plydie-", "attack-", "wolack-")):
                    assert token.startswith(stem + "-"), f"{k}: neighbor {token} bleeds from another stem"
        else:
            for token in neighbor_section.split():
                if token.startswith("L") and len(token) > 1 and token[1].isdigit():
                    continue
                if any(token.startswith(p) for p in ("bigbee-", "player-", "wolfie-", "plydie-", "attack-", "wolack-")):
                    assert token.startswith(stem + "-"), f"{k}: neighbor {token} bleeds from another stem"

def test_microscope_group_rejects_authority_true():
    """A packet claiming authority:true must fail closed."""
    import json
    bad = {"schema": "fl4162.microscope_packet.v1", "authority": True, "group_name": "bad", "engine_refs": {}, "cards": []}
    tmp = Path("/tmp/bad_microscope_packet.json")
    tmp.write_text(json.dumps(bad))
    with pytest.raises(v.ContractDataError):
        v.MicroscopeGroup(tmp)


def test_empty_microscope_packet_fails_closed():
    """An empty group must not crash in main(); it must fail closed with exit code 2."""
    import json, subprocess, sys
    empty = {"schema": "fl4162.microscope_packet.v1", "authority": False, "group_name": "empty", "engine_refs": {}, "cards": []}
    tmp = Path("/tmp/empty_microscope_packet.json")
    tmp.write_text(json.dumps(empty))
    m = v.MicroscopeGroup(tmp)
    assert m.cards == {}
    # main() must reject the empty packet before indexing layer_keys[0]
    rc = v.main(["--group", str(tmp), "--once"])
    assert rc == 2, f"empty packet must fail closed, got rc={rc}"


def test_source_key_selects_exact_raw_layer(capsys):
    rc = v.main(["--source-key", "attack-1001-L3", "--once"])
    assert rc == 0
    screen = capsys.readouterr().out
    assert "-- attack-1001-L3  (raw layer L3" in screen


def test_source_key_outside_group_fails_closed(capsys):
    packet_path = SM.parent / "verification/fl4162/2026-07-14-source-contract-discovery-reframing/microscope_packets/bigbee-L3_limbless_rider_torso.json"
    if not packet_path.exists():
        pytest.skip("microscope packet not present")
    rc = v.main([
        "--group", str(packet_path), "--source-key", "attack-1001-L3", "--once",
    ])
    assert rc == 2
    assert "source key not present in viewer scope" in capsys.readouterr().err


def test_full_cell_panel_shows_recorded_single_and_composite_assignments(capsys):
    rc = v.main(["--source-key", "player-0000-L2", "--once"])
    assert rc == 0
    decided = capsys.readouterr().out
    assert "-- FULL-CELL CONTRACT (authority:false, read-only) --" in decided
    assert "decision=recorded" in decided
    assert "unresolved=0" in decided
    assert "A=player_body" in decided

    rc = v.main(["--source-key", "bigbee-0012-L5", "--once"])
    assert rc == 0
    composite = capsys.readouterr().out
    assert "state=needs_cell_role_segmentation" in composite
    assert "decision=recorded" in composite
    assert "unresolved=0" in composite
    assert "A=shield" in composite
    assert "unresolved_coordinates:" not in composite


def test_assignment_preview_uses_coordinate_recorder_without_writing(tmp_path):
    import json

    data = _data()
    source_key = "bigbee-1012-L6"
    unit = data.review_units_by_key[source_key]
    visible = [
        coordinate for coordinate, value in data.expanded_cells(source_key).items()
        if value.get("cell_type") != "transparent"
    ]
    assignment = {
        "schema": "fl4162.upstream_xp_coordinate_assignment_input.v1",
        "source_key": source_key,
        "source_layer_sha256": unit["source_layer_sha256"],
        "semantic_spans": [
            [angle, frame, y, x, 1, ["crossbow", "shield"]]
            for angle, frame, y, x in visible
        ],
    }
    assignment_path = tmp_path / "assignment.json"
    assignment_path.write_text(json.dumps(assignment), encoding="utf-8")
    decisions_path = SM / "upstream_xp_cell_contract/cell_role_decisions.jsonl"
    before = decisions_path.read_bytes()

    try:
        assert data.load_assignment_preview(assignment_path) == source_key
        stem = source_key.rsplit("-L", 1)[0]
        state = v.ViewerState(stem, data.layer_keys_for_stem(stem), sprites=SPRITES)
        state.layer_idx = state.layer_keys.index(source_key)
        screen = v.compose_screen(state, data)
        assert "-- ASSIGNMENT PREVIEW (authority:false, read-only) --" in screen
        assert "decision=preview" in screen
        assert "unresolved=0" in screen
        assert "A=crossbow;shield" in screen
        assert decisions_path.read_bytes() == before
    finally:
        data.assignment_preview_key = None
        data.assignment_preview_decision = None


def test_assignment_preview_rejects_partial_visible_coverage(tmp_path):
    import json

    data = _data()
    source_key = "bigbee-1012-L6"
    unit = data.review_units_by_key[source_key]
    assignment_path = tmp_path / "partial.json"
    assignment_path.write_text(json.dumps({
        "schema": "fl4162.upstream_xp_coordinate_assignment_input.v1",
        "source_key": source_key,
        "source_layer_sha256": unit["source_layer_sha256"],
        "semantic_spans": [[0, 0, 0, 0, 1, ["crossbow"]]],
    }), encoding="utf-8")
    with pytest.raises(v.ContractDataError, match="coordinate semantic coverage mismatch"):
        data.load_assignment_preview(assignment_path)


def test_base_alias_uses_ledger_source_xp_path(capsys):
    rc = v.main(["--source-key", "player-nude-base-L2", "--once"])
    assert rc == 0
    screen = capsys.readouterr().out
    assert "source_xp: assets/sprites/player-nude.xp" in screen
    assert "-- player-nude-base-L2  (raw layer L2" in screen
