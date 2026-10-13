# Proof Run — 2026-05-15: Knight bundle with three presentation IDs

> **CORRECTION — 2026-05-15 (later that day):** The "Workbench URL" end-state described below (opening `?bundle_id=<id>&flatmap=...`) is **NOT reachable** via the supported workbench frontend. Source-truth verification (`rg "bundle_id|loadBundle|params.get" web/workbench.js src/pipeline_v2/app.py`) shows:
>
> - `web/workbench.js` does **not** parse `bundle_id` from URL parameters (only `job_id`, `flatmap`, `autonewgame`, `autoattack`, `overridemode`, `uirecord` are URL-parsed).
> - There is **no** `loadBundle` function in `web/workbench.js`.
> - `state.bundleId` is set in exactly one place: `web/workbench.js:7846`, immediately after `POST /api/workbench/bundle/create` succeeds. There is no other write to `state.bundleId`.
> - `src/pipeline_v2/app.py` exposes no GET endpoint to fetch a bundle by id. The HTTP surface is `bundle/create` (POST), `action-grid/apply` (POST), `bundle/action-status` (POST), `export-bundle` (POST), `web-skin-bundle-payload` (POST). The `load_bundle` symbol is imported at app.py:55 but is not wired to any route.
>
> Consequence: opening `http://127.0.0.1:5073/workbench?bundle_id=b-12890330-...` lands on an **empty workbench** with `bundleStatus=""`, `sessionOut=""`, and `#webbuildQuickTestBtn` disabled with title "Disabled: load or create a session first". This was directly observed in a HEADED playwright run on 2026-05-15.
>
> **What still holds below:** The bundle JSON on disk and the per-action payload from `POST /api/workbench/web-skin-bundle-payload` are valid — the three presentation IDs (`600 / 601 / 602`) are real and the payload endpoint returns a correctly-shaped result with three action XPs. That part of the proof is intact.
>
> **What does NOT hold:** any claim that the workbench in a browser session was actually displaying three loaded knight action tabs from the URL. That UI state was never reached.
>
> See companion FL entry "Bundle hydration gap" in `docs/PLAYWRIGHT_FAILURE_LOG.md`.

Companion to `docs/audit-2026-05-14-skin-dock-runtime-freeze.md` (Diagnosis 2).

## Evidence files

- Bundle JSON: `data/bundles/b-12890330-8533-4ce3-a0fc-d2de24e53dfc.json`
- Bundle backup (pre-patch): `data/bundles/b-12890330-8533-4ce3-a0fc-d2de24e53dfc.json.preknight.bak`
- Verify-step API responses: `/tmp/claude-bundle-create.json`, `/tmp/claude-bundle-payload-v2.json`
- Upload-step API responses: `/tmp/claude-knight-{player,attack,plydie}-native.json`

## Bundle

- `bundle_id`: `b-12890330-8533-4ce3-a0fc-d2de24e53dfc`
- `template_set_key`: `player_native_full`

## Three presentation IDs (per `/api/workbench/web-skin-bundle-payload` response)

Evidence: `/tmp/claude-bundle-payload-v2.json`

| Action | Family  | XP size | Override names                              | `presentation_kind_id` | `layer_definition_id` | Session                                  |
|--------|---------|--------:|---------------------------------------------|-----------------------:|----------------------:|------------------------------------------|
| idle   | player  |  3174 B | 25 (`player-nude.xp` + 24 AHSW)             | **600** (idle_walk)    | 700                   | `aa3d4690-3eab-4e99-a24e-a35520426abc`   |
| attack | attack  |  4716 B | 16 (`weapon_gte_1`)                         | **601** (attack)       | 701                   | `45104152-066c-4293-9b49-f533c8f66b75`   |
| death  | plydie  |  1456 B | 24                                          | **602** (plydie)       | 702                   | `f48f6b98-6fd3-46be-9828-b4d7f0cb775a`   |

All three share `skin_definition_id=100` (human). Payload top-level: `reload_player_name="player"`, `unmapped_families=[]`.

## XP source

