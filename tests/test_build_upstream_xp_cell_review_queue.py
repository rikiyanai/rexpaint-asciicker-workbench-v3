"""Tests for the FL-4162 unique-layer cell review queue."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_cell_review_queue as queue  # noqa: E402


def _record(key: str, sha: str, state: str, topology: str, role: str) -> dict:
    return {
        "source_key": key,
        "family": key.split("-", 1)[0],
        "raw_layer_index": int(key.rsplit("-L", 1)[1]),
        "source_xp": {"raw_layer_sha256": sha},
        "frame_geometry": {"frame_width": 2, "frame_height": 2, "angles": 1, "frames_per_angle": 1},
        "hand_evidence": {"status": "accept"},
        "layer_semantics": {
            "review_state": state,
            "topology_class": topology,
            "candidate_roles": role.split(";"),
        },
        "coverage": {"raw_cells": 4, "visible_cells": 2},
    }


def _similarity(keys: list[str]) -> dict:
    return {key: {"nearest_neighbors": [{"peer": keys[(i + 1) % len(keys)]}]}
            for i, key in enumerate(keys)}


def test_queue_deduplicates_exact_layers_and_preserves_all_members():
    sha_a = "a" * 64
    sha_b = "b" * 64
    records = {
        "bigbee-0000-L3": _record(
            "bigbee-0000-L3", sha_a, "reviewed_composite_cell_assignment_pending", "composite", "rider;shield"
        ),
        "bigbee-0001-L3": _record(
            "bigbee-0001-L3", sha_a, "reviewed_composite_cell_assignment_pending", "composite", "rider;shield"
        ),
        "player-0000-L2": _record(
            "player-0000-L2", sha_b, "layer_role_reviewed_cell_semantics_unverified", "owned", "player_body"
        ),
    }
    doc = queue.build_queue(records, _similarity(list(records)))
    assert doc["coverage"]["ledger_layers"] == 3
    assert doc["coverage"]["unique_review_units"] == 2
    assert doc["coverage"]["exact_duplicate_layers_reusing_a_unit"] == 1
    assert doc["review_units"][0]["member_source_keys"] == [
        "bigbee-0000-L3", "bigbee-0001-L3"
    ]


def test_rejected_fragment_has_highest_priority_and_freeze_stays_closed():
    records = {
        "player-a-L3": _record(
            "player-a-L3", "a" * 64, "layer_role_reviewed_cell_semantics_unverified", "owned", "armor"
        ),
        "player-b-L3": _record(
            "player-b-L3", "b" * 64, "rejected_fragment_needs_contract", "rejected", "fragment"
        ),
    }
    doc = queue.build_queue(records, _similarity(list(records)))
    assert doc["review_units"][0]["representative_source_key"] == "player-b-L3"
    assert doc["review_units"][0]["decision_state"] == "needs_source_contract"
    assert doc["freeze_gate"]["ready"] is False
    assert doc["coverage"]["decided_units"] == 0


def test_similarity_coverage_mismatch_fails_closed(tmp_path: Path):
    path = tmp_path / "similarity.json"
    path.write_text('{"authority":false,"is_proposal":true,"rankings":[]}')
    with pytest.raises(queue.ReviewQueueError, match="do not match"):
        queue.load_similarity(path, {"player-0000-L2"})


def test_unknown_review_state_fails_closed():
    records = {
        "player-a-L2": _record("player-a-L2", "a" * 64, "guessed", "owned", "body"),
    }
    with pytest.raises(queue.ReviewQueueError, match="unknown review state"):
        queue.build_queue(records, _similarity(list(records)))


def test_review_state_loader_rejects_duplicate_units(tmp_path: Path):
    path = tmp_path / "states.jsonl"
    row = {"review_unit_id": "same"}
    path.write_text(json.dumps(row) + "\n" + json.dumps(row) + "\n", encoding="utf-8")
    with pytest.raises(queue.ReviewQueueError, match="duplicate review_unit_id"):
        queue.load_review_state_decisions(path)


def test_decision_must_cover_every_contract_cell_once():
    record = _record(
        "player-a-L1", "a" * 64, "engine_metadata_semantics_unverified",
        "engine_metadata", "engine_height_channel",
    )
    record["cell_values"] = [{"raw": {"glyph": 48}, "cell_type": "height_digit"}]
    record["cell_spans"] = [[0, 0, 0, 0, 2, 0], [0, 0, 1, 0, 2, 0]]
    records = {record["source_key"]: record}
    doc = queue.build_queue(records, _similarity(list(records)))
    unit = doc["review_units"][0]
    decision = {
        "schema": "fl4162.upstream_xp_cell_role_decision.v2",
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "cell_assignments": [[
            0, 0, 0, 0, 2, "define_height_channel", ["height"]
        ]],
        "composition_review": {"verified_against_upstream_ref": True},
        "review_provenance": {"evidence_refs": ["sprite.cpp:351"], "decision": "height"},
    }
    with pytest.raises(queue.ReviewQueueError, match="assignment coverage mismatch"):
        queue.apply_decisions(doc, {unit["review_unit_id"]: decision}, records)


def test_decision_binds_render_operation_and_transparent_semantics():
    record = _record(
        "player-a-L2", "a" * 64,
        "layer_role_reviewed_cell_semantics_unverified", "owned", "player_body",
    )
    record["cell_values"] = [
        {
            "raw": {"glyph": 64},
            "cell_type": "body_pixel",
            "render_operation": "seed_l2_base_accumulator",
        },
        {
            "raw": {"glyph": 0},
            "cell_type": "transparent",
            "render_operation": "no_visual_contribution",
        },
    ]
    record["cell_spans"] = [
        [0, 0, 0, 0, 1, 0],
        [0, 0, 0, 1, 1, 1],
        [0, 0, 1, 0, 2, 1],
    ]
    records = {record["source_key"]: record}
    doc = queue.build_queue(records, _similarity(list(records)))
    unit = doc["review_units"][0]
    base = {
        "schema": "fl4162.upstream_xp_cell_role_decision.v2",
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "composition_review": {"verified_against_upstream_ref": True},
        "review_provenance": {"evidence_refs": ["sprite.cpp:352"], "decision": "body"},
    }
    bad_operation = dict(base, cell_assignments=[
        [0, 0, 0, 0, 1, "ordinal_overlay_merge_into_l2", ["player_body"]],
        [0, 0, 0, 1, 1, "no_visual_contribution", []],
        [0, 0, 1, 0, 2, "no_visual_contribution", []],
    ])
    with pytest.raises(queue.ReviewQueueError, match="render operation mismatch"):
        queue.apply_decisions(doc, {unit["review_unit_id"]: bad_operation}, records)

    bad_transparent = dict(base, cell_assignments=[
        [0, 0, 0, 0, 1, "seed_l2_base_accumulator", ["player_body"]],
        [0, 0, 0, 1, 1, "no_visual_contribution", ["player_body"]],
        [0, 0, 1, 0, 2, "no_visual_contribution", []],
    ])
    with pytest.raises(queue.ReviewQueueError, match="transparent cell has semantic claim"):
        queue.apply_decisions(doc, {unit["review_unit_id"]: bad_transparent}, records)

    valid = dict(base, cell_assignments=[
        [0, 0, 0, 0, 1, "seed_l2_base_accumulator", ["player_body"]],
        [0, 0, 0, 1, 1, "no_visual_contribution", []],
        [0, 0, 1, 0, 2, "no_visual_contribution", []],
    ])
    queue.apply_decisions(doc, {unit["review_unit_id"]: valid}, records)
    assert doc["coverage"]["decided_units"] == 1
    assert doc["freeze_gate"]["ready"] is True


def test_false_clean_retraction_requires_distinct_expanded_replacement():
    record = _record(
        "attack-0101-L2", "a" * 64,
        "layer_role_reviewed_cell_semantics_unverified", "owned", "attack_body",
    )
    record["cell_values"] = [{
        "raw": {"glyph": 64},
        "cell_type": "body_pixel",
        "render_operation": "seed_l2_base_accumulator",
    }]
    record["cell_spans"] = [[0, 0, 0, 0, 4, 0]]
    records = {record["source_key"]: record}
    doc = queue.build_queue(records, _similarity(list(records)))
    unit = doc["review_units"][0]
    state = {
        "schema": queue.REVIEW_STATE_DECISION_SCHEMA,
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "source_decision_state": "needs_cell_semantic_confirmation",
        "target_decision_state": "needs_cell_role_segmentation",
        "review_provenance": {
            "decision": "body-only decision was false-clean",
            "evidence_refs": ["raw cells"],
            "retracted_full_cell_decision_sha256": "f" * 64,
            "retracted_semantic_sets": [["attack_body"]],
        },
    }
    queue.apply_review_state_decisions(doc, {unit["review_unit_id"]: state})
    base = {
        "schema": "fl4162.upstream_xp_cell_role_decision.v2",
        "authority": False,
        "is_proposal": True,
        "review_unit_id": unit["review_unit_id"],
        "source_layer_sha256": unit["source_layer_sha256"],
        "frame_geometry": unit["frame_geometry"],
        "member_source_keys": unit["member_source_keys"],
        "composition_review": {"verified_against_upstream_ref": True},
        "review_provenance": {"evidence_refs": ["raw cells"], "decision": "reviewed"},
    }
    unchanged = dict(base, cell_assignments=[[
        0, 0, 0, 0, 4, "seed_l2_base_accumulator", ["attack_body"]
    ]])
    queue.apply_decisions(doc, {unit["review_unit_id"]: unchanged}, records)
    assert doc["freeze_gate"]["semantic_honesty"]["ready"] is False
    assert doc["freeze_gate"]["ready"] is False

    corrected = dict(base, cell_assignments=[
        [0, 0, 0, 0, 2, "seed_l2_base_accumulator", ["attack_body"]],
        [0, 0, 0, 2, 2, "seed_l2_base_accumulator", ["attack_weapon_sword"]],
    ])
    queue.apply_decisions(doc, {unit["review_unit_id"]: corrected}, records)
    assert doc["freeze_gate"]["semantic_honesty"] == {
        "ready": True,
        "recorded_false_clean_retractions": 1,
        "distinct_expanded_replacements": 1,
        "rule": (
            "each fingerprint-bound false-clean retraction requires a distinct "
            "active decision with an expanded semantic contribution set"
        ),
    }
    assert doc["freeze_gate"]["ready"] is True
