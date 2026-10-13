---
title: "AMENDMENT: Blender bone rigging as primary rig_contract authoring surface"
date: 2026-05-12
status: draft
type: amendment
amends: docs/plans/2026-05-12-001-feat-complete-rig-seam-plan.md
---

# Amendment: Blender Bone Rigging as Primary `rig_contract` Authoring Surface

This amendment replaces the manual per-angle `{dx, dy}` authoring approach in the parent plan's U6 with a Blender armature/bone workflow. The core insight: Blender bone rigging for 2D sprites is a mature, well-proven ecosystem (COA Tools, blender-spritesheets, SpriteAtlasAddon). Rather than typing 40+ integer offsets per contract by hand, the author poses bones at each angle and a Blender exporter script writes the `rig_contract` JSON directly.

## Rationale

The parent plan's U6 requires the author to manually specify 8 `{angle, dx, dy}` entries per socket × 5 sockets = 40 integer coordinates per contract. This is error-prone, slow to iterate, and provides no visual feedback during authoring.

Blender armatures solve all three problems:
- **Visual feedback**: pose bones against the actual sprite layers in Blender's viewport
- **Speed**: pose 8 angles in ~2 minutes vs. hand-editing JSON for 20+ minutes
- **Accuracy**: bone world-space coordinates are exported directly — no transcription errors

The COA Tools addon (957 ★, GPL-3.0) already implements the "import sprites as planes → create mesh → parent to armature → pose → export JSON" pipeline. We don't need to build a Blender addon from scratch; we need a lightweight exporter script that targets our `rig_contract` schema specifically.

## Amended Key Technical Decisions

**8. Blender armature is the primary `rig_contract` authoring surface.** Manual JSON entry and calibration-artifact suggestion are fallback paths. The canonical workflow is: (a) import wolfie and crossbow player sprites as image planes into Blender, (b) create an armature with bones named per the fixed socket vocabulary, (c) pose the armature at each of 8 angles, (d) run the exporter script to emit `rig_contract` JSON. MCP tools wrap this as `blender_export_rig_contract` and `blender_suggest_rig_contract`.

## Amended Scope Boundaries

### Added to scope
- Blender exporter script (`scripts/blender_export_rig_contract.py`) that runs headless: `blender --background --python scripts/blender_export_rig_contract.py -- --rig-id wolfie_crossbow_v1 --angles 8 --output /tmp/rig_contract.json`
- MCP tool `blender_export_rig_contract` wrapping the headless Blender invocation
- MCP tool `blender_suggest_rig_contract` — reads calibration artifact, generates a `.blend` starter file with sprites pre-imported, bones pre-placed at calibration-derived positions, ready for manual refinement

### Demoted (still available, not primary)
- Manual `POST /api/workbench/rig-contract` — kept for programmatic/CI use, not the recommended human path
- `suggest_rig_contract_from_calibration` — kept as a fallback, but `blender_suggest_rig_contract` is preferred

## Amended Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PRIMARY AUTHORING PATH (Blender)                                │
│                                                                  │
│  wolfie + crossbow sprites (.xp/.png)                            │
│       ↓                                                         │
│  Blender .blend project                                          │
│       ├── image planes for each sprite layer                     │
│       ├── armature with bones: rider_pelvis, weapon_grip, ...    │
│       └── posed at 8 angles (0-7)                                │
│       ↓                                                         │
│  blender_export_rig_contract.py  (headless)                      │
│       ├── reads bone world positions at each angle               │
│       ├── maps bone names → socket names                         │
│       └── emits rig_contract JSON (U2 schema)                    │
│       ↓                                                         │
│  positive.bundle.json  ←  rig_contract inserted                  │
│       ↓                                                         │
│  (rest of compile flow unchanged)                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  FALLBACK AUTHORING PATH (manual)                                │
│                                                                  │
│  POST /api/workbench/rig-contract  (JSON body)                   │
│  suggest_rig_contract_from_calibration  (MCP)                    │
│       ↓                                                         │
│  positive.bundle.json                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Replaced Implementation Units

