"""FL-4162 — the review-packet generator must not regress the Step 8 Law 6 fix.

The generator writes source_layer_review_decisions.jsonl. Its write path must be
fail-closed and upsert-preserving, exactly like decision_capture.record_decision:

  1. a corrupt/unreadable EXISTING decisions file blocks the write (never an
     overwrite that would erase a prior batch);
  2. an existing unrelated decision (from an earlier batch) SURVIVES the merge;
  3. a reviewed source_key updates exactly ONE row (no duplicate).
"""
import json
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import decision_capture as dc  # noqa: E402
import build_manual_candidate_review as b  # noqa: E402

PROV = {"tool": "test", "recorded_at": "2026-06-18T00:00:00"}


def _rec(source_key: str, role: str) -> dict:
    """A proposal record for `source_key`, built through the real builder."""
    card = {
        "card_id": source_key, "source_key": source_key, "source_xp_path": "x.xp",
        "family": "fam", "raw_layer_index": 0, "source_final_sha256": "sha",
    }
    return dc.build_decision_record(card, approved_role=role, provenance=PROV)


def test_corrupt_existing_decisions_blocks_write(tmp_path):
    p = tmp_path / dc.DECISIONS_FILENAME
    p.write_text("{ this is not valid json\n", encoding="utf-8")
    with pytest.raises(dc.DecisionLoadError):
        b.merge_and_write_decisions(p, [_rec("bigbee-0000-L2", "bee_body")])
    # The corrupt file is left untouched — NOT overwritten by the new batch.
    assert p.read_text(encoding="utf-8") == "{ this is not valid json\n"


def test_existing_unrelated_decision_survives_merge(tmp_path):
    p = tmp_path / dc.DECISIONS_FILENAME
    b.merge_and_write_decisions(p, [_rec("batch1-keep", "old_role")])   # earlier batch
    merged = b.merge_and_write_decisions(p, [_rec("batch2-new", "new_role")])  # this batch
    assert set(merged) == {"batch1-keep", "batch2-new"}
    loaded = dc.load_decisions(p)
    assert loaded["batch1-keep"]["approved_role"] == "old_role"
    assert loaded["batch2-new"]["approved_role"] == "new_role"


def test_reviewed_source_key_updates_exactly_one_row(tmp_path):
    p = tmp_path / dc.DECISIONS_FILENAME
    b.merge_and_write_decisions(p, [_rec("x-L2", "first")])
    b.merge_and_write_decisions(p, [_rec("x-L2", "revised")])
    lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 1, "upsert left more than one row for the same source_key"
    assert json.loads(lines[0])["approved_role"] == "revised"


def test_missing_file_starts_clean(tmp_path):
    p = tmp_path / dc.DECISIONS_FILENAME
    merged = b.merge_and_write_decisions(p, [_rec("only", "r")])
    assert set(merged) == {"only"}
    assert p.exists()


def _card_for(queue_class: str) -> dict:
    return {
        "card_id": "c-L3", "source_key": "c-L3", "source_xp_path": "x.xp",
        "family": "fam", "raw_layer_index": 3, "source_final_sha256": "sha",
        "review": {"queue_class_name": queue_class},
    }


def test_reject_decision_records_batch_reject():
    """A reject-batch row must carry provenance.batch=rejects-first/reject, not the
    batch-1 wrong_guess_reject value."""
    card = _card_for("reject")
    rec = dc.build_decision_record(card, approved_role="helmet", provenance=b._provenance_for(card))
    assert rec["review_provenance"]["batch"] == "rejects-first/reject"


def test_wrong_guess_decision_records_batch_wrong_guess_reject():
    card = _card_for("wrong_guess_reject")
    rec = dc.build_decision_record(card, approved_role="bee_body", provenance=b._provenance_for(card))
    assert rec["review_provenance"]["batch"] == "rejects-first/wrong_guess_reject"


