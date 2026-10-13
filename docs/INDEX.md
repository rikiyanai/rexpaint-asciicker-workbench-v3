# Docs Index

Canonical doc hub for agents working in this repo checkout.

## Non-Negotiable Constraints

- **Self-containment**: This repo must be 100% self-contained. No runtime, test, or build-time dependency on external folders (e.g. `/Users/r/Downloads/asciicker-Y9-2`, `/Users/r/Downloads/n`).
- All sprites, runtime assets, `.web` files, `.a3d` maps, fonts — everything the workbench needs must live inside this repo.
- Symlinks pointing outside the repo are violations.

## Document Authority Model

This repo uses a 2-doc canonical authority model. Agents must treat ONLY these 2 docs as authority for active execution state:

| # | Doc | Role |
|---|-----|------|
| 1 | `PLAYWRIGHT_FAILURE_LOG.md` | Reality/failure/proof log — ground truth for what actually happened |
| 2 | `docs/plans/2026-03-23-workbench-canonical-spec.md` | Normative requirements, roadmap, bug-priority, active execution truth |

### Doc Classifications

| Classification | Examples | Rule |
|---------------|----------|------|
| **Canonical** | The 2 docs above | Only source of active truth; update in-place |
| **Structural Contract** | `XP_EDITOR_ACCEPTANCE_CONTRACT.md`, `PNG_STRUCTURAL_BASELINE_CONTRACT.md` | Stable normative contracts; update only on milestone boundary |
| **Reference** | `COMPLETE_UI_CONTROL_REFERENCE.md`, `REXPAINT_MANUAL.txt`, `REXPAINT_UI_COMPLETE_INDEX.md` | Stable reference material; does not claim active state |
| **Worksheet** | `CLAUDE-HANDOFF-*.md`, most `docs/plans/*.md`, `docs/research/*` | Temporary; must be retired via `scripts/doc_lifecycle_stitch.sh` after completion |
| **Archive** | `docs/WORKBENCH_DOCS_ARCHIVE.md` | Retired worksheets; append-only via stitch script |

### Retirement Policy

- Completed or superseded worksheets MUST be retired using `scripts/doc_lifecycle_stitch.sh`.
- The stitch script appends to the archive, rewrites repo-wide references, deletes the original, and logs to the failure log.
- Canonical docs and structural contracts are protected — the script refuses to archive them.
- Do not create new authority docs. If a canonical doc is insufficient, update it in-place.

## Current Branch Truth

- Audit date: 2026-03-24
- Audited worktree: current repo checkout
- Audited branch: `master`
- Audited HEAD: `87ab20d`
- Current branch role: active M2 acceptance and verifier architecture line; MVP deployment live at `rikiworld.com/xpedit`; M2-D registry expansion landed (77 entries); login reskin shipped; BUG-01 grid overlay fixed; player-state parity audit complete
- **Self-containment**: This repo must be 100% self-contained. No runtime, test, or build-time dependency on external folders (e.g. `/Users/r/Downloads/asciicker-Y9-2`, `/Users/r/Downloads/n`). Run `python3 scripts/self_containment_audit.py` at startup.

Do not assume `master` is the canonical restore/bundle line. For bundle/runtime issues, read the branch-history handoff below before making fix claims.

## Canonical Read Order

1. `AGENTS.md`
2. this file
3. `docs/AGENT_PROTOCOL.md`
4. `CLAUDE.md`
5. current live branch/worktree state
6. latest task-relevant handoff
7. focused subsystem docs and plan docs

If a lower-priority doc conflicts with a higher-priority source or with current code, treat the lower-priority doc as historical until corrected.

## Current Milestone

- The overall product goal remains **full XP-file editor parity** as defined in `docs/XP_EDITOR_ACCEPTANCE_CONTRACT.md`.
- Current doc-routing correction (2026-06-11): mobile XP intake is proven enough
  to expose a product blocker in the first-screen workbench UX. Read
  `PLAYWRIGHT_FAILURE_LOG.md` rows `FL-MOB-01`, `FL-DOC-ROUTE-01`,
  `FL-PRINT-01`, and the canonical spec queue rows `UQ-013` / `UQ-014` before
  implementing mobile pruning or printable grid-paper work. As of 2026-06-13,
  UQ-013 mobile usability leads: broad prune implementation waits on an approved
  mobile Open Workbench design.
