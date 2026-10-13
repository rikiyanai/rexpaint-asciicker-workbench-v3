"""UQ-006: Source-wrapper manifest canonical owner.

Sidecar format: <source_path>.asciicker-source.json
Per canon spec §2.3.1–§2.3.3.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

# Manifest schema version this module writes
MANIFEST_VERSION = 1

# Valid presentation kinds (per canon §2.3.2 appearance ownership model)
VALID_PRESENTATION_KINDS = frozenset({"idle_walk", "attack", "plydie"})

# Valid layer_owner_kind values
VALID_LAYER_OWNER_KINDS = frozenset({"skin", "item", "mount"})

# Valid slot values
VALID_SLOTS = frozenset({
    "body",
    "hat",
    "armor", "chestplate",
    "mount_rear",
    "mount_front",
    "mount_composite",  # transitional — blocker text in blueprint
})


def manifest_path_for_source(source_path: Path | str) -> Path:
    """Derive the sidecar manifest path from a source PNG path.

    <source.png>.asciicker-source.json
    """
    p = Path(source_path)
    return p.with_suffix(p.suffix + ".asciicker-source.json")


def load_manifest(source_path: Path | str) -> dict[str, Any] | None:
    """Load a source manifest from its sidecar file.

    Returns None if the sidecar does not exist.
    Raises ValueError if the JSON is malformed.
    """
    mp = manifest_path_for_source(source_path)
    if not mp.exists():
        return None
    try:
        return json.loads(mp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Manifest {mp} is malformed JSON: {e}") from e


def save_manifest(
    source_path: Path | str,
    manifest: dict[str, Any],
    *,
    ack_stale_sha: bool = False,
) -> dict[str, Any]:
    """Atomically write a manifest to its sidecar file.

    Uses temp-file-then-rename for crash safety.
    Returns the written manifest dict.

    Raises ValueError if ack_stale_sha is False and the SHA256 is stale.
    """
    mp = manifest_path_for_source(source_path)
    source_png = Path(source_path)

    # Compute current source SHA
    current_sha = _sha256_file(source_png) if source_png.exists() else None

    # Check SHA stale
    stored_sha = manifest.get("source", {}).get("sha256")
    if current_sha and stored_sha and stored_sha != current_sha:
        if not ack_stale_sha:
            raise ValueError(
                f"Source SHA256 mismatch: stored={stored_sha}, current={current_sha}. "
                f"Use ack_stale_sha=True to overwrite anyway."
            )
        # Update SHA to current
        manifest.setdefault("source", {})["sha256"] = current_sha
    elif current_sha and not stored_sha:
        # Missing SHA — fill it in (WARN is for validation, not save blocking)
        manifest.setdefault("source", {})["sha256"] = current_sha

    # Ensure source metadata
    source_meta = manifest.setdefault("source", {})
    if "path" not in source_meta:
        source_meta["path"] = str(source_path)
    if not source_meta.get("image_w") and source_png.exists():
        from PIL import Image
        with Image.open(source_png) as im:
            source_meta["image_w"] = im.width
            source_meta["image_h"] = im.height

    # Set version
    manifest["version"] = MANIFEST_VERSION

    # Atomic write: temp file + rename
    mp.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        suffix=".json",
        prefix=".asciicker-source-",
        dir=str(mp.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        os.replace(tmp, str(mp))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    return manifest


def validate_manifest(
    manifest: dict[str, Any],
    source_png_path: Path | str,
    *,
    ack_stale_sha: bool = False,
) -> dict[str, Any]:
    """Validate a manifest against the canon §2.3.2 contract.

    Returns:
        {
            "status": "PASS" | "WARN" | "FAIL",
            "errors": [str, ...],
            "warnings": [str, ...],
            "sha256": {"stored": str|None, "current": str|None, "match": bool}
        }
    """
    errors: list[str] = []
    warnings: list[str] = []
    source_png = Path(source_png_path)

    # --- Source metadata ---
    source_meta = manifest.get("source")
    if not isinstance(source_meta, dict):
        errors.append("manifest.source must be an object")
        source_meta = {}

    version = manifest.get("version")
    if not isinstance(version, int) or version < 1:
        errors.append("manifest.version must be an integer >= 1")

    # Source path
    if not source_meta.get("path"):
        errors.append("manifest.source.path is missing")

    # Image dimensions
    image_w = source_meta.get("image_w")
    image_h = source_meta.get("image_h")
    if not isinstance(image_w, int) or image_w < 1:
        errors.append("manifest.source.image_w must be a positive integer")
    if not isinstance(image_h, int) or image_h < 1:
        errors.append("manifest.source.image_h must be a positive integer")

    # SHA256
    stored_sha = source_meta.get("sha256")
    current_sha = _sha256_file(source_png) if source_png.exists() else None
    sha_info = {
        "stored": stored_sha or None,
        "current": current_sha,
        "match": stored_sha == current_sha if stored_sha and current_sha else None,
    }

    if not stored_sha:
        warnings.append("manifest.source.sha256 is null or missing — will be WARN until computed")
    elif stored_sha and current_sha and stored_sha != current_sha:
        if ack_stale_sha:
            warnings.append(f"Source SHA256 mismatch acknowledged: stored={stored_sha[:16]}..., current={current_sha[:16]}...")
        else:
            errors.append(
                f"Source SHA256 mismatch: stored={stored_sha[:16]}..., current={current_sha[:16]}... "
                f"Use ack_stale_sha=True to acknowledge."
            )

    # --- Blueprint key ---
    blueprint_key = manifest.get("bundle_blueprint_key")
    if not blueprint_key or not isinstance(blueprint_key, str):
        errors.append("manifest.bundle_blueprint_key is missing or empty")
    else:
        # Defer blueprint resolution to caller — validate_manifest is a pure
        # structural check; blueprint validity is checked by materialize.
        pass

    # --- Layout mode ---
    layout_mode = manifest.get("layout_mode")
    if layout_mode not in ("uniform_grid", "explicit_regions"):
        errors.append(f"manifest.layout_mode must be 'uniform_grid' or 'explicit_regions', got {layout_mode!r}")

    # --- Layout ---
    layout = manifest.get("layout")
    if not isinstance(layout, dict):
        errors.append("manifest.layout must be an object")
        layout = {}

    # --- Regions ---
    regions = manifest.get("regions")
    if not isinstance(regions, list):
        errors.append("manifest.regions must be an array")
        regions = []

    # Validate each region
    seen_targets: set[tuple] = set()
    for i, region in enumerate(regions):
        if not isinstance(region, dict):
            errors.append(f"regions[{i}] must be an object")
            continue

        # Region ID
        rid = region.get("id")
        if not rid or not isinstance(rid, str):
            errors.append(f"regions[{i}].id must be a non-empty string")

        # Source rect
        rect = region.get("source_rect")
        if not isinstance(rect, list) or len(rect) != 4:
            errors.append(f"regions[{i}] ({rid or '?'}).source_rect must be [x, y, w, h]")
        elif isinstance(image_w, int) and isinstance(image_h, int) and image_w > 0 and image_h > 0:
            rx, ry, rw, rh = int(rect[0]), int(rect[1]), int(rect[2]), int(rect[3])
            if rx < 0 or ry < 0:
                errors.append(f"regions[{i}] ({rid}).source_rect origin ({rx},{ry}) is negative")
            if rx + rw > image_w:
                errors.append(f"regions[{i}] ({rid}).source_rect x+w ({rx}+{rw}) exceeds image_w ({image_w})")
            if ry + rh > image_h:
                errors.append(f"regions[{i}] ({rid}).source_rect y+h ({ry}+{rh}) exceeds image_h ({image_h})")

        # Target
        target = region.get("target")
        if not isinstance(target, dict):
            errors.append(f"regions[{i}] ({rid or '?'}).target must be an object")
            continue

        # Required target fields
        for field in (
            "entity_key", "character_key", "presentation_kind",
            "layer_owner_kind", "slot", "presentation_target_key",
            "angle", "frame", "projection",
        ):
            if field not in target:
                errors.append(f"regions[{i}] ({rid}).target.{field} is missing")

        # Validate presentation_kind
        pk = target.get("presentation_kind")
        if pk and pk not in VALID_PRESENTATION_KINDS:
            errors.append(
                f"regions[{i}] ({rid}).target.presentation_kind={pk!r} is not valid. "
                f"Must be one of: {sorted(VALID_PRESENTATION_KINDS)}"
            )

        # Validate layer_owner_kind
        lok = target.get("layer_owner_kind")
        if lok and lok not in VALID_LAYER_OWNER_KINDS:
            errors.append(
                f"regions[{i}] ({rid}).target.layer_owner_kind={lok!r} is not valid. "
                f"Must be one of: {sorted(VALID_LAYER_OWNER_KINDS)}"
            )

        # Validate slot
        slot = target.get("slot")
        if slot and slot not in VALID_SLOTS:
            errors.append(
                f"regions[{i}] ({rid}).target.slot={slot!r} is not valid. "
                f"Must be one of: {sorted(VALID_SLOTS)}"
            )

        # Appearance ownership hierarchy: no flattened targets
        if lok == "item" and target.get("character_key") and target.get("character_key") != target.get("entity_key"):
            # Wearable must be item-owned, attached to a character, not claiming to own the character
            pass  # OK — wearable has its own owner but belongs to character

        if lok == "mount" and slot not in ("mount_rear", "mount_front", "mount_composite"):
            errors.append(
                f"regions[{i}] ({rid}): mount layer_owner_kind requires slot in "
                f"(mount_rear, mount_front, mount_composite), got {slot!r}"
            )

        # Duplicate target tuple check
        if all(k in target for k in ("entity_key", "character_key", "presentation_kind",
                                       "layer_owner_kind", "slot", "presentation_target_key",
                                       "angle", "frame", "projection")):
            tup = (
                target["entity_key"],
                target["character_key"],
                target["presentation_kind"],
                target["layer_owner_kind"],
                target["slot"],
                target["presentation_target_key"],
                int(target["angle"]),
                int(target["frame"]),
                int(target["projection"]),
            )
            if tup in seen_targets:
                errors.append(
                    f"regions[{i}] ({rid}): duplicate target tuple "
                    f"(entity={tup[0]}, char={tup[1]}, pres={tup[2]}, "
                    f"owner={tup[3]}, slot={tup[4]}, target={tup[5]}, "
                    f"angle={tup[6]}, frame={tup[7]}, proj={tup[8]})"
                )
            seen_targets.add(tup)

    # --- Determine status ---
    if errors:
        status = "FAIL"
    elif warnings:
        status = "WARN"
    else:
        status = "PASS"

    return {
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "sha256": sha_info,
    }


def materialize_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Derive mirror state from a manifest.

    Returns:
        {
            "source_boxes": [...],
            "source_cuts_v": [...],
            "source_cuts_h": [...],
            "source_anchor_box": null,
            "source_draft_box": null,
        }

    Uses the blueprint registry internally to load geometry.
    Regions produce labeled boxes; guides produce editorial overlays.
    """
    from .service import resolve_blueprint_angles_frames_projs

    blueprint_key = manifest.get("bundle_blueprint_key", "")
    regions = manifest.get("regions", [])
    guides = manifest.get("guides", {})

    source_boxes: list[dict[str, Any]] = []
    source_cuts_v: list[dict[str, Any]] = []
    source_cuts_h: list[dict[str, Any]] = []

    next_id = 1

    # Materialize regions as labeled boxes
    for region in regions:
        if not isinstance(region, dict):
            continue
        rect = region.get("source_rect")
        if not isinstance(rect, list) or len(rect) != 4:
            continue
        target = region.get("target") or {}
        rid = region.get("id", "?")

        # Resolve geometry from blueprint
        try:
            action_key = target.get("presentation_kind", "")
            # Map presentation_kind back to action_key for registry lookup
            registry_action_key = _presentation_kind_to_action_key(
                action_key, blueprint_key
            )
            if registry_action_key:
                geo = resolve_blueprint_angles_frames_projs(blueprint_key, registry_action_key)
            else:
                geo = {}
        except Exception:
            geo = {}

        label = target.get("presentation_target_key", rid)
        source_boxes.append({
            "id": next_id,
            "x": int(rect[0]),
            "y": int(rect[1]),
            "w": int(rect[2]),
            "h": int(rect[3]),
            "label": str(label),
            "source": "manifest_region",
            "region_id": rid,
            "color": _region_color(target),
            **{k: v for k, v in geo.items()},
        })
        next_id += 1

    # Materialize detected boxes from guides
    detected = guides.get("detected_boxes", [])
    if isinstance(detected, list):
        for box in detected:
            if not isinstance(box, dict):
                continue
            source_boxes.append({
                "id": next_id,
                "x": int(box.get("x", 0)),
                "y": int(box.get("y", 0)),
                "w": int(box.get("w", 0)),
                "h": int(box.get("h", 0)),
                "label": str(box.get("label", f"detected_{next_id}")),
                "source": "guide_detected",
            })
            next_id += 1

    # Materialize cuts from guides
    cuts_v = guides.get("cuts_v", [])
    if isinstance(cuts_v, list):
        for cut in cuts_v:
            if isinstance(cut, dict):
                source_cuts_v.append({
                    "id": next_id,
                    "x": int(cut.get("x", 0)),
                })
            elif isinstance(cut, (int, float)):
                source_cuts_v.append({
                    "id": next_id,
                    "x": int(cut),
                })
            next_id += 1

    cuts_h = guides.get("cuts_h", [])
    if isinstance(cuts_h, list):
        for cut in cuts_h:
            if isinstance(cut, dict):
                source_cuts_h.append({
                    "id": next_id,
                    "y": int(cut.get("y", 0)),
                })
            elif isinstance(cut, (int, float)):
                source_cuts_h.append({
                    "id": next_id,
                    "y": int(cut),
                })
            next_id += 1

    # Anchor box from guides
    anchor_box = None
    anchor_rect = guides.get("anchor_rect")
    if isinstance(anchor_rect, list) and len(anchor_rect) == 4:
        anchor_box = {
            "x": int(anchor_rect[0]),
            "y": int(anchor_rect[1]),
            "w": int(anchor_rect[2]),
            "h": int(anchor_rect[3]),
        }

    return {
        "source_boxes": source_boxes,
        "source_cuts_v": source_cuts_v,
        "source_cuts_h": source_cuts_h,
        "source_anchor_box": anchor_box,
        "source_draft_box": None,
    }