### U6 (REPLACED). Pipeline-v3 Blender-driven authoring surface for rig contracts

**Goal:** Add Blender exporter as the primary rig contract authoring path. Keep REST/MCP manual entry as fallback. Wire `workbench_create_actor_visual_profile()` into the bundle workflow (FL-3868).

**Requirements:** FL-3868 (wired ActorVisualProfile); FL-3867 (authoring surface); §2.15.4 pipeline-v3 authoring implication.

**Dependencies:** U1, U2

**Files:**
- `scripts/blender_export_rig_contract.py` — **new**. Headless Blender Python script. Imports `.blend` file, reads bone world positions at each of 8 angles, maps bone→socket names, emits `rig_contract` JSON to stdout or file.
- `scripts/blender_starter_rig.py` — **new**. Generates a `.blend` file from calibration artifact data: imports wolfie + crossbow sprites as planes, creates armature with bones at calibration-derived positions, saves `.blend` ready for manual refinement.
- `src/pipeline_v2/service.py` — `workbench_create_rig_contract()`; wire `workbench_create_actor_visual_profile()` into `create_bundle()` path
- `src/pipeline_v2/app.py` — `POST /api/workbench/rig-contract`, `GET /api/workbench/rig-contract/{id}` (fallback manual paths)
- `scripts/workbench_mcp_server.py` — `blender_export_rig_contract` tool, `blender_starter_rig` tool, `create_rig_contract` tool (fallback), `suggest_rig_contract_from_calibration` tool (fallback)
- `tests/test_rig_contract_backend.py` — cover routes + service functions + blender export round-trip

**Approach — Primary Path (Blender):**

1. **Starter generation** (`blender_starter_rig` MCP tool):
   - Reads wolfie calibration artifact (`output/manual/mounted-rider-offset-angle0-frame0-proj0.json`)
   - Generates a `.blend` file with:
     - Image planes for each sprite layer (wolf body, rider body, crossbow weapon, occlusion planes) positioned at origin
     - Empty armature with bones named `rider_pelvis`, `mount_saddle`, `weapon_grip`, `mount_rear_occlusion`, `mount_front_occlusion`
     - Bones pre-positioned at calibration-derived coordinates for each of 8 angles (using Blender keyframes on bone location)
     - Orthographic camera set to XP cell grid scale
   - Saves to session-scoped workbench directory: `<session>/rig-authoring/wolfie_crossbow_v1.blend`

2. **Manual refinement**: Author opens the `.blend` in Blender GUI, visually checks bone placement against sprite layers at each angle, adjusts bone positions by dragging in viewport. Poses are stored as location keyframes on the armature at frames 0-7.

3. **Export** (`blender_export_rig_contract` MCP tool):
   - Invokes Blender headless: `blender --background <session>/rig-authoring/wolfie_crossbow_v1.blend --python scripts/blender_export_rig_contract.py -- --rig-id wolfie_crossbow_v1 --angles 8`
   - Exporter script:
     - Reads armature object by name
     - For each frame 0-7, sets scene to that frame, reads each bone's world-space position
     - Maps bone name → socket name (1:1 by convention; bone `rider_pelvis` → socket `rider_pelvis`)
     - Converts world-space coordinates to XP cell space (divide by cell size constant from calibration)
     - Emits `rig_contract` JSON exactly matching U2 schema
   - Writes contract to working bundle's `positive.bundle.json`

4. **ActorVisualProfile wiring**: `workbench_create_actor_visual_profile()` is called from `create_bundle()` when `rig_definition_id` is set — unchanged from parent plan.

**Approach — Fallback Path (manual JSON):**
- `workbench_create_rig_contract()` takes a `rig_definition_id`, optional description, and `sockets` dict. Validates against `config/rig_contract_schema.json` and writes to `positive.bundle.json`.
- `suggest_rig_contract_from_calibration` reads calibration artifact and returns suggested contract object — kept for programmatic/CI use.

**Blender exporter script design (`blender_export_rig_contract.py`):**