- **Milestone 1 is closed.** It is the baseline, not the active workstream.
- The current working milestone is **Milestone 2: practical PNG ingest and manual assembly**.
- Milestone 2 means:
  - preserve the arbitrary-PNG structural ingest baseline
  - support practical uploaded-PNG workflows through shipped controls
  - make source-panel extraction, source-to-grid assembly, and whole-sheet correction acceptance-provable
  - drive verifier progress through the canonical SAR/action-response model rather than ad hoc workflow claims
- Milestone 2 does **not** mean perfect automatic slicing, full existing-XP parity, or full REXPaint parity.
- A canonical XP verifier family now exists in `scripts/xp_fidelity_test/`, including bundle workflow runners. Do not reuse the deleted blank-flow single-frame harness as evidence.
- Do not start broader REXPaint UX/UI redesign as if full parity is already proven. The current work is M2 acceptance, proof, and repeatability on the PNG/manual-assembly line.

## Explicit Milestone Definitions

### Milestone 1: bundle-native new-XP authoring viability

Milestone 1 is complete only when all of the following are true:

- shipped whole-sheet controls can create/edit the required native bundle actions:
  - `idle`
  - `attack`
  - `death`
- the bundle workflow preserves the intended structure, layers, and export/runtime contract
- the authoring loop is usable enough for normal work:
  - save
  - export
  - test/apply
- canonical verifier evidence passes in an acceptance-eligible mode, with final signoff coming from `full_recreation`
- manual/runtime review and repeatability are good enough to support an honest milestone-close claim
- the save-first authoring loop is honest and usable:
  - users can save progress without being forced to download an XP file
  - bundle readiness is not coupled only to export/download side effects
- the shipped MVP UI includes an easy bug-report path for pre-alpha users:
  - visible entrypoint near the pre-alpha warnings
  - structured report fields instead of free-text-only reporting
  - automatic inclusion of useful session/runtime metadata when available
  - local report persistence at minimum, with GitHub issue or email fallback as follow-up wiring
- workflow-state bugs that are hard to reproduce manually should be covered by the dedicated Milestone 1 edge-case verifier lane, not forced into `full_recreation`
- verifier architecture is now explicitly split into:
  - XP truth tables for fidelity/oracle comparison
  - a workbench-wide SAR model (state/action/response) for workflow truth

Current 2026-03-21 closeout truth:

- the save-first workflow patch has landed in `14d99d6`
  - top-level `Save`
  - persisted `blank` / `saved` / `converted` action states
  - bundle readiness based on `saved|converted`
  - dirty-save protection on bundle switching / `New XP`
- the narrow verifier canvas-targeting patch has landed in `aed6e40`
  - safer centered canvas targeting
  - locator-relative click path
  - drag targeting brought in line with the safer click discipline
- both changes are implemented for the next acceptance reruns, but Milestone 1 is not closed until they are verified through the canonical `full_recreation` and manual/runtime loop

> **2026-03-23 status correction:** Milestone 1 IS now closed on canonical root-hosted master. Evidence: PLAYWRIGHT_FAILURE_LOG.md records commit 14e8e95 with 7/7 edge-workflow PASS (partial_bundle_gating, action_tab_hydration, 5× generated_sar recipes), Skin Dock PASS, and base-path verification showing 0 `/xpedit`-specific regressions. The "not closed until verified" clause above has been satisfied. M2-A structural PNG baseline is also established (9/9 gate verdicts PASS). See `docs/plans/2026-03-23-m2-capability-canon-inventory.md` for the full M2 capability audit.

Milestone 1 is **not**:

- full existing-XP load/edit/export parity
- full REXPaint feature parity
- generalized PNG slicing correctness

### Milestone 2: practical PNG ingest and manual assembly

Milestone 2 begins only after Milestone 1 closes.

Milestone 2 is complete only when all of the following are true:

- the arbitrary-PNG structural ingest baseline is protected by a non-regression contract and test path
- uploaded PNG workflows are practical through shipped controls:
  - source-panel bbox extraction
  - manual source-to-grid assembly
  - whole-sheet correction/editing
- auto-slicing/analyze are assistive hints, not authoritative truth
- canonical human-verified semantic dictionaries exist for the enabled native families
- semantic editing can safely build on those dictionaries
- the arbitrary-PNG structural ingest baseline remains deployable from this repo alone, including committed runtime payload assets

