---
title: "feat: Implement complete 2D sprite rig seam"
date: 2026-05-12
status: active
type: feat
amendments:
  - docs/plans/2026-05-12-001-amendment-blender-bone-authoring.md (Blender bone rigging as primary authoring surface; supersedes U6)
tracking:
  - FL-3867 (rig_definition_id absent from all surfaces)
  - FL-3866 (render_plan_table.py disconnected from compile)
  - FL-3868 (workbench_create_actor_visual_profile() not wired)
  - UQ-008 (mounted-family parity — partial blocker)
  - UQ-R15 (RenderPlanTable replacement — partial blocker)
deepened: ~
---

# feat: Implement complete 2D sprite rig seam

> **⚠️ AMENDED** by [`docs/plans/2026-05-12-001-amendment-blender-bone-authoring.md`](./2026-05-12-001-amendment-blender-bone-authoring.md).
> U6 (authoring surface) is **superseded** — Blender bone rigging is the primary `rig_contract` creation path.
> KTD #2 (coordinate source) is **demoted** — calibration artifacts are starter data, not primary authoring.
> See amendment for full replacement of U6, new U6b (Blender env bootstrap), updated data flow, and amended risks.

**Created:** 2026-05-12
**Target repos:** pipeline-v3 (authoring surface), asciicker-Y9-2 (compiler + engine)
**Canonical authority:** `docs/plans/2026-03-23-workbench-canonical-spec.md` §2.15.0.1

---

## Problem Frame

The §2.15 architectural refactor replaces runtime visual resolution with a static `RenderPlanTable`. The compiler must emit every visual key's ordered layer list at compile time, including per-layer attachment offsets for mounted and weapon compositions.

A `rig_definition_id` integer was established as an authored selector dimension (see §2.15.0.1) but has zero code implementation on any surface. More critically, no authored socket/anchor/layer-order contract data exists anywhere — no bundle schema field, no compiler logic, no authoring surface.

The result: mounted wolf + crossbow alignment is currently computed at runtime in legacy code marked for deletion (FL-3865). Once that code is deleted, alignment breaks. The compiler must own this math before the deletion is safe.

A **complete 2D rig seam** (per §2.15.0.1) means:

1. **Named sockets/anchors** — `rider_pelvis`, `mount_saddle`, `weapon_grip`, `mount_rear_occlusion`, `mount_front_occlusion` with authored coordinates
2. **Angle-aware transforms** — per-angle x/y offsets and visibility/flip rules per attachment point
3. **Layer-order contracts** — explicit compiler-owned ordering: `[mount_rear, body, wearables, weapon, mount_front]`
4. **Compiler ownership** — all math in `appearance_bundle.py`; runtime only pastes pre-computed ordered layers

This plan delivers that contract end-to-end: schema definition, semantic anchor authoring, compiler math, pipeline-v3 authoring surface, and visual proof for the wolfie + crossbow case.

---

## Scope Boundaries

### In scope
- `rig_definition_id` dimension in all Y9-2 and pipeline-v3 key spaces (closes FL-3867)
- `rig_contract` bundle schema with named socket attachments and angle offsets
- Socket anchor data for wolfie + player-crossbow semantic maps
- Compiler math: authored rig contracts → per-angle layer offsets in `RenderPlan` rows
- Wiring of `render_plan_table.py` into compile action (closes FL-3866)
- Emit of `render_plans.json` alongside `appearance_bundle.json`
- Pipeline-v3 authoring surface: `/api/workbench/rig-contract`, MCP tool, wired `workbench_create_actor_visual_profile()` (closes FL-3868)
- Visual proof gate: mounted wolf + crossbow alignment at 8 angles
- Compiler hard-fail when `rig_definition_id` is referenced but no matching `rig_contract` exists

