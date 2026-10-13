# Audit — Skin Dock Runtime Freeze After 24px XP Injection (2026-05-14)

> **Update 2026-05-15**: A proof run for Diagnosis 2 has been logged at `docs/proof-run-2026-05-15-knight-bundle.md`. Workbench bundle `b-12890330-8533-4ce3-a0fc-d2de24e53dfc` carries three knight presentation IDs (idle_walk / attack / plydie). The proof also surfaced that the `output/24px-mini-characters-template-2x/xps/` files are 2× native dims and are rejected by structural gates G7/G10 — the originally-referenced files. Native-dim variants live at `output/24px-mini-characters/xps/`. Diagnosis 1 (runtime freeze) remains OPEN.

## Executive Summary

Two distinct blockers were identified:

1. **Runtime freeze owner**: The runtime never leaves the main menu because `autoattack=1` is meaningless before the game transitions from menu to world. The `AUTO_NEW_GAME` pulse should advance the menu, but the runtime is stuck at `mainMenu=1/worldReady=0/renderStage=0`.

2. **Action-set ownership error**: Loading `knight1-attack.xp` as a single classic XP is the wrong proof target. Attack XPs must be mapped to attack override names only, not injected broadly through classic player override names. The correct test requires bundle mode with player+attack+plydie action XPs mapped to their respective override filename families.

## Diagnosis 1: Runtime Freeze Owner

### Observed State

```
wasmReady=true
hasLoad=true
canvas=true
GameMainMenuActive()=1      ← stuck in menu
GameWorldReady()=0          ← never entered world
GetRenderStageCode()=0      ← render stage zero
```

### Root Cause

The iframe URL parameters were:
```
flatmap=game_map_y8_original_game_map.a3d&autoattack=1&keybdiag=1&tracelen=30000
```

**Problem**: `autoattack=1` does NOT trigger menu advance. It only fires an attack input AFTER gameplay has started.

**CRITICAL FINDING**: The flatmap files exist in `runtime/termpp-skin-lab-static/termpp-web-flat/flatmaps/`:
```bash
$ ls -la runtime/termpp-skin-lab-static/termpp-web-flat/flatmaps/
-rw-r--r--  1 r  staff  1224751 game_map_y8_original_game_map.a3d
-rw-r--r--  1 r  staff  1870713 game_map_y8.a3d
-rw-r--r--  1 r  staff   131288 minimal_1x1.a3d
-rw-r--r--  1 r  staff   131852 minimal_2x2.a3d
```

So the freeze is NOT caused by a missing map file. The issue is one of:

1. **Skin injection timing**: XP injection via `win.Load()` may be corrupting WASM state before the game loop stabilizes
2. **Map bootstrap conflict**: The `game_map_y8_original_game_map.a3d` map may have items/world state that conflicts with the skin injection
3. **Overlay/menu race**: The flat runtime's overlay system may be blocking menu advance when skin is injected during init

From `web/termpp_flat_map_bootstrap.js:33-34, 494-506`:
```javascript
var AUTO_NEW_GAME = boolParam("autonewgame", true);
var AUTO_ATTACK = boolParam("autoattack", false);

// ...

var autoAttackFired = false;
function maybeFireAutoAttack() {
  if (!AUTO_ATTACK || autoAttackFired) return;
  // ... fires attack input via Keyb() ...
  autoAttackFired = true;
}
```

The `AUTO_NEW_GAME` parameter (default `true`) should trigger an Enter-key pulse to advance the menu. From `web/termpp_flat_map_bootstrap.js:244-280`:
```javascript
function menuProbe() {
  var out = {
    main_menu: safeCall(window.GameMainMenuActive),
    world_ready: safeCall(window.GameWorldReady),
    render_stage: safeCall(window.GetRenderStageCode),
    // ...
  };
  return out;
}

function gameplayLikelyStarted(probe) {
  if (!probe || typeof probe !== "object") return false;
  var mainMenu = (probe.main_menu === true || Number(probe.main_menu) === 1);
  var worldReady = (probe.world_ready === true || Number(probe.world_ready) === 1);
  // ...
  if (worldReady && !mainMenu) return true;
  // ...
  return false;
}
```

The bootstrap should pulse Enter when `AUTO_NEW_GAME=true`, but the runtime is stuck before that pulse can take effect.

### Likely Freeze Boundary

The runtime is stuck in one of these states:

1. **Map bootstrap failure**: `game_map_y8_original_game_map.a3d` may not exist in `web/termpp-web-flat/flatmaps/` or may be malformed
2. **WASM init race**: Skin injection may be happening before WASM is fully ready, corrupting initial state
3. **Overlay/menu state conflict**: The flat runtime's overlay system may be blocking menu advance

### Source Paths Responsible

- `web/termpp_flat_map_bootstrap.js:33-34` — AUTO_NEW_GAME / AUTO_ATTACK params
- `web/termpp_flat_map_bootstrap.js:244-280` — menuProbe() and gameplayLikelyStarted()
- `web/termpp_flat_map_bootstrap.js:494-506` — maybeFireAutoAttack()
- `web/workbench.js:73-82` — WEBBUILD_BASE_SRC construction with flatmap/autoattack params
- `web/workbench.js:973-1037` — detectWebbuildReady() polling on `_wasmReady`
- `web/workbench.js:1300-1345` — injectXpBytesIntoWebbuild() calling `win.Load(playerName)`

### Reproduction Steps

1. Start workbench: `python3 -m src.pipeline_v2.app`
2. Navigate to `http://127.0.0.1:5073/workbench?flatmap=game_map_y8_original_game_map.a3d&autoattack=1`
3. Load any XP session or upload `output/24px-mini-characters-template-2x/xps/knight1-attack.xp`
4. Click "Test This Skin" (`#webbuildQuickTestBtn`)
5. Observe runtime probe: `GameMainMenuActive()=1`, `GameWorldReady()=0`, `GetRenderStageCode()=0`

**Flatmap availability confirmed**:
```bash
$ ls -la runtime/termpp-skin-lab-static/termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d
-rw-r--r--  1 r  staff  1224751 game_map_y8_original_game_map.a3d
```

### Verification Commands

```bash
# Check if flatmap exists (CONFIRMED PRESENT)
ls -la runtime/termpp-skin-lab-static/termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d

# Check what flatmaps ARE available
ls -la runtime/termpp-skin-lab-static/termpp-web-flat/flatmaps/

# Map sizes for comparison:
# - minimal_2x2.a3d: 131KB
# - game_map_y8_original_game_map.a3d: 1.2MB (9x larger, more complex)
```

### Next Implementation Slice: Runtime Freeze

**Goal**: Prove the runtime can leave the menu and reach playable state BEFORE testing skin injection.

**Hypothesis**: The freeze is caused by skin injection timing, not missing maps. The `win.Load()` call during/after WASM init may corrupt state.

**Steps**:

1. **Test WITHOUT skin injection first** (CRITICAL):
   - Start workbench: `python3 -m src.pipeline_v2.app`
   - Navigate to `http://127.0.0.1:5073/workbench?flatmap=minimal_2x2.a3d&autonewgame=1`
   - Do NOT load any session, do NOT click "Test This Skin"
   - Wait 10 seconds
   - Open browser console and poll:
     ```javascript
     setInterval(() => {
       const win = document.getElementById('webbuildFrame').contentWindow;
       console.log('menu:', win.GameMainMenuActive?.(), 'world:', win.GameWorldReady?.(), 'stage:', win.GetRenderStageCode?.());
     }, 1000);
     ```
   - **Expected**: `menu: 1 → 0`, `world: 0 → 1` within 5 seconds
   - **If frozen**: The issue is map/bootstrap/WASM init itself, not skin injection

2. **Test with y8 map, no skin**:
   - Same as step 1 but with `flatmap=game_map_y8_original_game_map.a3d`
   - If this freezes but minimal_2x2 works, the map is the issue (too complex, missing items, etc.)

3. **Test skin injection AFTER runtime is stable**:
   - Wait for `worldReady=1` before clicking "Test This Skin"
   - If runtime freezes only when skin is injected, the issue is injection timing

4. **Add runtime state logging**:
   - In `web/workbench.js`, after skin injection, poll `menuProbe()` every 500ms for 10 seconds
   - Log: `main_menu`, `world_ready`, `render_stage`, `pos`, `grounded`, `water`
   - This proves whether the runtime ever transitions

---

## Diagnosis 2: Action-Set Ownership Error

### The Problem

Loading `knight1-attack.xp` as a single classic XP and injecting it through the classic skin path is **wrong** for testing attack animations.