Milestone 2 is **not**:

- perfect automatic slicing for arbitrary sprite sheets
- full existing-XP parity
- full REXPaint parity

## Structural Contracts

- `docs/PNG_STRUCTURAL_BASELINE_CONTRACT.md`
  - non-regression contract for the arbitrary-PNG structural ingest baseline; protects the Milestone 1 structural checkpoint (PNG → bundle apply → valid XP → editor load/export → runtime-safe injection) during Milestone 2 work
- `docs/XP_EDITOR_ACCEPTANCE_CONTRACT.md`
  - canonical acceptance contract for XP-editor parity

## Launch / Deployment Truth

Canonical deployment doc: `docs/WORKBENCH_DOCS_ARCHIVE.md#mvp-deployment`

Related docs:
- `docs/WORKBENCH_DOCS_ARCHIVE.md#host-deployment-checklist` — step-by-step host provisioning and config
- `docs/WORKBENCH_DOCS_ARCHIVE.md#launch-readiness-checklist` — all launch gates with current status
- `docs/WORKBENCH_DOCS_ARCHIVE.md#base-path-support-checklist` — exact work required before safe subpath hosting such as `/asciicker-XPEdit`
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-22-base-path-support-plan` — detailed implementation plan for `PIPELINE_BASE_PATH` support (config, routing, frontend, runtime iframe, proxy, acceptance criteria, phased rollout)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#reskin-prep` — safe font/CSS reskin surface
- `deploy/README.md` — deployment config quick start

Summary:
- MVP is server-backed Flask, not static GitHub Pages
- committed runtime payload under `runtime/termpp-skin-lab-static` is part of the deployable product
- `/xpedit` subpath hosting is live at `https://rikiworld.com/xpedit`; Cloud Run deploy run `23479759126` passed and both direct + public smoke checks passed on 2026-03-24
- GitHub Actions `deploy-cloudrun.yml` handles build → push → deploy → smoke test
- Bug report → GitHub Issue delivery is live via GCP Secret Manager (`bug-report-github-token`). Any visitor can file bugs from the workbench UI. Verified with Issues #6 and #7 (2026-03-24).
- Cloudflare Worker routes both bare `/xpedit` and `/xpedit/*` to Cloud Run; all other paths pass through to GitHub Pages
- VPS/nginx/systemd configs remain in `deploy/` as documented alternatives
- The runtime payload must remain committed inside this repo. Do not reintroduce any dependency on external runtime folders.
- Pipeline runs on Cloud Run free tier are very slow (>5 min for cat_sheet.png). Verifier tests requiring pipeline runs are impractical against the live deployment without increased resources.
- Verifier scripts remain offline QA tools, not required production-host dependencies.

## UI Reskin Constraint

- A visual reskin is allowed only if it is presentation-only:
  - CSS
  - fonts
  - color/spacing/border styling
- Do **not** replace the workbench with an external site template or component system during Milestone 1 closeout.
- Safe reskin rule:
  - existing DOM ids, JS hooks, workflows, and behavior must remain unchanged
  - font/style-only changes are acceptable
  - behavior-preserving typography updates are acceptable
- In particular, `www-server-mono` may be used as a font/style reference only, not adopted as a full app/template.

## First Reads By Task

### Any agent startup

- `AGENTS.md`
- `docs/AGENT_PROTOCOL.md`
- `CLAUDE.md`
- `docs/XP_EDITOR_ACCEPTANCE_CONTRACT.md`
- `python3 scripts/conductor_tools.py status --auto-setup`
- `python3 scripts/self_containment_audit.py`

### Editor/doc status or plan audits

- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-13-claim-verification`
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-13-claude-handoff-editor-doc-alignment`

### Bundle/runtime/restore regressions

- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-11-claude-handoff-current-state`
- `docs/WORKBENCH_DOCS_ARCHIVE.md#workbench-iframe-keyboard-stuck-handoff`

## Active High-Signal Docs

> **2026-03-23 restructure:** This section now reflects the 3-doc canonical model. For the canonical authority docs, see "Document Authority Model" above. For the full non-canonical classification, see "Non-Canonical Doc Classification" below.

### Active Plans (retain until completed/superseded)