### Deferred to Follow-Up Work
- bigbee mount family rig seam (no upstream SDL source contract)
- Wolack (melee attack) rig seam — melee does not require weapon attachment math; proof sufficient without rig_contract
- Death/fall rig seam for mounted states (plydie family)
- Editor UI for socket placement with live preview — MCP-driven authoring is sufficient for initial proof
- `rig_contract` export in structured authoring artifact (Step 7 of content authoring flow) — covered by FL-3863 plan
- Full UQ-R15 / FL-3865 four-target deletion — this plan makes deletion safe, not complete

### Outside this plan's scope
- Runtime changes in Y9-2 engine for rig — the runtime receives ordered layers from the compiler; §2.15 forbids runtime rig math
- New C++ special cases for weapon attachment — the compiler emits the offset; runtime pastes it

---

## Key Technical Decisions

1. **Socket attachment format — extend `rider_offset_by_facing` pattern.** The existing `rider_offset_by_facing` in bundle JSON is a per-angle global mount offset. The `rig_contract` schema extends this with per-socket named offsets, making it a per-layer attachment record rather than a single global shift. This is additive and backward-compatible.

2. **Coordinate source — Blender armature as primary, calibration artifacts as starter data, semantic anchors as fallback.** ⚠️ Amended. The primary `rig_contract` authoring path is Blender bone rigging (see amendment). The existing per-angle calibration artifact format serves as starter data for `blender_starter_rig` to pre-position bones. Semantic map anchor coordinates serve as a fallback when calibration artifacts don't exist. Manual JSON entry of coordinates is a tertiary fallback for CI/programmatic use.

3. **`rig_definition_id` is a select-only dimension in `ServerVisualKey`.** It selects which `rig_contract` applies to a given visual key. Different skins or presentations can share the same rig contract. The compiler looks up the contract by ID; no runtime rig dispatch.

4. **Compiler fail-closed on missing contract.** If a `RenderPlan` row references a `rig_definition_id` but no matching `rig_contract` exists in the bundle, the compile step must fail with a named error. No silent fallback to zero offsets.

5. **Layer offset storage in `RenderPlanRow`.** Each layer entry gains an `offset_by_angle: [[dx, dy], ...]` field (8 entries). The runtime applies `offset_by_angle[current_angle]` as a paste offset per layer. This keeps runtime code trivial: index + paste, no math.

6. **Named socket types are fixed-vocabulary.** The first implementation defines exactly 5 socket types. New socket types require a schema version bump. This prevents unbounded runtime branching.

7. **Visual proof is the closure gate.** FL-3867 / UQ-008 cannot close on rig seam until headed visual proof confirms rider/body/weapon alignment at all 8 angles. Screenshots are committed artifacts.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Data Flow

```
authored rig_contract (in positive.bundle.json)
    ↓
appearance_bundle.py compile_bundle()
    ├── load rig_contracts by rig_definition_id
    ├── for each ServerVisualKey with rig_definition_id:
    │       for each layer in plan:
    │           look up socket that owns this layer
    │           read per-angle {dx, dy} from rig_contract.sockets[socket].angle_offsets
    │           apply visibility rules → include/exclude per angle
    │       → populate RenderPlanRow.layers[].offset_by_angle
    └── fail hard if rig_definition_id referenced but no contract found
         ↓
render_plans.json  (new output alongside appearance_bundle.json)
    ↓
Y9-2 runtime compiled_bundle_loader.cpp
    ↓
render_plan_lookup.cpp   → exact ServerVisualKey lookup
    ↓
sprite_compositor.cpp    → paste layers with offset_by_angle[current_angle]
```

### Schema Sketch (rig_contract entry in positive.bundle.json)