```python
# Key logic sketch — not implementation spec
import bpy
import json
import argparse

SOCKET_BONE_NAMES = [
    "rider_pelvis", "mount_saddle", "weapon_grip",
    "mount_rear_occlusion", "mount_front_occlusion"
]

CELL_SIZE = 16  # XP cell size in Blender units — from calibration config

def export_rig_contract(rig_id: str, num_angles: int, description: str = "") -> dict:
    armature = bpy.data.objects.get("RIG_Armature")
    if not armature:
        raise ValueError("No armature named 'RIG_Armature' found in scene")

    sockets = {}
    for bone_name in SOCKET_BONE_NAMES:
        angle_offsets = []
        for angle in range(num_angles):
            bpy.context.scene.frame_set(angle)
            bone = armature.pose.bones.get(bone_name)
            if bone:
                # World-space head position → cell-space offset
                world_pos = armature.matrix_world @ bone.head
                dx = round(world_pos.x / CELL_SIZE)
                dy = round(world_pos.z / CELL_SIZE)  # Blender Z = game Y
                angle_offsets.append({"angle": angle, "dx": dx, "dy": dy})
        sockets[bone_name] = {
            "angle_offsets": angle_offsets,
            "visibility": "always"
        }

    return {
        "rig_definition_id": rig_id,
        "description": description,
        "version": 1,
        "sockets": sockets,
        "layer_order": [
            "mount_rear_occlusion", "body", "wearables",
            "weapon_grip", "mount_front_occlusion"
        ]
    }

# argparse entry point: --rig-id, --angles, --output
# Prints JSON to stdout or writes to --output file
```

**Test scenarios:**
- `blender_starter_rig` with valid calibration artifact → produces `.blend` file that opens in Blender without errors
- `.blend` contains 5 bones with correct names, keyframed at frames 0-7
- `blender_export_rig_contract` on starter `.blend` with no manual edits → emits contract where `rider_pelvis` offsets match calibration data within ±1 cell
- `blender_export_rig_contract` after manual bone adjustment → emitted offsets reflect the adjusted positions
- `blender_export_rig_contract` on `.blend` missing `RIG_Armature` → clear error, not traceback
- `blender_export_rig_contract` on `.blend` with missing bone → warning logged, that socket gets zero offsets
- Exported contract passes `config/rig_contract_schema.json` validation
- `POST /api/workbench/rig-contract` (fallback) still accepts valid JSON body → 200
- `POST /api/workbench/rig-contract` with missing socket → 400 with named error
- `suggest_rig_contract_from_calibration` with missing file → clear error
- `create_bundle()` with `rig_definition_id` set → `workbench_create_actor_visual_profile()` called; stub written to session
- Round-trip: export contract → validate → compile → offsets in `render_plans.json` match authored bone positions

**Verification:** `blender_export_rig_contract` MCP tool call produces valid `rig_contract` JSON. Starter `.blend` opens in Blender GUI with sprites visible and bones at calibration positions. Exported contract round-trips through schema validation and compiler.

### U6b (NEW). Blender environment bootstrap for pipeline-v3

**Goal:** Ensure Blender is available and version-compatible on the pipeline-v3 host. Detect, validate, and report Blender path so MCP tools can invoke it headless.

**Requirements:** Prerequisite for U6 Blender tools.

**Dependencies:** none (parallel with U1–U2)

**Files:**
- `scripts/blender_env_check.py` — new. Detects Blender, checks version ≥ 3.0, prints path and version JSON.
- `scripts/workbench_mcp_server.py` — `blender_env_check` tool

**Approach:**
- `blender_env_check.py` runs `blender --version`, parses output, reports `{"blender_path": "...", "version": "4.1.0", "available": true}` or `{"available": false, "error": "..."}`.
- MCP tool surfaces this so the agent can gate U6 work on Blender availability.
- If Blender is missing, the agent falls back to manual JSON authoring path (original U6).
- CI: pipeline-v3 Docker image should include Blender (or mark Blender-dependent tests as skip-if-no-blender).

**Test scenarios:**
- `blender_env_check` on system with Blender → reports version and path
- `blender_env_check` on system without Blender → reports unavailable with clear error
- MCP tool returns same JSON as script

