import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from scripts.glyph_assignment import (
    GlyphAssignmentConfig,
    assign_cell,
    assign_image_cells,
    load_glyph_masks,
    load_optional_semantic_bias,
    load_overrides,
    write_sheet_summary,
    write_suggestions_compact,
    write_suggestions_json,
)
from scripts.glyph_assignment.semantic_bias import BUILT_IN_ROLE_TABLES
from scripts.png2xp2png import BdfFont, CP437_TO_UNI

FONT_PATH = Path("runtime/termpp-skin-lab-static/termpp-web-flat/fonts/cp437_6x6.png.bdf")


def _config(**kwargs):
    values = {
        "font_path": FONT_PATH,
        "font_cell_size": (6, 6),
        "target_cell_size": (6, 6),
    }
    values.update(kwargs)
    return GlyphAssignmentConfig(**values)


def _tile_for_glyph(glyph, fg=(0, 0, 0), bg=(180, 180, 180)):
    font = BdfFont(str(FONT_PATH))
    mask = np.array(font.get_mask(CP437_TO_UNI[glyph]), dtype=bool).reshape(6, 6)
    tile = np.zeros((6, 6, 4), dtype=np.uint8)
    tile[:, :, :3] = bg
    tile[:, :, 3] = 255
    tile[mask, :3] = fg
    return Image.fromarray(tile, "RGBA")


def test_recovers_slash_and_backslash_from_colored_background():
    masks = load_glyph_masks(FONT_PATH, (6, 6))

    slash = assign_cell(_tile_for_glyph(47), _config(), masks)
    backslash = assign_cell(_tile_for_glyph(92), _config(), masks)

    assert slash.chosen.glyph == 47
    assert slash.chosen.fg == (0, 0, 0)
    assert slash.chosen.bg == (180, 180, 180)
    assert backslash.chosen.glyph == 92