```json
{
  "rig_contracts": [
    {
      "rig_definition_id": "wolfie_crossbow_v1",
      "description": "wolf mount with crossbow rider attachment",
      "version": 1,
      "sockets": {
        "rider_pelvis": {
          "angle_offsets": [
            {"angle": 0, "dx": 1, "dy": 0},
            {"angle": 1, "dx": 0, "dy": 0},
            ...
          ],
          "visibility": "always"
        },
        "mount_saddle": {
          "angle_offsets": [...],
          "visibility": "always"
        },
        "weapon_grip": {
          "angle_offsets": [...],
          "visibility": "angle_range",
          "visible_angles": [0, 1, 2, 3, 4, 5, 6, 7]
        },
        "mount_rear_occlusion": {
          "angle_offsets": [...],
          "visibility": "always"
        },
        "mount_front_occlusion": {
          "angle_offsets": [...],
          "visibility": "always"
        }
      },
      "layer_order": [
        "mount_rear_occlusion",
        "body",
        "wearables",
        "weapon_grip",
        "mount_front_occlusion"
      ]
    }
  ]
}
```

### RenderPlanRow Layer Extension

```json
{
  "role": "wearable",
  "slot": "weapon",
  "asset": "wolfie-weapon-crossbow.xp",
  "z": 3,
  "socket": "weapon_grip",
  "offset_by_angle": [[2,0],[1,0],[0,0],[0,1],[2,0],[1,0],[0,0],[0,1]]
}
```

---

## Implementation Units

### U1. Add `rig_definition_id` dimension to all key spaces

**Goal:** Thread `rig_definition_id` through `ServerVisualKey`, `runtime_identity_registry.json`, `appearance_bundle.py`, pipeline-v3 `app.py`, `service.py`, and `workbench_mcp_server.py`. Closes FL-3867 (routing hook portion).

**Requirements:** FL-3867 (routing hook); prerequisite for U2–U7.

**Dependencies:** none

**Files:**
- `asciicker-Y9-2/scripts/pipeline/render_plan_table.py` — add `rig_definition_id: str | None` to `ServerVisualKey`
- `asciicker-Y9-2/scripts/pipeline/appearance_bundle.py` — thread `rig_definition_id` through bundle read and key construction
- `config/runtime_identity_registry.json` — add `rig_definition_id` field to each entry (nullable, default null)
- `src/pipeline_v2/app.py` — add `rig_definition_id` to bundle-create and compile-skin-request routes
- `src/pipeline_v2/service.py` — thread through `create_bundle()`, `resolve_blueprint_targets()`, `workbench_export_bundle()`
- `scripts/workbench_mcp_server.py` — add `rig_definition_id` parameter to relevant tools
- `tests/test_render_plan_table.py` — cover null and non-null rig_definition_id in ServerVisualKey hashing
- `tests/test_rig_dimension.py` — new test file

**Approach:** `rig_definition_id` is nullable — null means "no rig contract required" for backward compatibility with existing content. When null, compiler does not look up any rig_contract and layer offsets remain `[0,0]` for all angles. When set, compiler must find the matching contract or fail hard.

**Patterns to follow:** How `presentation_kind_id` is threaded through the same stack — use the same nullable optional field pattern in registry JSON and service functions.

**Test scenarios:**
- `ServerVisualKey` with `rig_definition_id=null` hashes the same as previous behavior
- `ServerVisualKey` with `rig_definition_id="wolfie_crossbow_v1"` hashes differently from null and from a different id
- `workbench_export_bundle()` includes `rig_definition_id` field in output (null when not set)
- `runtime_identity_registry.json` schema test: entries without `rig_definition_id` still valid (backward compat)
- MCP tool accepts `rig_definition_id` parameter without error; missing parameter defaults to null

**Verification:** All existing tests pass. New dimension appears in `ServerVisualKey.__repr__` and JSON serialization.

---

### U2. Define `rig_contract` bundle schema and author wolfie + crossbow contract

**Goal:** Add `rig_contracts` array to the bundle JSON schema. Author the first real contract: `wolfie_crossbow_v1` with all five socket types and per-angle offsets derived from the existing mounted calibration artifact at `output/manual/mounted-rider-offset-angle0-frame0-proj0.json`.

**Requirements:** FL-3867 (authored socket/anchor contracts); UQ-008 prerequisite.

**Dependencies:** U1

