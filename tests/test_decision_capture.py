"""FL-4162 step 8 — reviewed-decision write path.

Locks the four contract guarantees the decision capture must hold:
  1. the write is ATOMIC (a mid-write failure never corrupts the file);
  2. an existing decision RELOADS beside its card (load + viewer panel);
  3. NO write happens from passive navigation (sidebar stays a microscope);
  4. a source-card fingerprint MISMATCH blocks the write (fail closed, Law 6).

Plus the end-to-end viewer keybind path (open [t] -> type role -> note -> save)
and upsert-by-source_key, so the proposal-only file stays single-current-per-row.
"""
import json
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import decision_capture as dc  # noqa: E402
import xp_uv_body_viewer as v  # noqa: E402

PROV = {"tool": "test", "recorded_at": "2026-06-17T00:00:00", "anchor": "bigbee-0100.json"}


def _card(card_id="bigbee-0000-L2", source_key="bigbee-0000-L2", role_label="NO. BEE ONLY", **over):
    c = {
        "card_id": card_id,
        "source_key": source_key,
        "source_xp_path": "assets/sprites/bigbee-0000.xp",
        "source_xp_resolution": "direct",
        "source_final_sha256": "ecc9a16112ce48beaeb0e24beba2ccc7399c4efc50d32505f3fd54f8e8d76020",
        "family": "bigbee",
        "raw_layer_index": 2,
        "ahsw": [0, 0, 0, 0],
        "hand": {"status": "reject", "corrected_label": role_label, "note": role_label,
                 "pre_source": "GLYPH_SIGNATURE", "pre_guess": "armor;mount_body_wolf",
                 "auto_propagated_from": None, "auto_propagation_kind": None},
        "engine": {"fixed_role": "L2 base accumulator", "is_overlay": False, "overlay_ordinal": None,
                   "swoosh_cyan_fg_detected": False, "family_layer_count": 4,
                   "frame_topology": {"angles": 8, "anims": [1, 2], "frames_per_angle": 6}},
        "glyph_similarity": {"exact_matches": ["a", "b"], "near_matches": []},
        "cells": {"glyph_count": 39, "visible_glyph_set": [47, 60]},
        "review": {"review_rank": 1, "queue_class_name": "wrong_guess_reject", "rationale": "MOUNT — first."},
    }
    c.update(over)
    return c


def _state(tmp_path, cards, decisions=None):
    st = v.AnchorReviewState(
        anchor_data={"frames": {}}, anchor_path=tmp_path / "bigbee-0100.json",
        frame_w=4, frame_h=4, evidence_cards=cards,
    )
    st.decisions_path = tmp_path / dc.DECISIONS_FILENAME
    st.decisions = decisions if decisions is not None else {}
    return st


# --- 1. atomic write ---------------------------------------------------------