def test_rgb_png_atlas_uses_luminance_not_alpha(tmp_path):
    atlas = Image.new("RGBA", (16 * 6, 16 * 6), (0, 0, 0, 255))
    pixels = atlas.load()
    glyph = 47
    x0 = (glyph % 16) * 6
    y0 = (glyph // 16) * 6
    for idx in range(6):
        pixels[x0 + idx, y0 + (5 - idx)] = (255, 255, 255, 255)
    path = tmp_path / "atlas.png"
    atlas.save(path)

    masks = load_glyph_masks(path, (6, 6))

    assert masks[glyph].mask.sum() == 6


def test_solid_cells_remain_full_block():
    tile = Image.new("RGBA", (6, 6), (210, 210, 210, 255))

    assigned = assign_cell(tile, _config())

    assert assigned.chosen.glyph == 219
    assert assigned.chosen.fg == (210, 210, 210)
    assert assigned.chosen.bg == (255, 0, 255)


def test_non_solid_cells_do_not_collapse_to_full_block():
    assigned = assign_cell(_tile_for_glyph(47), _config())

    assert assigned.chosen.glyph != 219
    assert len(assigned.alternatives) >= 2


def test_tiny_features_allow_one_pixel_solid_but_penalize_two_pixel_block():
    one_pixel = Image.new("RGBA", (6, 6), (180, 180, 180, 255))
    one_pixel.putpixel((0, 0), (0, 0, 0, 255))
    two_pixel = Image.new("RGBA", (6, 6), (180, 180, 180, 255))
    two_pixel.putpixel((0, 0), (0, 0, 0, 255))
    two_pixel.putpixel((1, 0), (0, 0, 0, 255))

    one = assign_cell(one_pixel, _config())
    two = assign_cell(two_pixel, _config(candidate_limit=256))
    block_alternative = next(candidate for candidate in two.alternatives if candidate.glyph == 219)

    assert one.chosen.glyph == 219
    assert one.chosen.components["ink_count"] == 1
    assert two.chosen.glyph != 219
    assert block_alternative.components["solid_penalty"] == pytest.approx(0.35)


def test_semantic_bias_only_changes_close_candidates():
    masks = load_glyph_masks(FONT_PATH, (6, 6))
    unbiased = assign_cell(_tile_for_glyph(117), _config(), masks, region="mouth")
    biased = assign_cell(
        _tile_for_glyph(117),
        _config(semantic_bias={"mouth": {118: 1.0}}, score_delta_threshold=1.0, candidate_limit=256),
        masks,
        region="mouth",
    )
    distant = assign_cell(
        _tile_for_glyph(117),
        _config(semantic_bias={"mouth": {118: 1.0}}, score_delta_threshold=0.0, candidate_limit=256),
        masks,
        region="mouth",
    )

    assert unbiased.chosen.glyph == 117
    assert biased.chosen.glyph == 118
    assert distant.chosen.glyph == 117


def test_missing_font_path_fails_at_matching_boundary():
    missing = Path("/tmp/does-not-exist-cp437.bdf")

    with pytest.raises(FileNotFoundError):
        assign_cell(_tile_for_glyph(47), _config(font_path=missing))


def test_missing_semantic_map_path_warns_and_returns_builtin_tables(tmp_path):
    missing = tmp_path / "semantic_maps"

    with pytest.warns(RuntimeWarning):
        bias = load_optional_semantic_bias(missing)

    # Built-in tables are returned even when the path is missing; they are not empty
    assert len(bias) > 0


def test_missing_semantic_map_path_with_role_returns_role_tables(tmp_path):
    missing = tmp_path / "semantic_maps"

    with pytest.warns(RuntimeWarning):
        bias = load_optional_semantic_bias(missing, role="player")

    # Returns player built-in tables for known regions
    assert set(bias.keys()) >= set(BUILT_IN_ROLE_TABLES["player"].keys())


def test_load_semantic_bias_unknown_role_returns_empty(tmp_path):
    maps = tmp_path / "semantic_maps"
    maps.mkdir()

    bias = load_optional_semantic_bias(maps, role="unknown_family")

    assert bias == {}


def test_load_semantic_bias_valid_map_root_augments_builtin_tables():
    map_root = Path("docs/research/ascii/semantic_maps")
    if not map_root.exists():
        pytest.skip("semantic maps not present")

    bias = load_optional_semantic_bias(map_root, role="player")

    assert len(bias) > 0
    # face region should have glyph hints from the player map (glyph 34 = ", 118 = v)
    assert "face" in bias
    assert 34 in bias["face"] or 118 in bias["face"]


def test_load_semantic_bias_malformed_json_warns_and_skips(tmp_path):
    maps = tmp_path / "semantic_maps"
    maps.mkdir()
    (maps / "player-bad.json").write_text("not { valid json")
    # Also write a valid file to confirm it is still parsed
    import json as _json
    valid_data = {
        "frames": {
            "0": {
                "regions": [
                    {"name": "face", "semantic_cells": [{"glyph": 34}]}
                ]
            }
        }
    }
    (maps / "player-good.json").write_text(_json.dumps(valid_data))

    with pytest.warns(RuntimeWarning):
        bias = load_optional_semantic_bias(maps, role="player")

    # The valid file's hint for glyph 34 in "face" should appear
    assert "face" in bias
    assert 34 in bias["face"]


def test_load_semantic_bias_empty_semantic_cells_uses_builtin_only(tmp_path):
    import json as _json
    maps = tmp_path / "semantic_maps"
    maps.mkdir()
    data = {
        "frames": {
            "0": {
                "regions": [
                    {"name": "face", "semantic_cells": []}
                ]
            }
        }
    }
    (maps / "player-empty.json").write_text(_json.dumps(data))

    bias = load_optional_semantic_bias(maps, role="player")

    # face still has built-in weights even with empty semantic_cells
    assert "face" in bias
    assert len(bias["face"]) > 0


def test_load_semantic_bias_integration_with_config_and_apply():
    """Returned dict is compatible with GlyphAssignmentConfig and apply_semantic_bias."""
    map_root = Path("docs/research/ascii/semantic_maps")
    if not map_root.exists():
        pytest.skip("semantic maps not present")

    bias = load_optional_semantic_bias(map_root, role="player")
    config = _config(semantic_bias=bias, candidate_limit=10, score_delta_threshold=0.35)
    # assign_cell should run without error when bias dict is present
    result = assign_cell(_tile_for_glyph(47), config, region="face")
    assert result.chosen.glyph is not None


def test_assign_image_cells_preserves_cached_tile_coordinates_and_regions():
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (12, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))
    image.alpha_composite(tile, (6, 0))

    cells = assign_image_cells(image, _config(), regions={(1, 0): "mouth"})

    assert [(cell.x, cell.y, cell.region, cell.chosen.glyph) for cell in cells] == [
        (0, 0, None, 47),
        (1, 0, "mouth", 47),
    ]