**Files:**
- `config/rig_contract_schema.json` — new JSON schema defining the `rig_contract` object shape
- `assets/appearance_bundle/phase2-fixtures/positive.bundle.json` — add `rig_contracts` array with `wolfie_crossbow_v1` entry
- `asciicker-Y9-2/scripts/pipeline/appearance_bundle.py` — add `rig_contracts` loader and schema validator in `validate_structural_gates()`
- `tests/test_rig_contract_schema.py` — new test file

**Approach:** The `rider_offset_by_facing` per-angle values already exist in mounted calibration artifacts. For `wolfie_crossbow_v1`, the `rider_pelvis` socket `angle_offsets` should be derived from the calibration artifact. The other sockets (`mount_saddle`, `weapon_grip`, `mount_rear_occlusion`, `mount_front_occlusion`) start with zero offsets and will be refined during the visual proof step (U7). Layer order is fixed: `[mount_rear_occlusion, body, wearables, weapon_grip, mount_front_occlusion]`.

**Patterns to follow:** How `rider_offset_by_facing` is structured in the existing mount rows in `positive.bundle.json`.

**Test scenarios:**
- Schema validator accepts a valid `rig_contract` with all 5 sockets and 8 angles per socket
- Schema validator rejects a contract missing `rig_definition_id`
- Schema validator rejects a contract with fewer than 8 angle entries in any socket
- Schema validator rejects an unknown socket name (enforce vocabulary)
- `validate_structural_gates()` reports a named error for a bundle referencing `rig_definition_id="wolfie_crossbow_v1"` when that contract is absent from `rig_contracts`
- `wolfie_crossbow_v1` contract passes schema validation with rider_pelvis offsets matching existing calibration data

**Verification:** `python3 scripts/pipeline/appearance_bundle.py validate-xp` passes. Structural gate surfaces clear error when contract is missing.

---

### U3. Extend semantic maps with named socket anchor regions for wolfie + crossbow

**Goal:** Add a `socket_anchors` concept to the semantic map schema. Populate anchor data for `wolfie-0100` and the crossbow player states, covering all five socket types with per-angle coordinates. These serve as an alternative source for rig contract authors and as a ground-truth check for the compiler.

**Requirements:** FL-3867 (socket anchor data); completeness of rig seam authoring surface.

**Dependencies:** U2

**Files:**
- `docs/research/ascii/semantic_maps/schema.json` — add `socket_anchors` field definition
- `docs/research/ascii/semantic_maps/wolfie-0100.json` — add `socket_anchors` section
- `docs/research/ascii/semantic_maps/player-crossbow.json` — new or extend existing player map
- `asciicker-Y9-2/scripts/pipeline/semantic_dict.py` — extend `load_angle_anchors()` to read `socket_anchors` field
- `tests/test_semantic_socket_anchors.py` — new test file

**Approach:** `socket_anchors` is an object keyed by socket name, value is an array of 8 `{angle, x, y}` entries. The coordinates are in XP cell space (not pixel space). `semantic_dict.py::load_angle_anchors()` already loads a similar structure — extend it to recognize the named socket vocabulary. These values can be used by the pipeline-v3 authoring surface (U6) to suggest rig contract offsets, and by the compiler (U4) as a secondary consistency check.

**Patterns to follow:** Existing semantic map region/cell structure in `docs/research/ascii/semantic_maps/schema.json`.

**Test scenarios:**
- `load_angle_anchors("wolfie-0100", "rider_pelvis")` returns 8 angle entries with non-zero coordinates
- `load_angle_anchors()` returns empty/null for an unknown socket name (not an error)
- Schema validator in semantic_dict accepts maps with and without `socket_anchors` (backward compat)
- wolfie-0100 rider_pelvis coordinates are consistent with existing calibration artifact at angle 0

**Verification:** Semantic map files pass schema validation. `load_angle_anchors()` round-trips through JSON.

---

### U4. Implement compiler math — authored rig contracts → per-angle layer offsets