From `web/workbench.js:46-67`:
```javascript
async function getWebbuildDefaultOverrideNames() {
  const reg = await fetchTemplateRegistry();
  if (!reg || !reg.prefix_catalog) {
    status("Override names unavailable: template registry not loaded", "warn");
    return [];
  }
  const pc = reg.prefix_catalog;
  const prefixes = [];
  for (const [key, spec] of Object.entries(pc)) {
    if (!spec.ahsw_range) continue;
    if (OVERRIDE_MODE === "full_parity") {
      prefixes.push(key);
    } else {
      // Default "mounted": player + mounted prefixes only.
      // Excludes attack/plydie to avoid destabilizing NPCs that share those.
      if (key === "player" || spec.mounted) prefixes.push(key);
    }
  }
  return _ahswNamesFromRegistry(pc, prefixes);
}
```

**Key finding**: In default `OVERRIDE_MODE="mounted"`, only `player` prefix is included for human skin families. Attack and plydie are EXCLUDED.

When `knight1-attack.xp` is loaded as a classic XP and injected:
- It gets written to `player-0000.xp`, `player-0001.xp`, ... `player-1112.xp` (all 16 AHSW combinations)
- The runtime uses attack geometry for idle/walk animations
- This is NOT the intended behavior: attack sprites should only appear during attack animations

### Correct Test Shape

A proper attack test requires THREE XPs mapped to THREE override families:

| XP File | Override Family | Runtime Role |
|---------|----------------|--------------|
| `knight1-player.xp` | `player-*` | idle/walk animations |
| `knight1-attack.xp` | `attack-*` | attack animations (weapon ≥ 1) |
| `knight1-plydie.xp` | `plydie-*` | death/fall animations |

From `config/template_registry.json`:
```json
"prefix_catalog": {
  "player": {
    "runtime_role": "on_foot_idle_walk",
    "ahsw_range": "all_16"
  },
  "attack": {
    "runtime_role": "on_foot_attack",
    "ahsw_range": "weapon_gte_1"
  },
  "plydie": {
    "runtime_role": "on_foot_fall_death",
    "ahsw_range": "all_16"
  }
}
```

### Bundle Mode: The Correct Path

Bundle mode exists and handles this correctly:

From `src/pipeline_v2/service.py:4477-4539`:
```python
def workbench_web_skin_bundle_payload(bundle_id: str, req_id: str) -> dict[str, Any]:
    """Build per-action XP bytes + target filenames for bundle WASM injection."""
    # ...
    for act_key, action_spec in ts.get("actions", {}).items():
        family = action_spec.get("family", "")
        # ...
        ahsw_range = action_spec.get("ahsw_range", "all_16")
        override_names = _action_override_names(family, ahsw_range)
        
        actions_payload[act_key] = {
            "xp_b64": base64.b64encode(raw).decode("ascii"),
            "override_names": override_names,
            # ...
        }
```

From `web/workbench.js:1349-1378`:
```javascript
async function injectBundleIntoWebbuild(win, bundlePayload) {
  // ...
  for (const [actionKey, actionData] of Object.entries(bundlePayload.actions || {})) {
    const xpBytes = b64ToUint8Array(actionData.xp_b64 || "");
    const names = await normalizeWebbuildOverrideNames(actionData.override_names);
    for (const name of names) {
      emfsReplaceFile(M, `/sprites/${name}`, xpBytes);
    }
  }
  // ...
}
```

### Why Bundle Mode Isn't Being Used

**Audit Question 1**: Does current workbench UI support creating a bundle directly from generated 24px XP triplet?

**Answer**: NO — not directly. The workbench bundle flow requires:
1. A template set (e.g., `player_native_full`)
2. Sessions for each required action (idle, attack, death)
3. Each session must be saved with correct template metadata

The 24px XP files in `output/24px-mini-characters-template-2x/xps/` are:
- Raw XP files without template session metadata
- Not associated with any bundle
- Not mapped to template actions

**Audit Question 2**: Does `/api/workbench/web-skin-bundle-payload` emit separate `player`, `attack`, `plydie` action payloads?

**Answer**: YES — if the bundle has sessions for those actions. From `service.py:4539`:
```python
override_names = _action_override_names(family, ahsw_range)
```

This generates:
- `player-*` for `family="player"`, `ahsw_range="all_16"` (16 files + `player-nude.xp`)
- `attack-*` for `family="attack"`, `ahsw_range="weapon_gte_1"` (12 files, W ∈ {1,2})
- `plydie-*` for `family="plydie"`, `ahsw_range="all_16"` (16 files)

