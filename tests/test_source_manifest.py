"""UQ-006: Source manifest unit tests — backend sidecar plumbing (S2-R5)."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from PIL import Image

from pipeline_v2.source_manifest import (
    MANIFEST_VERSION,
    create_migration_manifest,
    load_manifest,
    manifest_path_for_source,
    materialize_manifest,
    save_manifest,
    validate_manifest,
)


# ── Helpers ──


def _make_test_png(path: Path, width: int = 252, height: int = 200) -> str:
    """Create a small test PNG and return its hex SHA256."""
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    im.save(path, "PNG")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _minimal_manifest(sha: str | None = None, image_w: int = 252, image_h: int = 200) -> dict:
    return {
        "version": 1,
        "source": {
            "path": "test.png",
            "sha256": sha,
            "image_w": image_w,
            "image_h": image_h,
        },
        "bundle_blueprint_key": "player_native_full",
        "layout_mode": "explicit_regions",
        "layout": {
            "angles": 8,
            "frames": 8,
            "source_projs": 1,
            "angle_labels": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
        },
        "guides": {
            "anchor_rect": None,
            "cuts_v": [],
            "cuts_h": [],
            "detected_boxes": [],
        },
        "regions": [
            {
                "id": "r1",
                "source_rect": [0, 0, 30, 25],
                "target": {
                    "entity_key": "player_actor",
                    "character_key": "human_player",
                    "presentation_kind": "idle_walk",
                    "layer_owner_kind": "skin",
                    "slot": "body",
                    "presentation_target_key": "player_idle_walk_body",
                    "angle": 0,
                    "frame": 0,
                    "projection": 0,
                },
                "notes": "",
                "tags": [],
                "confidence": 1.0,
            }
        ],
    }


# ── Path derivation ──


def test_manifest_path_for_source():
    assert manifest_path_for_source("foo.png") == Path("foo.png.asciicker-source.json")
    assert manifest_path_for_source(Path("/a/b/c.png")) == Path("/a/b/c.png.asciicker-source.json")


# ── Load / Save round-trip ──


def test_load_manifest_nonexistent():
    assert load_manifest("/nonexistent/path.png") is None


def test_save_and_load_round_trip(tmp_path):
    png = tmp_path / "test.png"
    sha = _make_test_png(png)
    manifest = _minimal_manifest(sha=sha)

    saved = save_manifest(png, manifest)
    assert saved["source"]["sha256"] == sha

    loaded = load_manifest(png)
    assert loaded is not None
    assert loaded["version"] == 1
    assert loaded["regions"][0]["id"] == "r1"

    # Verify sidecar file exists
    assert manifest_path_for_source(png).exists()


def test_save_manifest_fills_missing_sha(tmp_path):
    png = tmp_path / "test.png"
    sha = _make_test_png(png)
    manifest = _minimal_manifest(sha=None)  # Missing SHA

    saved = save_manifest(png, manifest)
    assert saved["source"]["sha256"] == sha  # Auto-filled


def test_save_manifest_rejects_stale_sha(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest(sha="0" * 64)  # Wrong SHA

    with pytest.raises(ValueError, match="SHA256 mismatch"):
        save_manifest(png, manifest)

    # Should succeed with ack
    saved = save_manifest(png, manifest, ack_stale_sha=True)
    assert saved["source"]["sha256"] != "0" * 64  # Updated


def test_save_manifest_fills_image_dims(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png, width=100, height=50)
    manifest = _minimal_manifest()
    del manifest["source"]["image_w"]
    del manifest["source"]["image_h"]

    saved = save_manifest(png, manifest)
    assert saved["source"]["image_w"] == 100
    assert saved["source"]["image_h"] == 50


def test_save_manifest_atomic(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()

    save_manifest(png, manifest)

    # The sidecar should be a complete JSON file, not a temp file
    mp = manifest_path_for_source(png)
    content = mp.read_text()
    parsed = json.loads(content)
    assert parsed["version"] == 1

    # No temp files should be left behind
    temps = list(tmp_path.glob(".asciicker-source-*"))
    assert len(temps) == 0


# ── Validate ──


def test_validate_happy_path(tmp_path):
    png = tmp_path / "test.png"
    sha = _make_test_png(png)
    manifest = _minimal_manifest(sha=sha)

    result = validate_manifest(manifest, png)
    assert result["status"] == "PASS"
    assert result["errors"] == []
    assert result["warnings"] == []
    assert result["sha256"]["match"] is True


def test_validate_missing_sha(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest(sha=None)

    result = validate_manifest(manifest, png)
    assert result["status"] == "WARN"
    assert any("null or missing" in w for w in result["warnings"])


def test_validate_sha_mismatch_fail(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest(sha="0" * 64)

    result = validate_manifest(manifest, png)
    assert result["status"] == "FAIL"
    assert any("SHA256 mismatch" in e for e in result["errors"])


def test_validate_sha_mismatch_ack_warns(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest(sha="0" * 64)

    result = validate_manifest(manifest, png, ack_stale_sha=True)
    # Should be WARN or PASS (not FAIL since acked)
    assert result["status"] != "FAIL"
    assert any("acknowledged" in w for w in result["warnings"])


def test_validate_missing_version(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    del manifest["version"]

    result = validate_manifest(manifest, png)
    assert any("version" in e for e in result["errors"])


def test_validate_bad_layout_mode(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["layout_mode"] = "bad_mode"

    result = validate_manifest(manifest, png)
    assert any("layout_mode" in e for e in result["errors"])


def test_validate_region_out_of_bounds(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png, width=100, height=100)
    manifest = _minimal_manifest(sha=_sha256_file(png), image_w=100, image_h=100)
    manifest["regions"][0]["source_rect"] = [0, 0, 200, 25]  # x+w exceeds image_w

    result = validate_manifest(manifest, png)
    assert any("exceeds image_w" in e for e in result["errors"])


def test_validate_region_negative_origin(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"][0]["source_rect"] = [-5, 0, 30, 25]

    result = validate_manifest(manifest, png)
    assert any("negative" in e for e in result["errors"])


def test_validate_duplicate_target_tuple(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    # Add a second region with same target tuple
    manifest["regions"].append({
        "id": "r2",
        "source_rect": [30, 0, 30, 25],
        "target": {
            "entity_key": "player_actor",
            "character_key": "human_player",
            "presentation_kind": "idle_walk",
            "layer_owner_kind": "skin",
            "slot": "body",
            "presentation_target_key": "player_idle_walk_body",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
    })

    result = validate_manifest(manifest, png)
    assert any("duplicate target" in e for e in result["errors"])


def test_validate_missing_target_field(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    del manifest["regions"][0]["target"]["entity_key"]

    result = validate_manifest(manifest, png)
    assert any("entity_key" in e for e in result["errors"])


def test_validate_invalid_presentation_kind(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"][0]["target"]["presentation_kind"] = "dance"

    result = validate_manifest(manifest, png)
    assert any("presentation_kind" in e for e in result["errors"])


def test_validate_invalid_layer_owner_kind(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"][0]["target"]["layer_owner_kind"] = "weapon"

    result = validate_manifest(manifest, png)
    assert any("layer_owner_kind" in e for e in result["errors"])


def test_validate_invalid_slot(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"][0]["target"]["slot"] = "legs"

    result = validate_manifest(manifest, png)
    assert any("slot" in e for e in result["errors"])


def test_validate_missing_source_object(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    del manifest["source"]

    result = validate_manifest(manifest, png)
    assert any("manifest.source" in e for e in result["errors"])


# ── Materialize ──


def test_materialize_empty_manifest():
    manifest = _minimal_manifest()
    manifest["regions"] = []
    manifest["guides"] = {}

    result = materialize_manifest(manifest)
    assert result["source_boxes"] == []
    assert result["source_cuts_v"] == []
    assert result["source_cuts_h"] == []
    assert result["source_anchor_box"] is None


def test_materialize_regions(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"] = [
        {
            "id": "r1",
            "source_rect": [10, 20, 30, 25],
            "target": {
                "entity_key": "player_actor",
                "character_key": "human_player",
                "presentation_kind": "idle_walk",
                "layer_owner_kind": "skin",
                "slot": "body",
                "presentation_target_key": "player_idle_body",
                "angle": 0,
                "frame": 0,
                "projection": 0,
            },
        }
    ]

    result = materialize_manifest(manifest)
    assert len(result["source_boxes"]) == 1
    box = result["source_boxes"][0]
    assert box["x"] == 10
    assert box["y"] == 20
    assert box["w"] == 30
    assert box["h"] == 25
    assert box["source"] == "manifest_region"
    assert isinstance(box["id"], int) and box["id"] > 0


def test_materialize_detected_boxes():
    manifest = _minimal_manifest()
    manifest["regions"] = []
    manifest["guides"] = {
        "detected_boxes": [
            {"x": 0, "y": 0, "w": 10, "h": 10, "label": "auto_1"},
            {"x": 20, "y": 30, "w": 15, "h": 20, "label": "auto_2"},
        ]
    }

    result = materialize_manifest(manifest)
    assert len(result["source_boxes"]) == 2
    assert result["source_boxes"][0]["source"] == "guide_detected"
    assert result["source_boxes"][1]["label"] == "auto_2"


def test_materialize_cuts():
    manifest = _minimal_manifest()
    manifest["regions"] = []
    manifest["guides"] = {
        "cuts_v": [{"id": "cv1", "x": 100}, {"x": 200}],
        "cuts_h": [{"y": 50}, 75],
    }

    result = materialize_manifest(manifest)
    assert len(result["source_cuts_v"]) == 2
    assert result["source_cuts_v"][0]["x"] == 100
    assert result["source_cuts_v"][1]["x"] == 200
    assert len(result["source_cuts_h"]) == 2
    assert result["source_cuts_h"][0]["y"] == 50
    assert result["source_cuts_h"][1]["y"] == 75


def test_materialize_anchor_box():
    manifest = _minimal_manifest()
    manifest["regions"] = []
    manifest["guides"] = {
        "anchor_rect": [5, 10, 100, 80],
    }

    result = materialize_manifest(manifest)
    assert result["source_anchor_box"] == {"x": 5, "y": 10, "w": 100, "h": 80}


# ── Migration ──


def test_create_migration_manifest_from_session(tmp_path):
    png = tmp_path / "test.png"
    sha = _make_test_png(png)

    session = {
        "source_boxes": [
            {"x": 0, "y": 0, "w": 30, "h": 25, "label": "player_idle_walk_body", "source": "manual"},
            {"x": 40, "y": 0, "w": 35, "h": 30, "label": "", "source": "auto"},
        ],
        "source_cuts_v": [{"x": 30}, {"x": 75}],
        "source_cuts_h": [{"y": 25}],
    }

    manifest = create_migration_manifest(session, png, blueprint_key="player_native_full")
    assert manifest["version"] == 1
    assert manifest["source"]["sha256"] == sha

    # Labeled box should be auto-assigned to regions
    assert len(manifest["regions"]) >= 1
    region = manifest["regions"][0]
    assert region["target"]["presentation_target_key"] == "player_idle_walk_body"

    # Unlabeled "auto" box should go to detected_boxes
    detected = manifest["guides"]["detected_boxes"]
    assert len(detected) >= 1

    # Cuts should be preserved with IDs
    assert len(manifest["guides"]["cuts_v"]) == 2
    assert manifest["guides"]["cuts_v"][0]["x"] == 30


def test_create_migration_manifest_no_png(tmp_path):
    png = tmp_path / "nonexistent.png"
    session = {"source_boxes": [], "source_cuts_v": [], "source_cuts_h": []}

    manifest = create_migration_manifest(session, png)
    assert manifest["source"]["sha256"] is None
    assert manifest["source"]["image_w"] == 0


def test_create_migration_manifest_scalar_cuts(tmp_path):
    """Scalar cuts (int/float instead of dict) are preserved with generated IDs."""
    png = tmp_path / "test.png"
    _make_test_png(png)

    session = {
        "source_boxes": [],
        "source_cuts_v": [100, 200],
        "source_cuts_h": [50],
    }

    manifest = create_migration_manifest(session, png)
    assert len(manifest["guides"]["cuts_v"]) == 2
    assert manifest["guides"]["cuts_v"][0]["x"] == 100
    assert manifest["guides"]["cuts_v"][0]["id"] == "cv1"
    assert len(manifest["guides"]["cuts_h"]) == 1
    assert manifest["guides"]["cuts_h"][0]["y"] == 50
    assert manifest["guides"]["cuts_h"][0]["id"] == "ch1"


# ── Validation edge cases ──


def test_validate_empty_regions_array(tmp_path):
    png = tmp_path / "test.png"
    sha = _make_test_png(png)
    manifest = _minimal_manifest(sha=sha)
    manifest["regions"] = []

    result = validate_manifest(manifest, png)
    assert result["status"] == "PASS"  # Empty regions with valid SHA is PASS


def test_validate_missing_regions(tmp_path):
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    del manifest["regions"]

    result = validate_manifest(manifest, png)
    assert any("regions" in e for e in result["errors"])


def test_validate_manifest_with_wearable_target(tmp_path):
    """Wearable target with item layer_owner_kind and hat slot should be valid."""
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"].append({
        "id": "r2",
        "source_rect": [30, 0, 20, 20],
        "target": {
            "entity_key": "player_actor",
            "character_key": "human_player",
            "presentation_kind": "idle_walk",
            "layer_owner_kind": "item",
            "slot": "hat",
            "presentation_target_key": "player_idle_hat",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
    })

    result = validate_manifest(manifest, png)
    # Should pass — wearable target is valid per hierarchy
    assert result["status"] != "FAIL"
    # But may have WARN since wearable authoring is future-scope
    # (no errors expected for valid hierarchy)


def test_validate_manifest_with_mount_target(tmp_path):
    """Mount target with proper slot should be valid."""
    png = tmp_path / "test.png"
    _make_test_png(png)
    manifest = _minimal_manifest()
    manifest["regions"].append({
        "id": "r2",
        "source_rect": [30, 0, 20, 20],
        "target": {
            "entity_key": "mounted_actor",
            "character_key": "human_player",
            "presentation_kind": "idle_walk",
            "layer_owner_kind": "mount",
            "slot": "mount_rear",
            "presentation_target_key": "wolfie_mounted_idle_body",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
    })

    result = validate_manifest(manifest, png)
    assert result["status"] != "FAIL"


# ── Helpers ──


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