- `docs/plans/2026-03-21-milestone-2-practical-png-ingest-plan.md`
  - strategic M2 plan: structural baseline, source-panel/manual assembly, whole-sheet correction, semantic dictionaries
- `docs/plans/2026-03-21-milestone-2-png-verifier-design.md`
  - M2 verifier design — architecture input for canonical spec §5
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-milestone-2-implementation-checklist`
  - implementation checklist with EXISTS/PARTIAL/MISSING per item
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-22-base-path-support-plan`
  - base-path implementation plan — partially implemented
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-23-milestone-2-base-path-unified-verifier-plan`
  - unified verifier plan for M2 slices
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-15-xp-editor-hard-fail-plan`
  - hard-fail plan — active for verifier discipline
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-legacy-inspector-retirement-checklist`
  - inspector demotion checklist for M2-C.1

### Key Reference Docs

- `docs/COMPLETE_UI_CONTROL_REFERENCE.md` — 189 workbench UI elements (DOM IDs, handlers); implementation reference for `action_registry.json`
- `docs/WORKBENCH_DOCS_ARCHIVE.md#workbench-source-panel-ux-checklist` — source panel feature tracking and UX acceptance criteria
- `docs/plans/2026-03-22-workbench-sar-table-blueprint.md` — exhaustive SAR state-field mapping from code; needed for action_registry implementation
- `docs/plans/2026-03-23-state-capture-contract.md` — getState/\_state API contract for all verifier code
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-23-milestone-2-bug-gap-index` — active bug/gap tracking
- `docs/research/ascii/2026-03-15-xp-data-contract.md` — code-backed XP binary format contract
- `docs/research/ascii/2026-03-20-bundle-animation-types.md` — bundle/animation type map
- `docs/research/ascii/2026-03-21-player-sprite-semantic-dictionary-seed.md` — semantic dictionary seed

### Worksheets — Retired

8 superseded worksheets archived via `scripts/doc_lifecycle_stitch.sh`:

- [claude-workbench-ui-inventory (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#claude-workbench-ui-inventory) — superseded by COMPLETE_UI_CONTROL_REFERENCE
- [workbench-verifier-sar-model (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-22-workbench-verifier-sar-model) — architecture absorbed into canonical spec §5
- [M2 PNG verifier design handoff (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-claude-handoff-m2-png-verifier-design) — handoff for completed verifier design
- [edge-case-verifier-impl-plan (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-22-edge-case-verifier-impl-plan) — M1 closed, implementation details no longer active
- [login-screen-reskin-handoff (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-24-login-screen-reskin-handoff) — reskin shipped at `fe9a9b3`
- [m2d-registry-expansion-impl (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-24-m2d-registry-expansion-impl) — all 7 tasks complete, proof at `324e892`
- [mvp-deploy-cloud-run (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-24-mvp-deploy-cloud-run) — MVP deployed, info in INDEX.md
- [player-state-parity-audit (ARCHIVED)](WORKBENCH_DOCS_ARCHIVE.md#2026-03-24-player-state-parity-audit) — findings logged at `afa03b2`

### Historical Handoffs (worksheet — batch retirement candidate)

~11 `CLAUDE-HANDOFF-*.md` files from 2026-03-10 through 2026-03-20. These predate the 3-doc canonical model. No unique normative truth not captured in the canon. Retained pending batch retirement pass.

- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-20-claude-handoff-phase-4-acceptance-strict` — Phase 4 resume point (historical)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-18-claude-handoff-bundle-runtime-strict` — Phase 1-3 bundle blocker (historical)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-17-claude-handoff-whole-sheet-stroke-path` — whole-sheet perf fix (historical)
- `docs/2026-03-15-CLAUDE-HANDOFF-*.md` (3 files) — audits and pivots (historical)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-13-claude-handoff-editor-doc-alignment` — doc alignment (historical)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-11-claude-handoff-current-state` — branch/bundle state (historical)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-13-claim-verification` — claim audit (retain as reference)

## Historical Handoff Docs

Some untracked March 14 handoff docs in local worktrees may still reference the deleted blank-flow
single-frame harness. Treat them as obsolete. Do not use any document as an "XP fidelity" plan or
resume point unless it explicitly says it loads real XP through the product path and hard-fails on
metadata, layer, visual, export, and Skin Dock/runtime mismatches.

## REXPaint Reference & UI Docs

- `docs/WORKBENCH_DOCS_ARCHIVE.md#rexpaint-ui-complete-index`
  - REXPaint v1.70 complete UI index extracted from live screenshots; reference implementation, not asciicker-specific