**Audit Question 3**: Does Skin Dock in bundle mode actually inject attack/plydie names?

**Answer**: YES — bundle mode injects ALL action payloads, regardless of `OVERRIDE_MODE`. From `workbench.js:1468-1478`:
```javascript
if (useBundlePayload) {
  // Bundle injection: per-action XP bytes
  // ...
  inject = await injectBundleIntoWebbuild(win, j);
}
```

The `OVERRIDE_MODE` filter only affects classic single-XP path via `getWebbuildDefaultOverrideNames()`.

**Audit Question 4**: Does `overridemode=full_parity` fix override-name coverage?

**Answer**: YES — from `workbench.js:57-65`:
```javascript
if (OVERRIDE_MODE === "full_parity") {
  prefixes.push(key);  // ALL prefixes with ahsw_range
} else {
  // Default "mounted": player + mounted prefixes only.
  if (key === "player" || spec.mounted) prefixes.push(key);
}
```

With `overridemode=full_parity`, classic single-XP injection would write to player+attack+plydie override names. BUT this is still wrong because:
- A single XP cannot provide different geometry for different actions
- The runtime expects DIFFERENT XP bytes for player vs attack vs plydie

### Source Paths Responsible

- `web/workbench.js:46-67` — `getWebbuildDefaultOverrideNames()` with OVERRIDE_MODE filter
- `web/workbench.js:28` — `OVERRIDE_MODE` default `"mounted"`
- `web/workbench.js:1349-1378` — `injectBundleIntoWebbuild()` per-action injection
- `web/workbench.js:1299-1345` — `injectXpBytesIntoWebbuild()` single-XP injection
- `src/pipeline_v2/service.py:88-107` — `_termpp_skin_override_names()` for classic path
- `src/pipeline_v2/service.py:4269-4290` — `_action_override_names()` for bundle path
- `src/pipeline_v2/service.py:4477-4539` — `workbench_web_skin_bundle_payload()`
- `src/pipeline_v2/service.py:4224-4256` — `workbench_web_skin_payload()`
- `config/template_registry.json` — `prefix_catalog` with `ahsw_range` and `runtime_role`

### Next Implementation Slice: Bundle Proof

**Goal**: Prove the bundle path can correctly stage 24px outputs as player/attack/plydie action XPs with correct override names.

**Steps**:

1. **Create a minimal bundle manually**:
   ```bash
   # This requires workbench UI or API calls to:
   # 1. Create a bundle with template_set_key="player_native_full"
   # 2. Create three sessions: idle (player), attack (attack), death (plydie)
   # 3. Import knight1-player.xp, knight1-attack.xp, knight1-plydie.xp into respective sessions
   # 4. Save each session
   # 5. Export bundle payload
   ```

2. **Alternative: Use `overridemode=full_parity` for quick proof**:
   - This is NOT the correct long-term solution but can prove override names are reachable
   - URL: `http://127.0.0.1:5073/workbench?overridemode=full_parity&flatmap=minimal_2x2.a3d`
   - Load `knight1-player.xp` as classic session
   - Click "Test This Skin"
   - Verify override names include `player-*` AND `attack-*` AND `plydie-*`

3. **Build a bundle creation script**:
   - Create `scripts/create_24px_bundle.py` that:
     - Reads 24px XP triplet (player/attack/plydie)
     - Creates a bundle session via API
     - Maps each XP to correct template action
     - Saves and returns bundle_id
   - This enables automated bundle testing

4. **Test bundle injection**:
   - Use bundle_id from step 3
   - Click "Test Bundle Skin" in workbench
   - Verify runtime receives:
     - `player-*` files with knight1-player geometry
     - `attack-*` files with knight1-attack geometry
     - `plydie-*` files with knight1-plydie geometry
   - Trigger attack animation in runtime
   - Verify attack frames show attack geometry, not player geometry

---

## Combined Next Steps

### Priority 1: Isolate Runtime Freeze (DO THIS FIRST)

**CRITICAL**: Do NOT test skin injection until you prove the runtime can reach playable state without any skin.