def test_write_is_atomic_failure_preserves_original(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    # Seed an existing good decision.
    dc.record_decision(path, _card(), approved_role="bee_body", provenance=PROV)
    before = path.read_text(encoding="utf-8")

    # A non-serializable provenance value forces json to raise *during* the write.
    bad_prov = {"tool": "test", "recorded_at": "x", "junk": {1, 2, 3}}  # set -> TypeError
    with pytest.raises(TypeError):
        dc.record_decision(path, _card(source_key="bigbee-0001-L2"),
                           approved_role="rider", provenance=bad_prov)

    # Original file is byte-for-byte intact, and no temp file was left behind.
    assert path.read_text(encoding="utf-8") == before
    leftover = list(tmp_path.glob(f"{path.stem}*.tmp"))
    assert leftover == [], f"atomic write leaked temp files: {leftover}"


# --- 2. existing decision reloads beside its card ----------------------------

def test_existing_decision_reloads_via_loader(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    dc.record_decision(path, _card(), approved_role="bee_body", reviewer_note="hand label confirmed",
                       provenance=PROV)
    loaded = dc.load_decisions(path)
    assert set(loaded) == {"bigbee-0000-L2"}
    assert loaded["bigbee-0000-L2"]["approved_role"] == "bee_body"
    assert dc.latest_decision_for(path, "bigbee-0000-L2")["reviewer_note"] == "hand label confirmed"


def test_existing_decision_shows_in_viewer_panel(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    dc.record_decision(path, _card(), approved_role="bee_body", reviewer_note="confirmed",
                       provenance=PROV)
    st = _state(tmp_path, [_card()], decisions=dc.load_decisions(path))
    text = "\n".join(v._anchor_render_evidence_panel(st))
    assert "DECISION = bee_body" in text
    assert "confirmed" in text


def test_card_without_decision_shows_none(tmp_path):
    st = _state(tmp_path, [_card()])  # empty decisions
    text = "\n".join(v._anchor_render_evidence_panel(st))
    assert "DECISION = none recorded" in text


# --- 3. no write from passive navigation -------------------------------------

def test_no_write_from_passive_navigation(tmp_path):
    st = _state(tmp_path, [_card("bigbee-0000-L2", "bigbee-0000-L2"),
                           _card("bigbee-0001-L2", "bigbee-0001-L2")])
    st.show_evidence = True
    cell = [[(0, (0, 0, 0), (0, 0, 0)) for _ in range(4)] for _ in range(4)]
    # Toggle, browse, move cursor, change angle — none may create the file.
    for k in ("i", "]", "[", "]", "UP", "DOWN", "a", "d", "i"):
        v._handle_anchor_key(st, k, cell)
    assert not st.decisions_path.exists(), "passive navigation wrote a decisions file"
    assert st.decisions == {}

    # Even opening the [t] prompt (without completing it) writes nothing.
    st.show_evidence = True
    v._handle_anchor_key(st, "t", cell)
    assert st.prompt_mode == "decision_role"
    assert not st.decisions_path.exists(), "opening the [t] prompt wrote before ENTER"


def test_t_keybind_inert_outside_evidence_mode(tmp_path):
    st = _state(tmp_path, [_card()])
    st.show_evidence = False
    cell = [[(0, (0, 0, 0), (0, 0, 0))]]
    v._handle_anchor_key(st, "t", cell)
    assert st.prompt_mode == ""  # did not open a capture prompt
    assert not st.decisions_path.exists()


# --- 4. fingerprint mismatch blocks the write --------------------------------

def test_fingerprint_mismatch_blocks_write(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    card = _card()
    with pytest.raises(dc.DecisionFingerprintMismatch):
        dc.record_decision(path, card, approved_role="bee_body", provenance=PROV,
                           expected_fingerprint="deadbeef" * 8)
    assert not path.exists(), "blocked write still created the file"


def test_fingerprint_matches_allows_write(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    card = _card()
    fp = dc.card_fingerprint(card)
    rec = dc.record_decision(path, card, approved_role="bee_body", provenance=PROV,
                             expected_fingerprint=fp)
    assert rec["source_card_fingerprint"] == fp
    assert path.exists()


def test_commit_blocked_when_card_changed_under_review(tmp_path):
    """The viewer pins the fingerprint at [t]-open; if the card mutates before the
    note is confirmed, _commit_decision must fail closed and write nothing."""
    card = _card()
    st = _state(tmp_path, [card])
    st.decision_card_fp = "deadbeef" * 8  # as if the card changed after [t]
    msg = v._commit_decision(st, "bee_body", "note")
    assert "BLOCKED" in msg
    assert not st.decisions_path.exists()
    assert st.decision_card_fp is None  # reset even on the blocked path


# --- end-to-end viewer keybind path + record shape ---------------------------

def test_end_to_end_keybind_writes_decision(tmp_path):
    card = _card(role_label="")  # empty prefill so we type a clean role
    st = _state(tmp_path, [card])
    st.show_evidence = True
    st.evidence_idx = 0
    cell = [[(0, (0, 0, 0), (0, 0, 0))]]

    v._handle_anchor_key(st, "t", cell)               # open role prompt
    assert st.prompt_mode == "decision_role"
    assert st.decision_card_fp == dc.card_fingerprint(card)
    for ch in "bee_body":                              # type the role
        v._handle_anchor_key(st, ch, cell)
    v._handle_anchor_key(st, "ENTER", cell)           # role -> note
    assert st.prompt_mode == "decision_note"
    for ch in "looks right":                           # type a note
        v._handle_anchor_key(st, ch, cell)
    v._handle_anchor_key(st, "ENTER", cell)           # save
    assert st.prompt_mode == ""

    loaded = dc.load_decisions(st.decisions_path)
    rec = loaded["bigbee-0000-L2"]
    assert rec["approved_role"] == "bee_body"
    assert rec["reviewer_note"] == "looks right"
    assert rec["authority"] is False and rec["is_proposal"] is True
    assert rec["composite_roles"] == ["bee_body"]
    assert st.decisions["bigbee-0000-L2"]["approved_role"] == "bee_body"  # reloaded in-memory


def test_escape_during_capture_aborts_without_write(tmp_path):
    card = _card(role_label="")
    st = _state(tmp_path, [card])
    st.show_evidence = True
    cell = [[(0, (0, 0, 0), (0, 0, 0))]]
    v._handle_anchor_key(st, "t", cell)
    for ch in "bee":
        v._handle_anchor_key(st, ch, cell)
    v._handle_anchor_key(st, "ESCAPE", cell)          # abort mid-role
    assert st.prompt_mode == ""
    assert not st.decisions_path.exists()


# --- record schema + upsert --------------------------------------------------

def test_record_is_proposal_only_and_splits_composite_roles():
    rec = dc.build_decision_record(_card(), approved_role="mount_body; rider_torso",
                                   provenance=PROV)
    assert rec["authority"] is False
    assert rec["is_proposal"] is True
    assert rec["schema"] == dc.SCHEMA
    assert rec["composite_roles"] == ["mount_body", "rider_torso"]


def test_empty_role_rejected():
    with pytest.raises(ValueError):
        dc.build_decision_record(_card(), approved_role="   ", provenance=PROV)


def test_upsert_keeps_one_current_record_per_source_key(tmp_path):
    path = tmp_path / dc.DECISIONS_FILENAME
    dc.record_decision(path, _card(), approved_role="first_guess", provenance=PROV)
    dc.record_decision(path, _card(), approved_role="revised", provenance=PROV)
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 1, "upsert left more than one row for the same source_key"
    assert json.loads(lines[0])["approved_role"] == "revised"


# --- fail-closed loading (FL-4162 reviewer Medium finding) -------------------

def test_missing_file_still_returns_empty(tmp_path):
    """A genuinely-absent file has nothing to lose -> {} (NOT an error)."""
    path = tmp_path / dc.DECISIONS_FILENAME
    assert not path.exists()
    assert dc.load_decisions(path) == {}


def test_malformed_jsonl_raises(tmp_path):
    """An EXISTING file with a malformed JSON line must fail closed, never skip."""
    path = tmp_path / dc.DECISIONS_FILENAME
    dc.record_decision(path, _card(), approved_role="bee_body", provenance=PROV)  # one good row
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("{ this is not valid json\n")
    with pytest.raises(dc.DecisionLoadError):
        dc.load_decisions(path)


def test_row_missing_source_key_raises(tmp_path):
    """A structurally-invalid row (valid JSON, no source_key) must fail closed."""
    path = tmp_path / dc.DECISIONS_FILENAME
    path.write_text(json.dumps({"approved_role": "bee_body"}) + "\n", encoding="utf-8")
    with pytest.raises(dc.DecisionLoadError):
        dc.load_decisions(path)


def test_unreadable_present_file_raises(tmp_path, monkeypatch):
    """A present-but-unreadable file must fail closed, not be read as empty.

    Monkeypatched so the result is deterministic regardless of test-runner uid
    (chmod 000 does not block root)."""
    path = tmp_path / dc.DECISIONS_FILENAME
    dc.record_decision(path, _card(), approved_role="bee_body", provenance=PROV)
    orig_read_text = Path.read_text

    def boom(self, *a, **k):
        if Path(self) == path:
            raise OSError("simulated unreadable file")
        return orig_read_text(self, *a, **k)

    monkeypatch.setattr(Path, "read_text", boom)
    with pytest.raises(dc.DecisionLoadError):
        dc.load_decisions(path)


def test_record_decision_blocks_on_corrupt_existing_file(tmp_path):
    """Writing must not blindly overwrite a corrupt file (which could lose rows);
    the internal load fails closed and propagates DecisionLoadError."""
    path = tmp_path / dc.DECISIONS_FILENAME
    path.write_text("{ not json\n", encoding="utf-8")
    with pytest.raises(dc.DecisionLoadError):
        dc.record_decision(path, _card(), approved_role="bee_body", provenance=PROV)
    # The corrupt file is left as-is, not silently replaced.
    assert path.read_text(encoding="utf-8") == "{ not json\n"


# --- viewer surfaces the load failure (FL-4162) ------------------------------

def test_viewer_panel_surfaces_load_failure_not_none_recorded(tmp_path):
    st = _state(tmp_path, [_card()])
    st.decisions_load_error = "malformed JSON on line 2 of decisions.jsonl"
    text = "\n".join(v._anchor_render_evidence_panel(st))
    assert "DECISION FILE LOAD FAILED" in text
    assert "none recorded" not in text  # must NOT pretend the file is valid/empty


def test_t_keybind_blocked_when_load_failed(tmp_path):
    st = _state(tmp_path, [_card()])
    st.show_evidence = True
    st.decisions_load_error = "decisions file present but unreadable"
    cell = [[(0, (0, 0, 0), (0, 0, 0))]]
    v._handle_anchor_key(st, "t", cell)
    assert st.prompt_mode == ""  # did not open a capture prompt
    assert "blocked" in st.status.lower()
    assert not st.decisions_path.exists()