def create_migration_manifest(
    session: dict[str, Any],
    source_png_path: Path | str,
    *,
    blueprint_key: str = "",
) -> dict[str, Any]:
    """Create an initial manifest from a legacy session's source arrays.

    All boxes go into guides.detected_boxes (not regions[]) since target
    assignments are unknown. Boxes with labels matching known presentation
    target keys are auto-assigned into regions[] with best-guess angle/frame.

    If source_png exists, SHA256 is computed and stored.
    """
    source_png = Path(source_png_path)
    current_sha = _sha256_file(source_png) if source_png.exists() else None
    image_w = 0
    image_h = 0
    if source_png.exists():
        try:
            from PIL import Image
            with Image.open(source_png) as im:
                image_w = im.width
                image_h = im.height
        except Exception:
            pass

    source_boxes = session.get("source_boxes", [])
    source_cuts_v = session.get("source_cuts_v", [])
    source_cuts_h = session.get("source_cuts_h", [])

    detected_boxes: list[dict[str, Any]] = []
    regions: list[dict[str, Any]] = []
    rid_counter = 1

    if isinstance(source_boxes, list):
        for box in source_boxes:
            if not isinstance(box, dict):
                continue
            label = str(box.get("label", "")).strip()
            box_source = str(box.get("source", "")).strip()

            # Auto-assign if label matches a known target pattern
            if label and box_source != "auto":
                # Heuristic: try to auto-assign labeled boxes
                auto_target = _try_auto_assign_target(label, blueprint_key)
                if auto_target:
                    regions.append({
                        "id": f"r{rid_counter}",
                        "source_rect": [
                            int(box.get("x", 0)),
                            int(box.get("y", 0)),
                            int(box.get("w", 0)),
                            int(box.get("h", 0)),
                        ],
                        "target": auto_target,
                        "notes": f"Auto-migrated from labeled box '{label}'",
                        "tags": ["migrated"],
                        "confidence": 0.7,
                    })
                    rid_counter += 1
                    continue

            # Otherwise, put in detected_boxes
            detected_boxes.append({
                "x": int(box.get("x", 0)),
                "y": int(box.get("y", 0)),
                "w": int(box.get("w", 0)),
                "h": int(box.get("h", 0)),
                "label": label,
            })

    # Preserve cuts
    cuts_v_objects: list[dict[str, Any]] = []
    cut_id = 1
    if isinstance(source_cuts_v, list):
        for cut in source_cuts_v:
            if isinstance(cut, dict):
                cuts_v_objects.append({"id": f"cv{cut_id}", "x": int(cut.get("x", 0))})
            elif isinstance(cut, (int, float)):
                cuts_v_objects.append({"id": f"cv{cut_id}", "x": int(cut)})
            cut_id += 1

    cuts_h_objects: list[dict[str, Any]] = []
    cut_id = 1
    if isinstance(source_cuts_h, list):
        for cut in source_cuts_h:
            if isinstance(cut, dict):
                cuts_h_objects.append({"id": f"ch{cut_id}", "y": int(cut.get("y", 0))})
            elif isinstance(cut, (int, float)):
                cuts_h_objects.append({"id": f"ch{cut_id}", "y": int(cut)})
            cut_id += 1

    manifest: dict[str, Any] = {
        "version": MANIFEST_VERSION,
        "source": {
            "path": str(source_png),
            "sha256": current_sha,
            "image_w": image_w,
            "image_h": image_h,
        },
        "bundle_blueprint_key": blueprint_key,
        "layout_mode": "explicit_regions",
        "layout": {
            "angles": 8,
            "frames": 1,
            "source_projs": 1,
            "angle_labels": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
        },
        "guides": {
            "anchor_rect": None,
            "cuts_v": cuts_v_objects,
            "cuts_h": cuts_h_objects,
            "detected_boxes": detected_boxes,
        },
        "regions": regions,
    }
    return manifest