```bash
# 1. Start workbench
python3 -m src.pipeline_v2.app

# 2. Navigate to minimal map (NO SKIN, NO SESSION)
# http://127.0.0.1:5073/workbench?flatmap=minimal_2x2.a3d&autonewgame=1

# 3. Open browser console and poll runtime state
setInterval(() => {
  const win = document.getElementById('webbuildFrame').contentWindow;
  console.log('menu:', win.GameMainMenuActive?.(), 'world:', win.GameWorldReady?.(), 'stage:', win.GetRenderStageCode?.());
}, 1000);

# Expected output after 5 seconds:
# menu: 0  (left main menu)
# world: 1  (world ready)
# stage: 70+  (render stage advanced)
```

**Decision tree**:

| Result | Next Step |
|--------|-----------|
| minimal_2x2 frozen, no skin | WASM/bootstrap bug — debug `termpp_flat_map_bootstrap.js` |
| minimal_2x2 OK, y8 frozen | Map-specific issue — y8 map may have invalid state |
| Both OK without skin | Skin injection is the freeze trigger — test injection timing |

### Priority 2: Fix Runtime Freeze (if needed)

If skin injection triggers the freeze:

1. **Delay injection until runtime stable**:
   - In `web/workbench.js:applyCurrentXpAsWebSkin()`, wait for `worldReady=1` before calling `injectXpBytesIntoWebbuild()`
   
2. **Test preboot mode**:
   - URL: `http://127.0.0.1:5073/workbench?overridemode=preboot&flatmap=minimal_2x2.a3d`
   - Preboot injects BEFORE `Load()` — may avoid the race

### Priority 3: Build Bundle Creation Path

Once runtime is proven working:

1. Create `scripts/create_24px_test_bundle.py`:
   - Input: character prefix (e.g., `knight1`)
   - Reads: `output/24px-mini-characters-template-2x/xps/{prefix}-player.xp`, `-attack.xp`, `-plydie.xp`
   - Calls workbench API to create bundle with `player_native_full` template
   - Creates three sessions, imports XPs, saves
   - Returns `bundle_id`

2. Test in workbench:
   - Navigate to `http://127.0.0.1:5073/workbench?flatmap=minimal_2x2.a3d`
   - Load bundle via API or UI
   - Click "Test Bundle Skin"
   - Verify attack animation shows attack geometry

### Priority 3: Document Correct Proof Target

Update `docs/PLAYWRIGHT_FAILURE_LOG.md` with:

- **Wrong proof**: Single XP import + "Web skin applied" status
- **Correct proof**: Bundle with player+attack+plydie + runtime leaves menu + attack animation shows attack geometry
- **Gate checklist**:
  1. Runtime reaches `worldReady=1` (no skin)
  2. Bundle payload has 3 actions with correct override names
  3. Skin injection writes to `player-*`, `attack-*`, `plydie-*` separately
  4. Runtime shows idle/walk with player geometry
  5. Runtime shows attack with attack geometry when triggered

---

## Appendix: Key Source References

### Runtime Probe Functions

```javascript
// web/termpp_flat_map_bootstrap.js:244-280
function menuProbe() {
  var out = {
    main_menu: safeCall(window.GameMainMenuActive),
    world_ready: safeCall(window.GameWorldReady),
    render_stage: safeCall(window.GetRenderStageCode),
    pos: ...,
    water: ...,
    grounded: ...,
  };
  return out;
}
```

### Override Name Generation

```python
# src/pipeline_v2/service.py:4269-4290
def _action_override_names(family: str, ahsw_range: str) -> list[str]:
    names: list[str] = []
    if ahsw_range == "all_16":
        if family == "player":
            names.append("player-nude.xp")
        for a in range(2):
            for h in range(2):
                for s in range(2):
                    for w in range(3):
                        names.append(f"{family}-{a}{h}{s}{w}.xp")
    elif ahsw_range == "weapon_gte_1":
        for a in range(2):
            for h in range(2):
                for s in range(2):
                    for w in (1, 2):
                        names.append(f"{family}-{a}{h}{s}{w}.xp")
    return names
```

### Bundle Payload Structure

```python
# src/pipeline_v2/service.py:4520-4539
actions_payload[act_key] = {
    "xp_b64": base64.b64encode(raw).decode("ascii"),
    "override_names": override_names,
    "xp_size_bytes": len(raw),
    "checksum": export["checksum"],
    "family": family,
    "runtime_identity": runtime_identity_for_action(...),
}
```

### Workbench Bundle Mode Detection

```javascript
// web/workbench.js:7450
function isBundleMode() {
  return !!state.bundleId;
}
```