**Goal:** In `appearance_bundle.py::compile_bundle()`, read `rig_contracts`, apply socket transform math, and populate `RenderPlanRow.layers[].offset_by_angle` for all layers owned by a named socket. Fail hard when `rig_definition_id` is set but no contract found.

**Requirements:** FL-3867 (compiler-owned transforms); §2.15.3 compiler output obligation.

**Dependencies:** U1, U2, U3

**Files:**
- `asciicker-Y9-2/scripts/pipeline/appearance_bundle.py` — `compile_bundle()` rig contract resolution loop
- `asciicker-Y9-2/scripts/pipeline/render_plan_table.py` — add `offset_by_angle: list[tuple[int,int]]` to layer entries in `RenderPlanRow`
- `tests/test_rig_compiler_math.py` — new test file

**Approach:**
For each `ServerVisualKey` in the enumeration:
1. If `rig_definition_id` is null, set all layer offsets to `[0,0] * 8` — skip rig logic
2. If `rig_definition_id` is non-null, look up matching contract. Fail hard if absent.
3. For each layer in the plan, determine which socket owns that layer (via the contract's `layer_order` or the layer's `slot` field)
4. Copy per-angle `{dx, dy}` from the socket's `angle_offsets` list into the layer's `offset_by_angle`
5. Apply visibility rules: if a socket is `angle_range` restricted, mark excluded angles with a "hidden" flag on the layer (compiler sets `visible_at_angles: [bool*8]`)

The compiler does not perform spatial math (no pixel transforms). It copies authored offsets into the output row. All attachment coordinate decisions are made at authoring time (U6) or from calibration artifacts (U3).

**Patterns to follow:** How the existing `rider_offset_by_facing` value is currently read from bundle JSON and applied. Mirror that indexing pattern for per-socket angle lookup.

**Test scenarios:**
- Compile a bundle with `rig_definition_id=null` — all layer offsets are `[0,0]*8`, no error
- Compile a bundle referencing `wolfie_crossbow_v1` — `weapon_grip` socket layers have non-zero per-angle offsets matching the contract's angle_offsets
- Compile a bundle referencing a `rig_definition_id` that doesn't exist — compile fails with error naming the missing contract ID and the visual key that needs it
- Compile with a valid contract — layer ordering follows contract's `layer_order` field
- `visible_at_angles` is all-true for "always" visibility sockets; angle-range sockets mark excluded angles as false
- Layer not assigned to any socket in the contract gets zero offsets (not an error — a warning)
- Compiler output for wolfie + crossbow mount key matches the authored `wolfie_crossbow_v1` offset table

**Verification:** `python3 scripts/pipeline/appearance_bundle.py compile-bundle` emits `render_plans.json` with correct per-layer `offset_by_angle` arrays for wolfie + crossbow presentation keys.

---

### U5. Wire `render_plan_table.py` into compile action and emit `render_plans.json`

**Goal:** Fix FL-3866. The `bundle_mods.py compile` action must invoke `render_plan_table.py` and write `render_plans.json` to the bundle output directory alongside `appearance_bundle.json`. `verify-current` and `build-web.sh` must gate on `render_plans.json` being present and valid.

**Requirements:** FL-3866; §2.15.3 compiler output obligation; FL-3862 partial (Python gate; C++ parser gate is a separate step).

**Dependencies:** U4

**Files:**
- `asciicker-Y9-2/scripts/pipeline/bundle_mods.py` — update `compile` action to invoke `render_plan_table.py`
- `asciicker-Y9-2/scripts/pipeline/appearance_bundle.py` — `compile_bundle()` writes `render_plans.json`
- `asciicker-Y9-2/scripts/pipeline/appearance_bundle.py` — `verify_current()` checks `render_plans.json` exists and parses
- `asciicker-Y9-2/scripts/verify-web-build.sh` (or build-web equivalent) — add presence check for `render_plans.json`
- `tests/test_bundle_compile_output.py` — cover render_plans.json emission

