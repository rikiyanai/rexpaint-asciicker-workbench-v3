"""ActorVisualProfile data structures for pipeline-v3.

This module defines the bridge object between authored XP content and compiled
RenderPlan rows. The ActorVisualProfile captures:
- What layers exist
- What slots they fill  
- What visual key dimensions (variation, mount state) they cover

Schema reference: config/actor_visual_profile_schema.json
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal


# ── Type aliases ─────────────────────────────────────────────────────────────

PresentationKind = Literal["idle_walk", "attack", "plydie"]
Domain = Literal["skin", "wearable", "weapon", "shield", "mount"]
Slot = Literal["body", "head", "chest", "weapon", "shield", "mount_rear", "mount_rider", "mount_front", "armor"]


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class Region:
    """Cell region within an XP sheet."""
    x: int  # Left cell coordinate
    y: int  # Top cell coordinate
    w: int  # Width in cells
    h: int  # Height in cells

    def to_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Region:
        return cls(
            x=int(data["x"]),
            y=int(data["y"]),
            w=int(data["w"]),
            h=int(data["h"]),
        )


@dataclass
class LayerAssignment:
    """A single layer assignment within an ActorVisualProfile."""
    slot: Slot
    layer_definition_id: int
    xp_ref: str  # Path to XP file for this layer
    visual_style_id: int | None = None  # Color lane (default/gold/dark)
    item_definition_id: int | None = None  # For wearables/weapons
    region: Region | None = None  # Cell region within XP sheet

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "slot": self.slot,
            "layer_definition_id": self.layer_definition_id,
            "xp_ref": self.xp_ref,
        }
        if self.visual_style_id is not None:
            result["visual_style_id"] = self.visual_style_id
        if self.item_definition_id is not None:
            result["item_definition_id"] = self.item_definition_id
        if self.region is not None:
            result["region"] = self.region.to_dict()
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LayerAssignment:
        return cls(
            slot=data["slot"],
            layer_definition_id=int(data["layer_definition_id"]),
            xp_ref=data["xp_ref"],
            visual_style_id=data.get("visual_style_id"),
            item_definition_id=data.get("item_definition_id"),
            region=Region.from_dict(data["region"]) if data.get("region") else None,
        )


@dataclass
class MountComposition:
    """Mount rear/rider/front layer split for mounted presentations."""
    mount_definition_id: int
    rear_layer_index: int  # Index into layers[] array
    rider_layer_index: int  # Index into layers[] array
    front_layer_index: int | None = None  # Optional (e.g., weapon)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "mount_definition_id": self.mount_definition_id,
            "rear_layer_index": self.rear_layer_index,
            "rider_layer_index": self.rider_layer_index,
        }
        if self.front_layer_index is not None:
            result["front_layer_index"] = self.front_layer_index
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MountComposition:
        return cls(
            mount_definition_id=int(data["mount_definition_id"]),
            rear_layer_index=int(data["rear_layer_index"]),
            rider_layer_index=int(data["rider_layer_index"]),
            front_layer_index=data.get("front_layer_index"),
        )


@dataclass
class SourceRefs:
    """References to source XP/PNG assets and semantic maps."""
    xp_file: str | None = None  # Path to source .xp file
    png_file: str | None = None  # Path to source .png file
    semantic_map: str | None = None  # Path to semantic map JSON
    calibration_artifact: str | None = None  # Path to mounted calibration artifact

    def to_dict(self) -> dict[str, str | None]:
        return {
            "xp_file": self.xp_file,
            "png_file": self.png_file,
            "semantic_map": self.semantic_map,
            "calibration_artifact": self.calibration_artifact,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SourceRefs:
        return cls(
            xp_file=data.get("xp_file"),
            png_file=data.get("png_file"),
            semantic_map=data.get("semantic_map"),
            calibration_artifact=data.get("calibration_artifact"),
        )


@dataclass
class QualityGates:
    """Quality gate results from pipeline-v3 validation."""
    G7_cell_density: bool | None = None
    G8_glyph_coverage: bool | None = None
    G9_semantic_completeness: bool | None = None
    mounted_alignment: bool | None = None
    timestamp: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "G7_cell_density": self.G7_cell_density,
            "G8_glyph_coverage": self.G8_glyph_coverage,
            "G9_semantic_completeness": self.G9_semantic_completeness,
            "mounted_alignment": self.mounted_alignment,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> QualityGates:
        return cls(
            G7_cell_density=data.get("G7_cell_density"),
            G8_glyph_coverage=data.get("G8_glyph_coverage"),
            G9_semantic_completeness=data.get("G9_semantic_completeness"),
            mounted_alignment=data.get("mounted_alignment"),
            timestamp=data.get("timestamp"),
        )


@dataclass
class ActorVisualProfile:
    """
    Bridge object between authored XP content and compiled RenderPlan rows.
    
    Defines what layers exist, what slots they fill, and what visual key
    dimensions (variation, mount state) they cover.
    
    Example usage:
        profile = ActorVisualProfile(
            profile_id="human_idle_default",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            variation="default",
            domain="skin",
            layers=[
                LayerAssignment(
                    slot="body",
                    layer_definition_id=700,
                    xp_ref="assets/sprites/player_native_idle_only.xp",
                    visual_style_id=1,
                    region=Region(x=0, y=0, w=8, h=8),
                )
            ],
        )
    """
    profile_id: str
    skin_definition_id: int
    presentation_kind: PresentationKind
    domain: Domain
    layers: list[LayerAssignment]
    schema_version: int = 1
    variation: str | None = None
    mount_composition: MountComposition | None = None
    source_refs: SourceRefs | None = None
    quality_gates: QualityGates | None = None
    metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        """Validate required constraints."""
        if not self.profile_id or not self.profile_id[0].isalpha():
            raise ValueError("profile_id must start with a letter")
        if self.schema_version != 1:
            raise ValueError(f"Unsupported schema_version: {self.schema_version}")
        if not self.layers:
            raise ValueError("At least one layer is required")

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict."""
        result: dict[str, Any] = {
            "schema_version": self.schema_version,
            "profile_id": self.profile_id,
            "skin_definition_id": self.skin_definition_id,
            "presentation_kind": self.presentation_kind,
            "domain": self.domain,
            "layers": [layer.to_dict() for layer in self.layers],
        }
        if self.variation is not None:
            result["variation"] = self.variation
        if self.mount_composition is not None:
            result["mount_composition"] = self.mount_composition.to_dict()
        if self.source_refs is not None:
            result["source_refs"] = self.source_refs.to_dict()
        if self.quality_gates is not None:
            result["quality_gates"] = self.quality_gates.to_dict()
        if self.metadata is not None:
            result["metadata"] = self.metadata
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ActorVisualProfile:
        """Deserialize from JSON-compatible dict."""
        return cls(
            schema_version=int(data.get("schema_version", 1)),
            profile_id=data["profile_id"],
            skin_definition_id=int(data["skin_definition_id"]),
            presentation_kind=data["presentation_kind"],
            domain=data["domain"],
            layers=[LayerAssignment.from_dict(layer) for layer in data["layers"]],
            variation=data.get("variation"),
            mount_composition=MountComposition.from_dict(data["mount_composition"]) if data.get("mount_composition") else None,
            source_refs=SourceRefs.from_dict(data["source_refs"]) if data.get("source_refs") else None,
            quality_gates=QualityGates.from_dict(data["quality_gates"]) if data.get("quality_gates") else None,
            metadata=data.get("metadata"),
        )

    def to_json(self, indent: int = 2) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_json(cls, json_str: str) -> ActorVisualProfile:
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))

    def to_file(self, path: Path | str) -> None:
        """Write to JSON file."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def from_file(cls, path: Path | str) -> ActorVisualProfile:
        """Read from JSON file."""
        path = Path(path)
        return cls.from_json(path.read_text(encoding="utf-8"))

    def get_server_visual_key(self) -> dict[str, Any]:
        """
        Generate ServerVisualKey components from this profile.
        
        This is the key that will be used to look up RenderPlan rows at runtime.
        """
        return {
            "skin_definition_id": self.skin_definition_id,
            "presentation_kind_id": self.presentation_kind,  # Will be mapped to ID at compile time
            "variation": self.variation or "default",
            "domain": self.domain,
            "slot_state": self._get_slot_state(),
            "mount_state": self._get_mount_state(),
        }

    def _get_slot_state(self) -> dict[str, int | None]:
        """Extract equipped slot state from layers."""
        slot_state = {
            "body": None,
            "head": None,
            "chest": None,
            "weapon": None,
            "shield": None,
            "armor": None,
        }
        for layer in self.layers:
            if layer.slot in slot_state:
                slot_state[layer.slot] = layer.item_definition_id or layer.layer_definition_id
        return slot_state

    def _get_mount_state(self) -> dict[str, Any]:
        """Extract mount state from profile."""
        if self.mount_composition is None:
            return {"is_mounted": False}
        return {
            "is_mounted": True,
            "mount_definition_id": self.mount_composition.mount_definition_id,
            "has_rear": self.mount_composition.rear_layer_index is not None,
            "has_rider": self.mount_composition.rider_layer_index is not None,
            "has_front": self.mount_composition.front_layer_index is not None,
        }


# ── Helper functions ─────────────────────────────────────────────────────────

def create_profile(
    profile_id: str,
    skin_definition_id: int,
    presentation_kind: PresentationKind,
    domain: Domain,
    layers: list[LayerAssignment],
    variation: str | None = None,
    mount_composition: MountComposition | None = None,
) -> ActorVisualProfile:
    """
    Convenience factory for creating ActorVisualProfile instances.
    
    Example:
        profile = create_profile(
            profile_id="human_idle_default",
            skin_definition_id=100,
            presentation_kind="idle_walk",
            domain="skin",
            layers=[
                LayerAssignment(
                    slot="body",
                    layer_definition_id=700,
                    xp_ref="assets/sprites/player_native_idle_only.xp",
                    region=Region(x=0, y=0, w=8, h=8),
                )
            ],
        )
    """
    return ActorVisualProfile(
        profile_id=profile_id,
        skin_definition_id=skin_definition_id,
        presentation_kind=presentation_kind,
        domain=domain,
        layers=layers,
        variation=variation,
        mount_composition=mount_composition,
    )


def load_profiles_from_directory(directory: Path | str) -> list[ActorVisualProfile]:
    """Load all ActorVisualProfile JSON files from a directory."""
    directory = Path(directory)
    profiles = []
    for path in directory.glob("*.json"):
        if path.name.startswith("_"):
            continue  # Skip schema files
        try:
            profile = ActorVisualProfile.from_file(path)
            profiles.append(profile)
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"Warning: Failed to load {path}: {e}")
    return profiles


# ── Example usage ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Example: Create a simple human idle profile
    profile = create_profile(
        profile_id="human_idle_default",
        skin_definition_id=100,
        presentation_kind="idle_walk",
        domain="skin",
        layers=[
            LayerAssignment(
                slot="body",
                layer_definition_id=700,
                xp_ref="assets/sprites/player_native_idle_only.xp",
                visual_style_id=1,
                region=Region(x=0, y=0, w=8, h=8),
            )
        ],
        variation="default",
    )
    
    # Add source refs and quality gates
    profile.source_refs = SourceRefs(
        xp_file="assets/sprites/player_native_idle_only.xp",
        semantic_map="human_idle_walk.json",
    )
    profile.quality_gates = QualityGates(
        G7_cell_density=True,
        G8_glyph_coverage=True,
        G9_semantic_completeness=True,
        timestamp=datetime.utcnow().isoformat() + "Z",
    )
    
    # Serialize to JSON
    print("Example ActorVisualProfile:")
    print(profile.to_json())
    
    # Generate ServerVisualKey
    print("\nServerVisualKey:")
    print(json.dumps(profile.get_server_visual_key(), indent=2))