def test_unsupported_font_atlas_extension_fails_closed(tmp_path):
    atlas = tmp_path / "atlas.txt"
    atlas.write_text("not a font\n")

    with pytest.raises(ValueError, match="unsupported glyph atlas format"):
        load_glyph_masks(atlas, (6, 6))


# ---------------------------------------------------------------------------
# U3 — override sidecar tests
# ---------------------------------------------------------------------------

def _make_override_file(tmp_path, records: dict) -> Path:
    import json as _json
    path = tmp_path / "glyph_review_overrides.json"
    path.write_text(_json.dumps(records))
    return path


def test_load_overrides_accepted_cell_returned_as_is(tmp_path):
    path = _make_override_file(tmp_path, {
        "civilian1/player/3/5": {"glyph": 47, "fg": [0, 0, 0], "bg": [180, 180, 180], "accepted": True}
    })
    result = load_overrides(path, "civilian1", "player")
    assert (3, 5) in result
    assert result[(3, 5)]["glyph"] == 47
    assert result[(3, 5)]["accepted"] is True


def test_load_overrides_filters_by_name_and_family(tmp_path):
    path = _make_override_file(tmp_path, {
        "civilian1/player/3/5": {"glyph": 47, "accepted": True},
        "knight1/player/1/1": {"glyph": 92, "accepted": True},
        "civilian1/attack/0/0": {"glyph": 219, "accepted": True},
    })
    result = load_overrides(path, "civilian1", "player")
    assert list(result.keys()) == [(3, 5)]


def test_load_overrides_none_path_returns_empty():
    assert load_overrides(None, "civilian1", "player") == {}


def test_load_overrides_missing_file_returns_empty(tmp_path):
    missing = tmp_path / "does_not_exist.json"
    assert load_overrides(missing, "civilian1", "player") == {}


def test_load_overrides_malformed_json_warns_and_returns_empty(tmp_path):
    bad = tmp_path / "glyph_review_overrides.json"
    bad.write_text("not { valid")
    with pytest.warns(RuntimeWarning):
        result = load_overrides(bad, "civilian1", "player")
    assert result == {}


def test_assign_image_cells_accepted_override_bypasses_scoring():
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (12, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))
    image.alpha_composite(tile, (6, 0))

    # Override cell (0,0) with glyph=92 (backslash) and accepted=True
    overrides = {(0, 0): {"glyph": 92, "fg": [0, 0, 0], "bg": [180, 180, 180], "accepted": True}}
    cells = assign_image_cells(image, _config(), overrides=overrides)

    assert cells[0].x == 0
    assert cells[0].chosen.glyph == 92
    assert cells[0].needs_review is False
    assert cells[0].confidence == pytest.approx(1.0)
    # Cell (1,0) is unaffected — still scored normally as slash
    assert cells[1].chosen.glyph == 47