**Approach:** The compile action currently calls `appearance_bundle.py compile-bundle` and writes `appearance_bundle.json`. Extend the same call to also compute and write `render_plans.json`. The two files share the same `bundle_hash`. `verify_current()` fails if `render_plans.json` is absent or if its `bundle_hash` does not match `appearance_bundle.json`.

**Patterns to follow:** How `appearance_bundle.json` is currently written in `compile_bundle()` — mirror the same path-join and write pattern.

**Test scenarios:**
- `compile` action produces `render_plans.json` in output directory
- `render_plans.json` and `appearance_bundle.json` share the same `bundle_hash`
- `verify_current()` fails with clear error when `render_plans.json` is absent
- `verify_current()` fails when `render_plans.json.bundle_hash != appearance_bundle.json.bundle_hash`
- `verify_current()` passes when both files present and hashes match
- `render_plans.json` is valid per the §2.15.3 schema (schema_version, asset_table, render_plans array)

**Verification:** After compile: both JSON files present in output directory. After verify-current: PASS when both files consistent, clear named error when either is missing.

---

### U6. Pipeline-v3 authoring surface for rig contracts ⚠️ SUPERSEDED

> **This unit is superseded by the [Blender bone authoring amendment](./2026-05-12-001-amendment-blender-bone-authoring.md).**
> The replacement U6 uses Blender armature/bone rigging as the primary `rig_contract` creation path.
> The REST route and manual MCP tools below remain as fallbacks.
> A new U6b (Blender environment bootstrap) is also added by the amendment.

**Goal:** ~~Add REST route + MCP tool for rig contract creation.~~ Wire `workbench_create_actor_visual_profile()` into the bundle workflow (FL-3868). Add a bridge that suggests rig contract socket offsets from the existing mounted calibration artifact format.

**Requirements:** FL-3868 (wired ActorVisualProfile); FL-3867 (authoring surface); §2.15.4 pipeline-v3 authoring implication.

**Dependencies:** U1, U2

**Files:**
- `src/pipeline_v2/service.py` — `workbench_create_rig_contract()` function; wire `workbench_create_actor_visual_profile()` into `create_bundle()` path
- `src/pipeline_v2/app.py` — `POST /api/workbench/rig-contract`, `GET /api/workbench/rig-contract/{id}`
- `scripts/workbench_mcp_server.py` — `create_rig_contract` tool, `suggest_rig_contract_from_calibration` tool
- `tests/test_rig_contract_backend.py` — new test file covering routes + service functions

**Approach:**
- `workbench_create_rig_contract()` takes a `rig_definition_id`, an optional description, and a `sockets` dict (keyed by socket name, value is a list of 8 `{angle, dx, dy}` entries). It validates against `config/rig_contract_schema.json` and writes the contract to the working bundle's `positive.bundle.json`.
- `suggest_rig_contract_from_calibration` MCP tool reads an existing calibration artifact file path and returns a suggested `rig_contract` object with `rider_pelvis` socket offsets pre-populated from the calibration data. The author can copy this into a `create_rig_contract` call.
- `workbench_create_actor_visual_profile()` gains a call from `create_bundle()` — when bundle is created with a `rig_definition_id`, the function initializes an `ActorVisualProfile` stub and writes it to the session.

**Patterns to follow:** How `compute_mounted_rider_calibration()` and `accept_mounted_cell_proposals()` are structured in `service.py` — same service-layer pattern with session-scoped artifact writes.

**Test scenarios:**
- `POST /api/workbench/rig-contract` with valid body → 200 with contract ID
- `POST /api/workbench/rig-contract` with missing socket name → 400 with validation error naming the socket
- `GET /api/workbench/rig-contract/{id}` → returns the saved contract JSON
- `suggest_rig_contract_from_calibration` with a valid calibration artifact path → returns `rig_contract` object with `rider_pelvis.angle_offsets` matching the calibration data
- `suggest_rig_contract_from_calibration` with a missing file → returns clear error, not a traceback
- `create_bundle()` with `rig_definition_id` set → `workbench_create_actor_visual_profile()` is called; ActorVisualProfile stub is written to session
- `create_bundle()` with `rig_definition_id=null` → no ActorVisualProfile stub, no error

