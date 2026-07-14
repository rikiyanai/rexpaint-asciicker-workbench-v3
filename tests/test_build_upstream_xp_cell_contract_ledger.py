"""FL-4162 / RQ-200 full-cell ledger coverage and fail-closed tests."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import build_upstream_xp_cell_contract_ledger as ledger  # noqa: E402
import xp_core  # noqa: E402


def _xp() -> xp_core.XPFile:
    xp = xp_core.XPFile()
    empty = (0, (0, 0, 0), (255, 0, 255))
    body = (220, (10, 20, 30), (40, 50, 60))
    swoosh = (221, (0, 255, 255), (70, 80, 90))
    xp.layers = [
        xp_core.XPLayer(4, 2, [[empty] * 4 for _ in range(2)]),
        xp_core.XPLayer(4, 2, [[empty] * 4 for _ in range(2)]),
        xp_core.XPLayer(4, 2, [[empty, body, body, empty], [body, empty, empty, body]]),
        xp_core.XPLayer(4, 2, [[empty, swoosh, empty, empty], [empty] * 4]),
    ]
    return xp


def _card(path: Path, layer_index: int = 2) -> dict:
    return {
        "source_key": f"player-0000-L{layer_index}",
        "family": "player",
        "source_xp_path": str(path),
        "source_final_sha256": ledger.EXPECTED_STATE_FINAL_SHA256,
        "raw_layer_index": layer_index,
        "ahsw": {"raw": "0000"},
        "cells": {"frame_wh": [2, 1]},
        "hand": {
            "status": "accept",
            "corrected_label": "player_body",
            "note": "player body",
            "pre_guess": "player_body",
            "pre_source": "hand",
            "source_row_verbatim": {"status": "accept"},
        },
        "glyph_similarity": {"exact_matches": [], "near_matches": []},
    }


def _manual(roles=None, unresolved=False) -> dict:
    return {
        "agent_verdict": {
            "proposed_roles": roles if roles is not None else ["player_body"],
            "unresolved": unresolved,
            "contradictions": [],
            "topology_note": "",
        }
    }


def test_every_raw_coordinate_is_covered_once(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    record = ledger.build_layer_record(
        _card(source), _manual(), None, {"classification": "owned"}, source, _xp()
    )
    ledger.validate_record(record)
    assert record["coverage"]["raw_cells"] == 8
    assert record["coverage"]["visible_cells"] == 4
    assert sum(span[4] for span in record["cell_spans"]) == 8
    assert {value["composition_rule"] for value in record["cell_values"]} == {
        "no_visual_contribution", "seed_l2_base_accumulator"
    }


def test_spans_preserve_frame_angle_and_local_coordinates():
    layer = _xp().layers[2]
    _, spans, _ = ledger.build_spans(layer, 2, 4, 2, 1, "reviewed_layer_role_candidate")
    assert {(s[0], s[1], s[2]) for s in spans} == {
        (0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 0)
    }
    assert all(s[3] + s[4] <= 2 for s in spans)


def test_composite_cells_remain_unsegmented(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    record = ledger.build_layer_record(
        _card(source), _manual(["player_body", "shield"]), None,
        {"classification": "composite"}, source, _xp()
    )
    assert record["layer_semantics"]["cell_role_state"] == "composite_layer_unsegmented"
    assert record["layer_semantics"]["review_state"] == "reviewed_composite_cell_assignment_pending"
    contributions = {value["role_contribution"] for value in record["cell_values"]}
    assert contributions == {"none", "composite_layer_unsegmented"}


def test_unresolved_hand_evidence_stays_unresolved(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    record = ledger.build_layer_record(
        _card(source), _manual(["helmet"], unresolved=True), None,
        {"classification": "unresolved"}, source, _xp()
    )
    assert record["layer_semantics"]["review_state"] == "unresolved_hand_evidence"
    assert "unresolved_source_contract" in {
        value["role_contribution"] for value in record["cell_values"]
    }


def test_final_cyan_cell_uses_swoosh_composition(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    record = ledger.build_layer_record(
        _card(source, 3), _manual(["weapon_swoosh"]), None,
        {"classification": "owned"}, source, _xp()
    )
    visible = [value for value in record["cell_values"] if value["cell_type"] != "transparent"]
    assert len(visible) == 1
    assert visible[0]["cell_type"] == "swoosh_pixel"
    assert visible[0]["composition_rule"] == "final_cyan_swoosh_context_composite"


def test_metadata_layers_are_covered_as_engine_contract_cells(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    for layer_index, cell_type, rule in (
        (0, "color_key", "define_per_cell_color_key_and_frame_metadata"),
        (1, "height_digit", "define_height_channel"),
    ):
        record = ledger.build_metadata_layer_record(_card(source), source, _xp(), layer_index)
        ledger.validate_record(record)
        assert record["raw_layer_index"] == layer_index
        assert record["coverage"]["raw_cells"] == 8
        assert record["coverage"]["cell_type_histogram"] == {cell_type: 8}
        assert {value["composition_rule"] for value in record["cell_values"]} == {rule}
        assert record["layer_semantics"]["review_state"] == "engine_metadata_semantics_unverified"


def test_state_final_fingerprint_mismatch_fails_closed(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    card = _card(source)
    card["source_final_sha256"] = "0" * 64
    with pytest.raises(ledger.CellContractError, match="state_FINAL fingerprint mismatch"):
        ledger.build_layer_record(
            card, _manual(), None, {"classification": "owned"}, source, _xp()
        )


def test_validate_rejects_missing_and_overlapping_cells(tmp_path):
    source = tmp_path / "player-0000.xp"
    source.write_bytes(b"fixture")
    record = ledger.build_layer_record(
        _card(source), _manual(), None, {"classification": "owned"}, source, _xp()
    )
    record["cell_spans"] = record["cell_spans"][:-1]
    record["coverage"]["spans"] -= 1
    with pytest.raises(ledger.CellContractError, match="incomplete full-cell coverage"):
        ledger.validate_record(record)


def test_atomic_write_replaces_complete_document(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_bytes(b"old")
    ledger.atomic_write(path, b"new\n")
    assert path.read_bytes() == b"new\n"
    assert not list(tmp_path.glob(".manifest.json.*"))


def test_checked_in_schema_names_the_full_cell_contract():
    schema = json.loads((PIPELINE / "config/upstream_xp_cell_contract_schema.json").read_text())
    assert schema["$id"] == ledger.SCHEMA
    assert schema["properties"]["authority"]["const"] is False
    assert "cell_spans" in schema["required"]