def test_assign_image_cells_accepted_override_ignores_semantic_bias():
    """A cell with accepted=True is not altered by semantic bias on rerun."""
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (12, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))
    image.alpha_composite(tile, (6, 0))

    overrides = {(0, 0): {"glyph": 92, "fg": [0, 0, 0], "bg": [180, 180, 180], "accepted": True}}
    # Bias that would prefer glyph 47 over 92 — must not affect the override cell
    config_with_bias = _config(
        semantic_bias={"face": {47: 1.0}},
        score_delta_threshold=1.0,
        candidate_limit=10,
    )
    cells = assign_image_cells(image, config_with_bias, overrides=overrides)

    assert cells[0].chosen.glyph == 92  # override preserved despite bias


def test_assign_image_cells_override_none_path_runs_normally():
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (6, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))

    cells = assign_image_cells(image, _config(), overrides=None)

    assert cells[0].chosen.glyph == 47


def test_assign_image_cells_accepted_override_missing_fg_falls_through_to_scoring(tmp_path):
    """F2: accepted override without fg/bg must not wipe colours; fall through instead."""
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (12, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))
    image.alpha_composite(tile, (6, 0))

    # Override cell (0,0) with glyph=92 but no fg → should fall through to normal scoring
    overrides = {(0, 0): {"glyph": 92, "accepted": True}}
    with pytest.warns(RuntimeWarning, match="missing fg or bg"):
        cells = assign_image_cells(image, _config(), overrides=overrides)

    # Cell (0,0) fell through and was scored normally (glyph 47, not 92)
    assert cells[0].chosen.glyph == 47
    # Cell (1,0) unaffected
    assert cells[1].chosen.glyph == 47


def test_assign_image_cells_accepted_override_missing_bg_falls_through_to_scoring(tmp_path):
    """F2: accepted override with glyph+fg but no bg → falls through to normal scoring."""
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (6, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))

    overrides = {(0, 0): {"glyph": 92, "fg": [255, 255, 255], "accepted": True}}
    with pytest.warns(RuntimeWarning, match="missing fg or bg"):
        cells = assign_image_cells(image, _config(), overrides=overrides)

    # Fell through to normal scoring
    assert cells[0].chosen.glyph == 47


def test_assign_image_cells_accepted_override_invalid_fg_skipped(tmp_path):
    """F3: non-3-element fg/bg arrays fail closed per cell."""
    tile = _tile_for_glyph(47)
    image = Image.new("RGBA", (6, 6), (0, 0, 0, 0))
    image.alpha_composite(tile, (0, 0))

    overrides = {(0, 0): {"glyph": 92, "fg": "#fff", "bg": (255, 0, 255), "accepted": True}}
    with pytest.warns(RuntimeWarning, match="missing fg or bg"):
        cells = assign_image_cells(image, _config(), overrides=overrides)

    # Fell through to normal scoring — no crash
    assert cells[0].chosen.glyph == 47


def test_load_overrides_skips_non_dict_records(tmp_path):
    """F3: non-dict records are warned and skipped, not stored for later crash."""
    import json as _json
    path = tmp_path / "glyph_review_overrides.json"
    path.write_text(_json.dumps({
        "civilian1/player/0/0": "not a dict",
        "civilian1/player/1/1": {"glyph": 47, "accepted": True},
    }))

    with pytest.warns(RuntimeWarning, match="not dict"):
        result = load_overrides(path, "civilian1", "player")

    assert (0, 0) not in result
    assert (1, 1) in result


# ---------------------------------------------------------------------------
# U4 — compact artifact and sheet summary tests
# ---------------------------------------------------------------------------

def _make_groups(cells_needs_review_flags: list[bool]) -> list[dict]:
    """Build a synthetic groups list for artifact tests."""
    cells = []
    for i, needs_review in enumerate(cells_needs_review_flags):
        cells.append({
            "x": i, "y": 0, "region": None,
            "chosen": {"glyph": 219 if not needs_review else 47, "fg": [0, 0, 0], "bg": [255, 0, 255],
                       "score": 0.9, "components": {"mask_iou": 0.9}, "reasons": ["test"]},
            "alternatives": [{"glyph": 32, "fg": [0, 0, 0], "bg": [0, 0, 0],
                               "score": 0.1, "components": {}, "reasons": []}],
            "confidence": 0.8 if not needs_review else 0.05,
            "needs_review": needs_review,
        })
    return [{"name": "civilian1", "family": "player", "cells": cells,
             "low_confidence_cells": sum(cells_needs_review_flags)}]


