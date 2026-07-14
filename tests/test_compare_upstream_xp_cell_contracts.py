"""Tests for full-atlas FL-4162 source-contract comparisons."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE / "scripts"))

import compare_upstream_xp_cell_contracts as compare  # noqa: E402


def _record(key, values, spans, role="helmet", family="plydie"):
    return {
        "source_key": key,
        "family": family,
        "raw_layer_index": int(key.rsplit("-L", 1)[1]),
        "frame_geometry": {"frame_width": 3, "frame_height": 1,
                           "angles": 1, "frames_per_angle": 1},
        "coverage": {"raw_cells": 3},
        "hand_evidence": {"status": "accept", "corrected_label": role},
        "layer_semantics": {"candidate_roles": [role]},
        "cell_values": values,
        "cell_spans": spans,
    }


TRANSPARENT = {"raw": {"glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]},
               "cell_type": "transparent"}
HELMET = {"raw": {"glyph": 220, "fg": [1, 2, 3], "bg": [4, 5, 6]},
          "cell_type": "overlay_pixel"}
SHIELD = {"raw": {"glyph": 221, "fg": [7, 8, 9], "bg": [10, 11, 12]},
          "cell_type": "overlay_pixel"}


def test_expand_and_compare_exact_coordinates():
    left = _record("plydie-a-L3", [TRANSPARENT, HELMET], [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 2, 1]])
    right = _record("plydie-b-L3", [TRANSPARENT, HELMET], [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 2, 1]])
    result = compare.compare_records(left, right)
    assert result["metrics"]["common_visible_coordinates"] == 2
    assert result["metrics"]["exact_raw_coordinates"] == 2
    assert result["metrics"]["occupancy_jaccard"] == 1.0
    assert result["metrics"]["count_similarity"] == 1.0
    assert result["metrics"]["coordinate_similarity"] == 1.0
    assert result["metrics"]["combined_similarity"] == 1.0


def test_compare_preserves_coordinate_level_differences():
    left = _record("plydie-a-L3", [TRANSPARENT, HELMET], [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 2, 1]])
    right = _record("plydie-b-L3", [TRANSPARENT, HELMET, SHIELD],
                    [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 1, 1], [0, 0, 0, 2, 1, 2]])
    result = compare.compare_records(left, right)
    assert result["metrics"]["common_visible_coordinates"] == 2
    assert result["metrics"]["exact_raw_coordinates"] == 1
    assert result["coordinate_differences"]["changed"][0]["coordinate"] == [0, 0, 0, 2]


def test_geometry_mismatch_fails_closed():
    left = _record("plydie-a-L3", [TRANSPARENT], [[0, 0, 0, 0, 3, 0]])
    right = _record("plydie-b-L3", [TRANSPARENT], [[0, 0, 0, 0, 3, 0]])
    right["frame_geometry"]["frame_width"] = 4
    with pytest.raises(compare.ComparisonError, match="geometry mismatch"):
        compare.compare_records(left, right)


def test_corpus_ranking_covers_all_layers_and_crosses_families():
    records = {
        "plydie-a-L3": _record(
            "plydie-a-L3", [TRANSPARENT, HELMET],
            [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 2, 1]],
        ),
        "player-a-L3": _record(
            "player-a-L3", [TRANSPARENT, HELMET],
            [[0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 2, 1]], family="player",
        ),
        "attack-a-L3": _record(
            "attack-a-L3", [TRANSPARENT, SHIELD],
            [[0, 0, 0, 0, 2, 0], [0, 0, 0, 2, 1, 1]], family="attack",
        ),
    }
    result = compare.build_corpus_ranking(records, top=2)
    assert result["coverage"]["ledger_layers"] == 3
    assert result["coverage"]["ranked_layers"] == 3
    assert result["coverage"]["compatible_pairs_ranked"] == 3
    by_key = {row["source_key"]: row for row in result["rankings"]}
    assert by_key["plydie-a-L3"]["nearest_neighbors"][0]["peer"] == "player-a-L3"
    assert by_key["plydie-a-L3"]["nearest_neighbors"][0]["peer_family"] == "player"


def test_corpus_ranking_fails_when_a_layer_has_no_geometry_peer():
    records = {
        "plydie-a-L3": _record(
            "plydie-a-L3", [TRANSPARENT], [[0, 0, 0, 0, 3, 0]],
        ),
        "player-a-L3": _record(
            "player-a-L3", [TRANSPARENT], [[0, 0, 0, 0, 3, 0]], family="player",
        ),
        "attack-a-L3": _record(
            "attack-a-L3", [TRANSPARENT], [[0, 0, 0, 0, 3, 0]], family="attack",
        ),
    }
    records["attack-a-L3"]["frame_geometry"]["frame_width"] = 4
    with pytest.raises(compare.ComparisonError, match="without compatible geometry peers"):
        compare.build_corpus_ranking(records)