**Verification:** Running `blender_env_check` MCP tool on the development host returns `available: true` with version ≥ 3.0.

## Amended Dependencies and Sequencing

```
U1 (rig_definition_id in key spaces)
    ↓
U2 (rig_contract schema + wolfie_crossbow_v1 data)
    ↓
U3 (semantic map socket anchors)     U4 (compiler math)
                                          ↓
U6b (Blender env bootstrap)          U5 (wire compile → emit render_plans.json)
    ↓                                     ↓
U6 (Blender authoring surface)       U7 (visual proof)
    ↑── depends on U1, U2, U6b           ↑── depends on U4, U5, U6
```

U6b runs independently; U6 requires U6b + U2. U3 can feed starter positions for `blender_starter_rig`. U6 must complete before U7 can iterate on offsets.

### Iteration loop (U6 ↔ U7):
```
U6: export rig_contract from Blender
    ↓
U4: compile with contract → render_plans.json
    ↓
U7: headed proof — check alignment
    ↓  (if misaligned)
U6: adjust bones in Blender, re-export
    ↓
U4: recompile
    ↓
U7: re-check
```

This loop is the key advantage of Blender authoring: each adjustment iteration is a bone-drag-and-re-export cycle (~30 seconds) vs. hand-editing JSON coordinates (~5 minutes).

## Amended Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Blender not available on pipeline-v3 host | Medium | High — primary authoring path blocked | U6b detects and reports; fallback to manual JSON path always available |
| Blender version incompatibility (script uses API not in installed version) | Low | Medium — exporter fails | U6b gates on version ≥ 3.0; exporter script targets stable bpy API (no experimental features) |
| Bone world-space → cell-space coordinate conversion introduces scale errors | Medium | High — offsets wrong | Exporter uses `CELL_SIZE` constant from calibration config; U7 visual proof catches scale errors immediately; round-trip test in U6 |
| COA Tools/Blender addon dependency creep | Low | Medium — scope grows | This amendment uses a standalone exporter script, not COA Tools. No Blender addon installation required. The `.blend` file is self-contained. |
| Author must learn Blender basics | Medium | Low — onboarding friction | `blender_starter_rig` pre-positions bones at calibration-derived coords; author only needs to drag bones in viewport, not create rig from scratch. |
| Headless Blender invocation on macOS requires full app path | Low | Low — CI config | U6b detects path; `blender_env_check` reports exact binary path for MCP tool to use |

## Amended Affected Systems

| System | Impact |
|--------|--------|
| **`scripts/blender_export_rig_contract.py`** (NEW) | Headless Blender exporter: bone positions → rig_contract JSON |
| **`scripts/blender_starter_rig.py`** (NEW) | Generates `.blend` from calibration artifact: sprites + armature pre-placed |
| **`scripts/blender_env_check.py`** (NEW) | Detects Blender availability and version |
| pipeline-v3 `workbench_mcp_server.py` | `blender_export_rig_contract`, `blender_starter_rig`, `blender_env_check` tools |
| pipeline-v3 `service.py` | `workbench_create_rig_contract()` (fallback); wired `workbench_create_actor_visual_profile()` |
| pipeline-v3 `app.py` | `POST /api/workbench/rig-contract` (fallback manual path) |
| `<session>/rig-authoring/` (NEW) | Session-scoped Blender project directory |
| All other systems from parent plan | Unchanged |

## Deferred Implementation Notes (Amended)

- COA Tools integration as optional enhancement — if the standalone exporter proves insufficient, COA Tools' JSON export format could be adapted to our `rig_contract` schema. Deferred to follow-up.
- Blender addon packaging — the exporter script is invoked headless via `--python`. Packaging as a Blender addon with a UI panel is deferred.
- Multi-mount Blender project template — `blender_starter_rig` initially supports only wolfie. bigbee, Wolack, and plydie templates deferred to their respective follow-up plans.
- Bone rotation for angle-dependent visibility — the current exporter reads only bone position. Bone rotation could optionally drive visibility rules (e.g., bone scale = 0 means "hidden at this angle"). Deferred until visibility rules are needed beyond `always`.