def test_write_suggestions_json_compact_strips_non_review_alternatives(tmp_path):
    groups = _make_groups([False, True])
    path = tmp_path / "suggestions.json"

    write_suggestions_json(path, groups, compact=True)

    data = json.loads(path.read_text())
    cells = data["groups"][0]["cells"]
    # needs_review=False cell has no alternatives
    assert "alternatives" not in cells[0]
    assert "components" not in cells[0]["chosen"]
    assert "reasons" not in cells[0]["chosen"]
    # needs_review=True cell retains all fields
    assert "alternatives" in cells[1]
    assert "components" in cells[1]["chosen"]


def test_write_suggestions_json_default_mode_is_not_compact(tmp_path):
    groups = _make_groups([False])
    path = tmp_path / "suggestions.json"

    write_suggestions_json(path, groups)

    data = json.loads(path.read_text())
    cells = data["groups"][0]["cells"]
    # Default keeps alternatives and components
    assert "alternatives" in cells[0]
    assert "components" in cells[0]["chosen"]


def test_write_suggestions_compact_convenience_wrapper(tmp_path):
    groups = _make_groups([False, False])
    path = tmp_path / "compact.json"

    write_suggestions_compact(path, groups)

    data = json.loads(path.read_text())
    for cell in data["groups"][0]["cells"]:
        assert "alternatives" not in cell


def test_write_suggestions_json_all_needs_review_same_as_full(tmp_path):
    groups = _make_groups([True, True])
    full_path = tmp_path / "full.json"
    compact_path = tmp_path / "compact.json"

    write_suggestions_json(full_path, groups)
    write_suggestions_compact(compact_path, groups)

    # When all cells need review, compact == full structurally
    full_data = json.loads(full_path.read_text())
    compact_data = json.loads(compact_path.read_text())
    assert full_data == compact_data


def test_write_suggestions_json_empty_groups(tmp_path):
    path = tmp_path / "empty.json"

    write_suggestions_json(path, [], compact=True)

    data = json.loads(path.read_text())
    assert data == {"groups": []}


def test_write_sheet_summary_has_required_fields(tmp_path):
    groups = _make_groups([False, False, True])
    path = tmp_path / "summary.json"

    write_sheet_summary(path, groups)

    data = json.loads(path.read_text())
    assert len(data["groups"]) == 1
    entry = data["groups"][0]
    assert entry["name"] == "civilian1"
    assert entry["family"] == "player"
    assert entry["cells_listed"] == 3
    assert entry["low_confidence_cells"] == 1
    assert entry["needs_review_cells"] == 1
    assert isinstance(entry["top_5_glyphs"], list)
    assert "confidence_p50" in entry
    assert "confidence_p90" in entry


def test_write_sheet_summary_empty_groups(tmp_path):
    path = tmp_path / "summary.json"

    write_sheet_summary(path, [])

    data = json.loads(path.read_text())
    assert data == {"groups": []}


def test_write_sheet_summary_empty_cells(tmp_path):
    groups = [{"name": "x", "family": "player", "cells": [], "low_confidence_cells": 0}]
    path = tmp_path / "summary.json"

    write_sheet_summary(path, groups)

    data = json.loads(path.read_text())
    assert data["groups"][0]["cells_listed"] == 0
    assert data["groups"][0]["confidence_p50"] == 0.0


# ---------------------------------------------------------------------------
# U1/U2 — build_regions_grid mirror coverage tests
# ---------------------------------------------------------------------------