- `docs/WORKBENCH_DOCS_ARCHIVE.md#feature-button-index-with-rexpaint-manual`
  - feature button reference + REXPaint v1.70 manual text; references `EditorApp` methods but these describe the standalone module, not proof of live workbench integration
- `docs/COMPLETE_UI_CONTROL_REFERENCE.md`
  - 189 workbench UI elements + REXPaint manual appendix; notes Section 14 (inspector) planned for replacement by `EditorApp`

## Editor Planning & Research (Worksheet tier — batch retirement candidate)

- `docs/WORKBENCH_DOCS_ARCHIVE.md#claude-workbench-ui-inventory`
  - **SUPERSEDED** by `docs/COMPLETE_UI_CONTROL_REFERENCE.md` — ready to retire
- `docs/WORKBENCH_DOCS_ARCHIVE.md#claude-cp437-font-research`
  - CP437 bitmap font rendering research — worksheet, retain as reference during font pipeline work
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-10-readonly-investigation-rexpaint-state`
  - historical — see 2026-03-13 audit banner for current caveats
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-10-deliverable-audit-report`
  - historical — Issue 1 (7-byte vs 10-byte) superseded by `a26be4a`

## Bundle & Animation Research

- `docs/research/ascii/2026-03-20-bundle-animation-types.md`
  - complete map of all 5 player sprite families (player, attack, plydie, wolfie, wolack), AHSW equipment encoding, current bundle-template coverage, gameplay trigger states, and the two planning axes that must stay separate: runtime-family expansion vs gameplay/state coverage; also records the open audit questions for template-less native-runtime apply, mounted/unmounted parity, and equipment-state coverage
- `docs/research/ascii/2026-03-21-player-sprite-semantic-dictionary-seed.md`
  - seed semantic dictionary for `player-0100.xp` L2 with verified glyph inventory, face/shirt/pants/boots region labels, palette-role mapping, and a proposed machine-readable schema for future agent-driven sprite edits
- `docs/research/ascii/semantic_maps/` — machine-readable JSON semantic dictionaries (**vendored from Y9-2 via symlink**)
  - `schema.json` — JSON Schema for the semantic dictionary format
  - `player-0100.json` — player sprite semantic dictionary (angle 0)
  - `player-anchors.json` — player sprite anchor review data (all 8 angles, with arms/face/hair corrected)
  - `player-1100-anchors.json` — helmet+armor variant anchor data (all 8 angles)
  - `attack-0001.json` — attack sprite semantic dictionary with weapon region (angle 0)
  - `plydie-0000.json` — death sprite semantic dictionary (angle 0)

## Milestone 2 Implementation

- `docs/plans/2026-03-21-milestone-2-practical-png-ingest-plan.md`
  - strategic plan for Milestone 2: defines the milestone explicitly, preserves the structural baseline, centers on manual assembly, and promotes whole-sheet editing
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-milestone-2-implementation-checklist`
  - implementation-ready checklist with explicit Milestone 1/Milestone 2 boundary, EXISTS/PARTIAL/MISSING status per item, file:line references, and wave ordering
- `docs/plans/2026-03-21-milestone-2-png-verifier-design.md`
  - historical input to the unified M2 verifier architecture (now in canonical spec §5); retains verifier slice definitions and PNG recipe patterns as implementation reference
- `docs/PNG_STRUCTURAL_BASELINE_CONTRACT.md`
  - non-regression contract for the PNG structural ingest path (also linked under Structural Contracts above)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-claude-handoff-m2-png-verifier-design`
  - historical handoff used to produce the completed M2 verifier design; keep for lineage, but start from the design doc above
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-legacy-inspector-retirement-checklist`
  - corrected retirement/demotion checklist for moving the legacy inspector to debug-only during Milestone 2
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-m2-png-fixture-inventory`
  - corrected fixture inventory and gap analysis for the PNG structural baseline verifier
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-m2-source-panel-implementation-spec`
  - implementation-facing source-panel spec aligned to current code, including corrective-pass notes
- `docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-21-semantic-edit-test-matrix`
  - semantic-edit API test matrix; still draft, but now corrected and useful as implementation support

## Local / Untracked Research (not committed)

The following files exist in this worktree but are not committed to `master`. They are research output and should be read with caution — the `docs/WORKBENCH_DOCS_ARCHIVE.md#index` summary shows 4 of 11 findings were contradicted by code inspection.