**Verification:** MCP tool call `create_rig_contract` writes a parseable contract to the bundle. `suggest_rig_contract_from_calibration` returns offsets consistent with an actual calibration artifact on disk.

---

### U7. Visual proof gate — mounted wolf + crossbow alignment at 8 angles

**Goal:** Produce headed visual proof that the wolfie + crossbow `RenderPlan` rows from `render_plans.json` render with correct rider/body/wearable/weapon alignment at all 8 angles. Commit screenshots as evidence artifacts. Update FL-3867 and UQ-008 with dated evidence.

**Requirements:** UQ-008 (mounted-family parity proof); FL-3867 (visual proof gate closure); §2.15.0.1 (rig seam closure condition).

**Dependencies:** U4, U5, U6

**Files:**
- `tests/test_rig_seam_visual_proof.py` — defines proof fixture: wolfie + player-crossbow at all 8 angles in idle and attack presentations
- `artifacts/rig-seam-proof/wolfie-crossbow-angle-{0-7}-idle.png` — one screenshot per angle
- `artifacts/rig-seam-proof/wolfie-crossbow-angle-{0-7}-attack.png` — one screenshot per angle
- `docs/plans/2026-03-23-workbench-canonical-spec.md` — update FL-3867 and UQ-008 status with dated evidence ref

**Approach:** Run the Y9-2 headed session (or workbench preview surface) with the wolfie + crossbow bundle. At each of 8 angles, capture a screenshot. Visually verify:
- Rider pelvis sits on mount saddle within ±2 cells tolerance
- Weapon grip crossbow overlay attaches cleanly at weapon_grip socket
- `mount_rear_occlusion` layer renders behind rider body
- `mount_front_occlusion` layer renders in front of rider body where applicable

The proof is human-evaluated — the implementer captures screenshots and visually confirms alignment. The test file defines the proof procedure (which bundle, which presentation keys, which angles) so the run is reproducible.

**Execution note:** This unit requires a headed Y9-2 session. Run only after U4, U5, and U6 have all completed — U4+U5 must compile and emit a valid `render_plans.json` with wolfie + crossbow keys; U6 (Blender bone authoring) must have produced an initial `wolfie_crossbow_v1` rig_contract export. If alignment is off, return to U6 (adjust bones in Blender, re-export), then recompile via U4+U5, then re-run proof. Do not close this unit until all 8 angle + 2 presentation screenshots are committed.

**Test scenarios:**
- At angle 0: rider_pelvis socket offset from `wolfie_crossbow_v1` places rider body within ±2 cells of mount saddle region in wolfie-0100 semantic map
- At angle 4 (facing opposite): same alignment tolerance holds
- Crossbow overlay (weapon_grip socket) does not visually detach from rider arm at any angle
- mount_rear_occlusion layer appears behind rider body at angles where wolf tail overlaps rider
- mount_front_occlusion layer appears in front of rider where wolf neck overlaps
- No SELECTOR_NOT_FOUND log events during the headed session with these keys
- No calls into deleted components: add a temporary `assert false` or `abort()` guard at the entry point of `bundle_presentation_resolver.cpp::FindActorBundleSelectorForRuntime()` before the proof run. If the wolfie+crossbow headed session crashes, the new path is not yet clean. If it renders without hitting the assert, the new `render_plan_lookup.cpp` path is authoritative for these keys.
- Note: the 4 surviving §2.15.1 targets (FL-3865) may still be in the call path for OTHER visual keys during the headed session. The assert guard must be narrow — only triggered for the wolfie+crossbow key family. If a narrow guard is not feasible, isolate the proof run to a bundle containing only the wolfie+crossbow keys.

**Verification:** 16 screenshots committed to `artifacts/rig-seam-proof/`. FL-3867 updated with dated headed-proof evidence. UQ-008 rig-seam residual blocker marked as cleared if alignment tolerances pass.

