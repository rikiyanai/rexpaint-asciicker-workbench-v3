"""FL-4162/FL-4306 step 7: read-only evidence sidebar in the UV Body Viewer.

Locks the loader (family filter + rejects-first order, missing-file safety),
the render panel content, and the toggle/nav keybinds. The sidebar is READ-ONLY
— these tests assert no card/anchor mutation.
"""
import json
import sys
from pathlib import Path

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import xp_uv_body_viewer as v  # noqa: E402


def _card(card_id, family, rank, qc="reject", **over):
    c = {
        "card_id": card_id, "family": family, "raw_layer_index": 2,
        "source_xp_resolution": "direct",
        "hand": {"status": "reject", "corrected_label": "NO. BEE ONLY", "note": "NO. BEE ONLY",
                 "pre_source": "GLYPH_SIGNATURE", "pre_guess": "armor;mount_body_wolf",
                 "auto_propagated_from": None, "auto_propagation_kind": None},
        "engine": {"fixed_role": "L2 base accumulator", "is_overlay": False, "overlay_ordinal": None,
                   "swoosh_cyan_fg_detected": False, "family_layer_count": 4,
                   "frame_topology": {"angles": 8, "anims": [1, 2], "frames_per_angle": 6}},
        "glyph_similarity": {"exact_matches": ["a", "b"], "near_matches": []},
        "review": {"review_rank": rank, "queue_class_name": qc, "rationale": "MOUNT family — review FIRST."},
        "cells": {"glyph_count": 39, "visible_glyph_set": [47, 60]},
    }
    c.update(over)
    return c


def _write_jsonl(path, cards):
    path.write_text("\n".join(json.dumps(c) for c in cards) + "\n", encoding="utf-8")


def _state(tmp_path, cards=None):
    return v.AnchorReviewState(
        anchor_data={}, anchor_path=tmp_path / "bigbee-0100.json",
        frame_w=10, frame_h=13, evidence_cards=cards or [],
    )


def test_loader_filters_family_and_orders_rejects_first(tmp_path):
    _write_jsonl(tmp_path / "layer_evidence_cards.jsonl", [
        _card("bigbee-0001-L2", "bigbee", rank=3),
        _card("bigbee-0000-L2", "bigbee", rank=1, qc="wrong_guess_reject"),
        _card("player-0000-L2", "player", rank=1),  # different family -> excluded
    ])
    cards = v._load_evidence_cards_for_family(tmp_path / "bigbee-0100.json", "bigbee-0100")
    assert [c["card_id"] for c in cards] == ["bigbee-0000-L2", "bigbee-0001-L2"]  # rank 1 then 3
    assert all(c["family"] == "bigbee" for c in cards)


def test_loader_missing_file_returns_empty(tmp_path):
    assert v._load_evidence_cards_for_family(tmp_path / "bigbee-0100.json", "bigbee-0100") == []


def test_panel_renders_card_facts(tmp_path):
    st = _state(tmp_path, [_card("bigbee-0000-L2", "bigbee", rank=1, qc="wrong_guess_reject")])
    text = "\n".join(v._anchor_render_evidence_panel(st))
    assert "bigbee-0000-L2" in text
    assert "wrong_guess_reject" in text and "rank #1" in text
    assert "NO. BEE ONLY" in text and "armor;mount_body_wolf" in text
    assert "L2 base accumulator" in text and "anims=[1, 2]" in text
    assert "exact=2" in text  # glyph_similarity exact_matches length
    assert "review FIRST" in text


def test_toggle_key_i_enables_sidebar(tmp_path):
    st = _state(tmp_path, [_card("bigbee-0000-L2", "bigbee", rank=1)])
    assert st.show_evidence is False
    assert v._handle_anchor_key(st, "i", []) is True
    assert st.show_evidence is True
    v._handle_anchor_key(st, "i", [])
    assert st.show_evidence is False


def test_toggle_key_i_noop_without_cards(tmp_path):
    st = _state(tmp_path, [])
    v._handle_anchor_key(st, "i", [])
    assert st.show_evidence is False  # nothing to show


def test_nav_keys_cycle_card_index_readonly(tmp_path):
    cards = [_card("bigbee-0000-L2", "bigbee", 1), _card("bigbee-0001-L2", "bigbee", 2),
             _card("bigbee-0002-L2", "bigbee", 3)]
    snapshot = json.dumps(cards, sort_keys=True)
    st = _state(tmp_path, cards)
    st.show_evidence = True
    v._handle_anchor_key(st, "]", [])
    assert st.evidence_idx == 1
    v._handle_anchor_key(st, "]", [])
    assert st.evidence_idx == 2
    v._handle_anchor_key(st, "]", [])
    assert st.evidence_idx == 0  # wraps
    v._handle_anchor_key(st, "[", [])
    assert st.evidence_idx == 2  # wraps back
    # read-only: navigation never mutated the cards
    assert json.dumps(st.evidence_cards, sort_keys=True) == snapshot


def test_evidence_branch_wins_over_body_map(tmp_path):
    """FL-4306: evidence has display priority when toggled on — an auto-loaded
    body map (show_body_map True) must NOT mask it. Locks the branch order in
    _anchor_compose_screen so the microscope works for body-map sprites too."""
    st = _state(tmp_path, [_card("bigbee-0000-L2", "bigbee", 1, qc="wrong_guess_reject")])
    st.anchor_data = {"frames": {}}
    st.show_evidence = True
    st.show_body_map = True
    st.body_map_xp = object()  # truthy; the body-map branch must NOT be reached
    cell_data = [[(0, (0, 0, 0), (0, 0, 0)) for _ in range(st.frame_w)] for _ in range(st.frame_h)]
    screen = v._anchor_compose_screen(st, cell_data, asset=None, layer_index=2)
    assert "EVIDENCE" in screen
    assert "NO. BEE ONLY" in screen