- `docs/WORKBENCH_DOCS_ARCHIVE.md#rexpaint-library-audit-findings`
  - audit of 30+ REXPaint libraries across 6 languages; recommends rexpaintjs-fork (JS), pyrexpaint (Python)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#index`
  - findings index (11 findings: 5 verified, 4 contradicted, 1 partial, 1 verified-with-gaps)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#09-finding-rexpaint-manual-coverage`
  - REXPaint manual coverage analysis (~94 features, 50-55% implemented)
- `docs/WORKBENCH_DOCS_ARCHIVE.md#10-finding-xp-editor-feature-audit`
  - 67-feature audit: 38 fully implemented (56.7%), 3 partial, 26 missing
- `docs/WORKBENCH_DOCS_ARCHIVE.md#11-finding-manual-gaps-checker`
  - 37 additional REXPaint features not covered in the 67-feature audit

## Font & Palette Assets

### Font assets (present)

13 CP437 PNG font atlases are present in the runtime tree at two locations:
- `runtime/termpp-skin-lab-static/termpp-web-flat/fonts/cp437_{4x4..40x40}.png` (with BDF/PSF metadata)
- `runtime/termpp-skin-lab-static/termpp-web/fonts/cp437_{4x4..40x40}.png` (PNGs only, no metadata)
- Build output copies also exist in `output/termpp-skin-lab-static/`

Font loader: `web/rexpaint-editor/cp437-font.js` accepts a spritesheet URL at construction time (16x16 glyph grid layout).

### Palette assets (not present)

No distinct palette asset files (`.pal`, `palette.json`, etc.) exist in the repo. Palette management is entirely code-based via `web/rexpaint-editor/palette.js` (RGB arrays in memory, no file persistence). If REXPaint `.pal` import/export is needed, it would require new code.

## Known Doc Caveats

- `CLAUDE.md` and `docs/INDEX.md` were missing before the 2026-03-13 doc-alignment pass; older handoffs may say they are absent.
- Some tests and docs still contain obsolete 7-byte XP assumptions even though current JS XP codec code uses 10-byte REXPaint cells. Three test files (`tests/web/rexpaint-editor-xp-file-{reader,writer,integration}.test.js`) construct actual 7-byte binary XP blobs in their fixtures — this is a deferred code issue.
- All editor test files use ESM `import` statements but the repo's `package.json` declares `"type": "commonjs"`, so direct `node tests/...` execution fails with `SyntaxError`.
- `EditorApp` and the whole-sheet surface exist in `web/rexpaint-editor/*` and `web/whole-sheet-init.js`, and current shipped grid actions now focus the whole-sheet editor first. The legacy inspector still exists as a fallback/debug path and remains a Milestone 2 demotion target.
- The finding that the editor modal/UI is still incomplete for REXPaint-parity goals remains valid; existence of whole-sheet integration does not mean full parity is proven.
- XP-file fidelity is not proven end-to-end. No canonical test exists. The deleted harness was not a valid fidelity test — see `PLAYWRIGHT_FAILURE_LOG.md`.
- Self-containment is now machine-enforced via `scripts/self_containment_audit.py` and installable git hooks in `.githooks/`. Blocking findings are external symlinks and live/build/runtime/test references to absolute paths outside this repo.
- `docs/plans/2026-06-09-workbench-prune-proposal.md` records the current workbench pruning proposal: three Skin Dock controls are hidden/unreachable DOM controls, `mounted_native_full` is registry-present but not UI-reachable, and ActorVisualProfile UI must be labeled draft-only until Y9-2 consumes authored profile JSON.

## 2026-04-22 Audit Note: Bundle Coverage, Rollback Contract, Wizard Parity, Migration Gates

Cross-repo audit (asciicker-Y9-2 vs pipeline-v3) surfaced four gaps not previously
specced. All four have been added to `docs/plans/2026-03-23-workbench-canonical-spec.md`
as new sections:

- **§2.11 Bundle Coverage Policy** — defines the 74/441 baseline, coverage expansion
  contract, machine-enforceable coverage gate, and the current SPRITE_COVERAGE_EXCEPTIONS
  table for proof-only and deferred families