---

## Dependencies and Sequencing

```
U1 (rig_definition_id in key spaces)
    ↓
U2 (rig_contract schema + wolfie_crossbow_v1 data)
    ↓
U3 (semantic map socket anchors)     U4 (compiler math)     U6b (Blender env bootstrap)
                                          ↓                       ↓
                                     U5 (wire compile →      U6 (Blender authoring surface)
                                       emit render_plans.json)    ↑── depends on U1, U2, U6b
                                          ↓                  ↓
                                     U7 (visual proof) ──────┘
                                          │  (if misaligned)
                                          └──────────────────→ U6 (adjust bones, re-export)
                                                                    ↓ U4 (recompile) ↓ U7
```

U3 and U6b may run concurrently with U4 once U2 completes. U6b is a prerequisite for U6 (Blender must be available before bone authoring begins). U7 is the terminal unit — it requires U4, U5, and U6 to have produced valid output. If U7 reveals alignment errors, iterate: adjust bones in U6, recompile via U4+U5, re-run proof.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Calibration artifact offsets don't match actual render positions | Medium | High — proof fails | Run U7 with iterate-on-offset loop; the MCP `suggest_rig_contract_from_calibration` makes adjustments cheap |
| Semantic map anchor coordinates are in cell space but runtime expects pixel space | Medium | Medium — alignment off by scale factor | Confirm coordinate space in U3 before populating socket anchors; test against calibration artifact at angle 0 |
| Existing bundle tests break when `render_plans.json` becomes required | Low | Low — test fix | U5 adds `verify_current` gate; existing test fixtures may need `render_plans.json` added |
| `bundle_presentation_resolver.cpp` (still alive, FL-3865) conflicts with new path | Medium | High — renders wrong or crashes | U7 must confirm the headed render path does NOT call into the resolver for these keys. If it does, the 4 surviving §2.15.1 targets must be deleted first. |
| `rig_definition_id` null defaults break hash equality for existing sessions | Low | Low — backward compat | U1 tests confirm null hashes the same as omitted in old key format |

---

## Deferred Implementation Notes

- The exact socket-to-layer assignment logic (which layer "slot" maps to which socket name) may need to be specified in the rig_contract schema rather than inferred from slot names. Determine during U2 schema authoring — if slot→socket mapping is implicit, add an explicit `layer_slot_socket_map` field to the contract.
- Whether `visible_at_angles` should be a bitmask or boolean array in `render_plans.json` — defer to U4 runtime; the schema sketch shows boolean array which is clearer.
- `render_plans.json` binary format — JSON is the initial output. Binary optimization (FL-3861 scope) is deferred.

---

## Affected Systems

| System | Impact |
|--------|--------|
| Y9-2 bundle compiler (`appearance_bundle.py`) | New rig contract resolution loop; `render_plans.json` output |
| Y9-2 `render_plan_table.py` | New `offset_by_angle` field in `RenderPlanRow`; `rig_definition_id` in `ServerVisualKey` |
| Y9-2 `bundle_mods.py` | Compile action wired to emit `render_plans.json` |
| pipeline-v3 `service.py` | New `workbench_create_rig_contract()`; wired `workbench_create_actor_visual_profile()` |
| pipeline-v3 `app.py` | New `/api/workbench/rig-contract` routes |
| pipeline-v3 `workbench_mcp_server.py` | New `create_rig_contract` and `suggest_rig_contract_from_calibration` tools |
| `positive.bundle.json` | New `rig_contracts` array; wolfie_crossbow_v1 entry |
| `config/runtime_identity_registry.json` | New `rig_definition_id` field (nullable) |
| Semantic maps | New `socket_anchors` field in schema; wolfie-0100 and player-crossbow data |
| FL-3866, FL-3867, FL-3868 | All closed by this plan's completion |
| UQ-008 (rig seam residual blocker) | Cleared by U7 evidence |