def test_build_regions_grid_covers_mirrored_projection(tmp_path):
    """F1: semantic regions must apply to both source and mirrored halves."""
    import json as _json
    from scripts.convert_24px_mini_template_2x import build_regions_grid, FamilySpec

    maps = tmp_path / "semantic_maps"
    maps.mkdir()
    data = {
        "frame_w": 7,
        "frame_h": 10,
        "frames": {
            "0": {
                "angle": 0,
                "anim_index": 0,
                "regions": [{"name": "face", "bbox": [0, 0, 1, 2]}],
            },
            "1": {
                "angle": 0,
                "anim_index": 1,
                "regions": [{"name": "shirt", "bbox": [3, 4, 5, 6]}],
            },
        },
    }
    (maps / "player-test.json").write_text(_json.dumps(data))

    # family=player, cell_w=14, cell_h=20, anims=(1, 8) → total_frames=9
    spec = FamilySpec((1, 8), 14, 20)
    regions = build_regions_grid(maps, "player", spec)

    # Source half: anim_index=0, x_offset=0; anim_index=1, x_offset=14
    # face bbox [0,0,1,2] → min cell (0,0) in 2x space
    assert (0, 0) in regions  # face, source half, frame 0
    # shirt bbox [3,4,5,6] at anim_index=1 → min cell (14+6, 0+8) = (20,8)
    assert (20, 8) in regions  # shirt, source half, frame 1

    # Mirrored half: mirror offset = total_frames * cell_w = 9 * 14 = 126
    assert (126, 0) in regions  # face, mirrored half, frame 0
    assert (146, 8) in regions  # shirt, mirrored half, frame 1


def test_build_regions_grid_dimension_filtered_files_skipped(tmp_path):
    """Files whose frame_w doesn't divide evenly are skipped."""
    import json as _json
    from scripts.convert_24px_mini_template_2x import build_regions_grid, FamilySpec

    maps = tmp_path / "semantic_maps"
    maps.mkdir()
    # Bad file: frame_w=5 doesn't divide 14
    (maps / "player-bad.json").write_text(_json.dumps({
        "frame_w": 5, "frame_h": 10,
        "frames": {"0": {"angle": 0, "anim_index": 0,
                          "regions": [{"name": "face", "bbox": [0, 0, 1, 1]}]}},
    }))
    # Good file: frame_w=7 divides 14
    (maps / "player-good.json").write_text(_json.dumps({
        "frame_w": 7, "frame_h": 10,
        "frames": {"0": {"angle": 0, "anim_index": 0,
                          "regions": [{"name": "face", "bbox": [0, 0, 1, 1]}]}},
    }))

    spec = FamilySpec((1, 8), 14, 20)
    regions = build_regions_grid(maps, "player", spec)

    # Only the compatible file's regions appear
    assert any(v == "face" for v in regions.values())


def test_build_regions_grid_no_compatible_files_returns_empty(tmp_path):
    """Returns {} when no map files match the sprite dimensions."""
    import json as _json
    from scripts.convert_24px_mini_template_2x import build_regions_grid, FamilySpec

    maps = tmp_path / "semantic_maps"
    maps.mkdir()
    # All files have frame_w=5, but spec cell_w_chars=14 → 14 % 5 != 0 → skip
    (maps / "player-a.json").write_text(_json.dumps({
        "frame_w": 5, "frame_h": 10,
        "frames": {"0": {"angle": 0, "anim_index": 0,
                          "regions": [{"name": "face", "bbox": [0, 0, 1, 1]}]}},
    }))

    spec = FamilySpec((1, 8), 14, 20)
    regions = build_regions_grid(maps, "player", spec)

    assert regions == {}


def test_compact_file_smaller_than_full_when_majority_high_confidence(tmp_path):
    # 10 high-confidence cells, 1 low-confidence
    groups = _make_groups([False] * 10 + [True])
    full_path = tmp_path / "full.json"
    compact_path = tmp_path / "compact.json"

    write_suggestions_json(full_path, groups)
    write_suggestions_compact(compact_path, groups)

    assert compact_path.stat().st_size < full_path.stat().st_size