- **§2.12 Rollback Asset Snapshot Contract** — requires XP binary capture + SHA256
  manifest alongside JSON metadata; current rollback is JSON-only (OPEN)
- **§2.13 Y9-2 Wizard Parity Contract** — expands DESIGN OPEN B-13 into a formal
  parity contract: every `option_tree.py` entry needs a real handler + full lifecycle;
  string-match-only tests do not satisfy the contract
- **V3 Migration Readiness Gates** — blocking gate table + non-blocking gap table with
  current status for each; gate maintenance rule at bottom

These sections do not introduce new authority. They record what the spec was previously
silent on so agents can treat coverage gaps and rollback failures as regressions, not
ambiguities.

## 2026-03-23 Audit Note: Capability Canon, Doc Alignment, and M2 Architecture

> A canonical M2 capability inventory exists at `docs/plans/2026-03-23-m2-capability-canon-inventory.md`. It cross-references every doc in this index against current code wiring and failure-log proof to classify each user-reachable behavior as PROVEN, WIRED, PARTIAL, PLANNED, BLOCKED, or DEFERRED.
>
> Key findings (updated 2026-03-24, HEAD 87ab20d):
> - M1 is closed (see status correction above)
> - 96 SAR-enumerated actions: **23 PROVEN** on committed code (B1/B2/B3 promoted via live Cloud Run browser test), 64 WIRED, 2 PARTIAL, 4 PLANNED, 1 BLOCKED, 2 DEFERRED
> - M2-B source-panel proof is **committed** (5c67ef2, d12740c): 10/10 PASS at root + /xpedit
> - M2-C whole-sheet: 15/18 PROVEN. W15 visualization connected (`2d9aa30`), needs verifier proof. W16/W17 DEFERRED.
> - **M2-D registry expansion landed**: 77 entries (47 foundation + 30 expansion). 31 WS selectors, 14 executable + 16 stub entries, W15 product fix, 8 fixed recipes. Generator stack: selectors.mjs → schema → registry → recipe_generator.mjs → dom_runner.mjs (all committed).
> - **Unified M2 verifier architecture** documented in `docs/plans/2026-03-23-workbench-canonical-spec.md` §5
> - MVP deployment live at `rikiworld.com/xpedit` with GitHub Issue delivery for bug reports (Secret Manager, verified Issues #6/#7)
> - Remaining M2-D work: verifier proof for new WIRED actions, canvas/keyboard gesture abstractions, dual-button schema evolution
>
> For reality/proof status on any capability claim in this repo, always check:
> 1. `PLAYWRIGHT_FAILURE_LOG.md` (ground truth)
> 2. `docs/plans/2026-03-23-m2-capability-canon-inventory.md` (classified inventory)
> 3. The code itself (`web/workbench.js`, `web/whole-sheet-init.js`)

## Non-Canonical Doc Classification

> For the full inventory with per-doc archive-readiness assessment, see `docs/plans/2026-03-23-m2-capability-canon-inventory.md` Appendix B.

| Tier | Examples | Count | Status |
|------|---------|-------|--------|
| **Canonical** | Failure log, canonical spec, capability canon | 3 | Protected |
| **Structural Contract** | XP_EDITOR_ACCEPTANCE_CONTRACT, PNG_STRUCTURAL_BASELINE_CONTRACT | 2 | Protected until milestone boundary |
| **Reference** | COMPLETE_UI_CONTROL_REFERENCE, SAR blueprint, state-capture contract, MVP deployment | ~12 | Retain — stable reference, no active state claims |
| **Active Plan** | M2 ingest plan, M2 verifier design, base-path plan, hard-fail plan | ~8 | Retain until completed/superseded |
| **Worksheet — Retired** | claude-workbench-ui-inventory, workbench-verifier-sar-model, M2 PNG verifier handoff, edge-case impl plan | 4 | Archived (2026-03-23) |
| **Worksheet — Historical** | ~11 CLAUDE-HANDOFF files, ~30 old plans/research | ~41 | Batch retirement candidate after canon absorption |

**Retirement workflow:** `scripts/doc_lifecycle_stitch.sh` archives to `docs/WORKBENCH_DOCS_ARCHIVE.md`, rewrites links, deletes originals, logs to failure log. Run `--list-candidates` to see full list.