`output/24px-mini-characters/xps/knight1-{player,attack,plydie}.xp` (native template dims).

The `output/24px-mini-characters-template-2x/xps/` variants the original incident referenced are **2× native dims** (252×160 / 288×160 / 220×176) and are rejected by structural gates G7 (cell count) and G10 (action_dims). The bundle path surfaces this; the classic single-XP path silently injected those into wrong override slots.

| File                                                          | Dims      | Layers | Matches template?      |
|---------------------------------------------------------------|-----------|-------:|------------------------|
| `24px-mini-characters/xps/knight1-player.xp`                  | 126×80    | 4      | yes (idle 126×80, 4)   |
| `24px-mini-characters/xps/knight1-attack.xp`                  | 144×80    | 4      | yes (attack 144×80, 4) |
| `24px-mini-characters/xps/knight1-plydie.xp`                  | 110×88    | 3      | yes (death 110×88, 3)  |
| `24px-mini-characters-template-2x/xps/knight1-player.xp`      | 252×160   | 4      | no — G7/G10 reject     |
| `24px-mini-characters-template-2x/xps/knight1-attack.xp`      | 288×160   | 4      | no — G7/G10 reject     |
| `24px-mini-characters-template-2x/xps/knight1-plydie.xp`      | 220×176   | 3      | no — G7/G10 reject     |

## Reproduction (commands run 2026-05-15)

```bash
# 1. Kill stale playwright (held bad-test demo from prior session)
kill 34516

# 2. Create bundle
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"template_set_key":"player_native_full"}' \
  http://127.0.0.1:5073/api/workbench/bundle/create

# 3. Upload three native knight XPs (separate calls — keyword-free shell)
curl -s -X POST -F "file=@output/24px-mini-characters/xps/knight1-player.xp" http://127.0.0.1:5073/api/workbench/upload-xp
curl -s -X POST -F "file=@output/24px-mini-characters/xps/knight1-attack.xp" http://127.0.0.1:5073/api/workbench/upload-xp
curl -s -X POST -F "file=@output/24px-mini-characters/xps/knight1-plydie.xp" http://127.0.0.1:5073/api/workbench/upload-xp

# 4. Patch data/bundles/<bundle_id>.json — set each action's session_id, status="converted",
#    source_path=<xp path>. Preserve runtime_identity emitted by create_bundle.

# 5. Verify payload
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"bundle_id":"b-12890330-8533-4ce3-a0fc-d2de24e53dfc"}' \
  http://127.0.0.1:5073/api/workbench/web-skin-bundle-payload
```

## Workbench URL

```
http://127.0.0.1:5073/workbench?bundle_id=b-12890330-8533-4ce3-a0fc-d2de24e53dfc&flatmap=minimal_2x2.a3d
```

Returns HTTP 200 (curl 2026-05-15). Opens the workbench with the bundle attached; three action tabs (idle / attack / death) carry the knight sessions.

## MONITORING — items NOT covered by this proof

- **Runtime freeze (Diagnosis 1)** remains OPEN. This proof does not exercise the WASM Skin Dock injection path. Reaching `worldReady=1` with the bundle injected is the next slice; the minimal-map-no-skin baseline test from "Priority 1" of the audit should run first. Evidence boundary: `/api/workbench/web-skin-bundle-payload` is server-side; the live runtime injection path begins at `web/workbench.js:1349 injectBundleIntoWebbuild`.
- **Attack-animation-shows-attack-geometry** remains OPEN. Requires the runtime to leave the menu and trigger the attack input on the live canvas. Evidence boundary: `web/termpp_flat_map_bootstrap.js:494 maybeFireAutoAttack`.

## Gap surfaced during the proof (worth follow-up)

No API exists to attach a pre-baked XP to an existing bundle action: `bundle_action_run` (src/pipeline_v2/service.py:3608) re-runs the full pipeline from a raw PNG source. The proof patched the bundle JSON directly. A small `POST /api/workbench/bundle/attach-xp` (action_key + xp_bytes → uploads XP, swaps session_id, sets status=converted) would remove the patch step and make the flow scriptable end to end.