def test_packet_batch_label_derives_from_reviewed_rows_not_hardcoded():
    """The packet header must reflect the queue classes actually reviewed, so it
    can't go stale (e.g. omit 'partial') as batches widen."""
    rows = [{"queue_class": "wrong_guess_reject"}, {"queue_class": "reject"},
            {"queue_class": "partial"}]
    label = b._reviewed_batch_label(rows)
    for qc in ("wrong_guess_reject", "reject", "partial"):
        assert qc in label, f"{qc} missing from derived batch label: {label!r}"
    # A future class shows up automatically.
    assert "clean_accept" in b._reviewed_batch_label(rows + [{"queue_class": "clean_accept"}])


def test_uncovered_warning_is_queue_class_neutral():
    """The uncovered-cluster warning must name the queue class, not say 'reject'."""
    w = b._uncovered_warning([{"queue_class": "clean_accept", "card_id": "foo-L2"}])
    assert "clean_accept" in w
    assert "foo-L2" in w
    assert "reject cards" not in w  # no hard-coded class


def test_clean_accept_passthrough_uses_hand_label_verbatim():
    """clean-accept labels are already role tokens — proposal passes them through,
    splitting composites on ';', with no agent reinterpretation."""
    card = {"hand": {"corrected_label": "shield;armor;mount_body_wolf"},
            "review": {"queue_class_name": "clean_accept"}}
    v = b._passthrough_verdict(card)
    assert v["supported"] is True and v["unresolved"] is False
    assert v["roles"] == ["shield", "armor", "mount_body_wolf"]
    assert v["contradictions"] == []


def test_clean_accept_empty_label_is_unresolved():
    card = {"hand": {"corrected_label": "  "}, "review": {"queue_class_name": "clean_accept"}}
    v = b._passthrough_verdict(card)
    assert v["unresolved"] is True and v["supported"] is False
    assert v["roles"] == []


def test_ambig_class_is_unresolved_even_with_text_label():
    """ambig must resolve to unresolved BY CLASS (FL-4162): an ambig card carrying a
    real label must still be unresolved and never proposed (not rescued by passthrough)."""
    assert "ambig" in b.UNRESOLVED_CLASSES
    assert "ambig" not in b.PASSTHROUGH_CLASSES
    card = {"hand": {"corrected_label": "shield"},  # non-empty, plausible role token
            "review": {"queue_class_name": "ambig"}}
    v = b._unresolved_verdict(card)
    assert v["unresolved"] is True and v["supported"] is False
    assert v["roles"] == []  # never proposed, despite the text label


def test_full_cell_resolutions_cover_the_original_ten_without_mutating_hand_evidence():
    assert set(b.FULL_CELL_RESOLUTIONS) == {
        "attack-0101-L4", "attack-0111-L4", "attack-1001-L4",
        "bigbee-0012-L5", "player-1112-L3", "plydie-1101-L3",
        "plydie-1102-L3", "plydie-1110-L3", "plydie-1111-L3",
        "plydie-1112-L3",
    }
    assert all(v["supported"] and not v["unresolved"]
               for v in b.FULL_CELL_RESOLUTIONS.values())
    assert all(v["resolution_evidence"] == b.FULL_CELL_RESOLUTION_REPORT
               for v in b.FULL_CELL_RESOLUTIONS.values())


def test_full_cell_resolution_provenance_names_the_coordinate_report():
    card = _card_for("ambig")
    verdict = b.FULL_CELL_RESOLUTIONS["player-1112-L3"]
    provenance = b._provenance_for(card, verdict)
    assert provenance["review_kind"] == "agent_manual_full_cell_ambiguity_resolution"
    assert provenance["evidence"] == b.FULL_CELL_RESOLUTION_REPORT


def test_plydie_1102_preserves_crossbow_reflection_exception():
    verdict = b.FULL_CELL_RESOLUTIONS["plydie-1102-L3"]
    assert verdict["roles"] == ["plydie_helmet_regular", "crossbow_reflection_fragment"]
    assert "reflection" in verdict["topology"]