# ── Internal helpers ──


def _sha256_file(path: Path) -> str | None:
    """Compute hex SHA256 of a file. Returns None if file doesn't exist."""
    if not path.exists():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _presentation_kind_to_action_key(presentation_kind: str, blueprint_key: str) -> str | None:
    """Map presentation_kind back to an action_key for blueprint geometry lookup.

    This is the reverse of the blueprint bridge normalization.
    """
    # Common mappings
    pk = presentation_kind
    if pk == "idle_walk":
        if "mounted" in (blueprint_key or ""):
            return "mounted_idle"
        return "idle"
    if pk == "attack":
        if "mounted" in (blueprint_key or ""):
            return "mounted_attack"
        return "attack"
    if pk == "plydie":
        return "death"
    return None


def _region_color(target: dict[str, Any]) -> str:
    """Derive an editor color from region target metadata."""
    pk = target.get("presentation_kind", "")
    if pk == "idle_walk":
        return "#4CAF50"  # green
    if pk == "attack":
        return "#F44336"  # red
    if pk == "plydie":
        return "#9C27B0"  # purple
    return "#2196F3"  # blue default


def _try_auto_assign_target(label: str, blueprint_key: str) -> dict[str, Any] | None:
    """Try to auto-assign a label to a manifest target.

    Only works when the label matches a known pattern.
    Returns None if no auto-assignment possible.
    """
    if not label or not blueprint_key:
        return None

    # Known patterns from the template registry
    known_labels: dict[str, dict[str, Any]] = {
        "player_idle_walk_body": {
            "entity_key": "player_actor",
            "character_key": "human_player",
            "presentation_kind": "idle_walk",
            "layer_owner_kind": "skin",
            "slot": "body",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
        "player_attack_body": {
            "entity_key": "player_actor",
            "character_key": "human_player",
            "presentation_kind": "attack",
            "layer_owner_kind": "skin",
            "slot": "body",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
        "player_plydie_body": {
            "entity_key": "player_actor",
            "character_key": "human_player",
            "presentation_kind": "plydie",
            "layer_owner_kind": "skin",
            "slot": "body",
            "angle": 0,
            "frame": 0,
            "projection": 0,
        },
    }

    if label in known_labels:
        target = dict(known_labels[label])
        target["presentation_target_key"] = label
        return target

    return None
