# Mobile Workbench Parity Matrix — 2026-06-16

Authoritative classification of every workbench capability.
**PROVEN mobile** = automated WebKit (iPad Pro 11 landscape) produces screenshot + oracle.
This document supersedes per-probe PASS/FAIL labels. A PASS on a probe means only the
operations driven by that probe are proven — not the entire surface area.

---

## Classification Key

| Symbol | Meaning |
|--------|---------|
| ✅ PROVEN mobile | Automated WebKit proof with artifact oracle |
| 🖥️ PROVEN desktop | Desktop WebKit proof; mobile not tested for this op |
| ⬜ NOT YET PROVEN | Reachable/codeable but no automated oracle yet |
| 🏗️ ARCHITECTURE BLOCKED | Needs code change before proof is possible |
| 🚫 DESKTOP ONLY | Explicitly out of mobile scope; desktop-only surface |
| 🔲 DEFERRED | Scope boundary explicitly set; will not be automated |

---

## File / Session Surface

| Capability | Status | Probe / Evidence |
|-----------|--------|-------|
| New from template (mobile first screen) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-parity/` |
| Open XP from file picker | ✅ PROVEN mobile | `artifacts/2026-06-16-open-xp/` |
| Save session (sessionDirty → false) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-file-session/` |
| Export XP (pipeline produces xp_path) | ✅ PROVEN mobile | all oracle probes |
| Share / _downloadBlob fallback | ✅ PROVEN mobile | `artifacts/2026-06-16-share-xp/` |
| Continue Draft (IDB restore via first screen) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-file-session/` |
| URL restore (?session_id=<id>) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-file-session/` |
| Imported XP re-export (structural) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-source-import/` |
| Combined single-session file workflow | ✅ PROVEN mobile | `artifacts/2026-06-16-file-workflow/` 12/12 |
| Source import pixel fidelity oracle | 🔲 DEFERRED | Scope boundary: mobile parity = "pipeline runs and produces XP," not pixel fidelity. Pixel oracle needs fixture-pinned PNG stable across pipeline versions. |
| Export handoff on real iOS (share sheet / Files) | 🔲 DEFERRED | Automation proves _downloadBlob only. Physical iPad is UQ-013 manual gate. |

---

## Drawing / Editing Surface

| Capability | Status | Probe / Evidence |
|-----------|--------|-------|
| Cell draw tool (glyph + fg + bg written to canvas) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-editing-parity/` |
| Copy / Paste / Cut / Clear / Undo / Redo | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-editing-parity/` |
| Select tool + canvas drag (selectionBounds) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-editing-parity/` |
| Erase tool switch (activeTool='erase') | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Line tool switch (activeTool='line') | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Eyedropper tool switch (activeTool='eyedropper') | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Erase canvas effect (cell cleared after click) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-behavior/` 12/12 |
| Line canvas effect (cells drawn after drag) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-behavior/` 12/12 |
| Eyedropper canvas sample (drawGlyph/drawFg change) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-behavior/` 12/12 |
| Fill tool (switch + activeTool='fill' confirmed) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-behavior/` 12/12 |
| Text tool (switch + activeTool='text' confirmed) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-behavior/` 12/12 |
| Rect tool | 🔲 DEFERRED | Low priority; same canvas interaction pattern as Line/Fill |
| Oval tool | 🔲 DEFERRED | Low priority; same canvas interaction pattern as Line/Fill |

---

## Frames Surface

| Capability | Status | Probe / Evidence |
|-----------|--------|-------|
| Frames drawer open (grid panel renders) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Frame tile click → selection enabled | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Add Frame (count +8) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Delete Frame (count −8) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Col Right (selected frame moves right) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Col Left (selected frame moves back) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Context menu Copy Frame + Paste Frame | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Focus Whole-Sheet (openInspectorBtn) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Active Layer select dropdown | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity/` |
| Row Down (move selected row down) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity-v2/` 18/18 |
| Row Up (move selected row up) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity-v2/` 18/18 |
| Clear Selected / deleteCellBtn | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity-v2/` 18/18 |
| Grid zoom input (gridZoomInput) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity-v2/` 18/18 |
| Label toggle (gridToggleLabels) | ✅ PROVEN mobile | `artifacts/2026-06-16-frames-parity-v2/` 18/18 |

---

## Layers Surface

| Capability | Status | Probe / Evidence |
|-----------|--------|-------|
| Layers drawer open (#wsLayersPanel) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Layer visibility toggle (ws-layer-vis-btn) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Add layer (count +1) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Delete layer (count −1) | ✅ PROVEN mobile | `artifacts/2026-06-16-tool-layer-parity/` |
| Layer lock toggle (ws-layer-lock-btn L/U) | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Locked layer rejects canvas draw | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Active-layer switch (row click → activeLayerIndex) | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Layer move up (↑ button) | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Layer move down (↓ button) | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Layer add/delete persistence (save → reload → export) | ✅ PROVEN mobile | `artifacts/2026-06-16-layer-ops/` 10/10 |
| Layer rename | 🔲 DEFERRED | No rename button in current UI; nameSpan is not an editable input. Not in mobile scope. |

---

## Source / Import Surface

| Capability | Status | Probe / Evidence |
|-----------|--------|-------|
| PNG → XP pipeline (runs on mobile, produces xp_path) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-source-import/` |
| Pixel fidelity oracle | 🔲 DEFERRED | See File/Session surface decision above |

---

## Skin Dock Surface

| Capability | Status | Notes |
|-----------|--------|-------|
| Skin Dock ready-state (iframe renders, no authored XP) | ✅ PROVEN mobile | `artifacts/2026-06-16-mobile-skin-dock/` |
| Skin Dock visual rendering with authored XP | 🏗️ ARCHITECTURE BLOCKED | Pre-start EMFS injection not implemented. Sprite cache initialises before authored XP can be loaded. Not part of mobile parity until architecture is in place. |

---

## Advanced / Desktop-Only Surfaces

All surfaces below are **desktop-only**. No mobile probe needed unless a future feature
brief explicitly targets mobile.

| Capability | Status | Notes |
|-----------|--------|-------|
| AVP (Actor Visual Profile) tab | 🚫 DESKTOP ONLY | Advanced mode; not in mobile shell |
| Verification tab | 🚫 DESKTOP ONLY | Advanced mode |
| TERM++ native terminal | 🚫 DESKTOP ONLY | Advanced mode |
| Recorder | 🚫 DESKTOP ONLY | Advanced mode |
| Advanced Skin Dock options | 🚫 DESKTOP ONLY | Requires Advanced mode |
| Bundle workflow (create/export bundle) | 🚫 DESKTOP ONLY | Desktop pipeline action |
| Desktop dashboard layout intact | 🖥️ PROVEN desktop | `artifacts/2026-06-16-desktop-regression-v2/` 14/14 (full regression gate) |

---

## Automation Roadmap — Final Status

| # | Script | Status |
|---|--------|--------|
| 1 | Parity matrix | IN PLACE |
| 2 | `frames_parity_v2_probe.mjs` | PASS 18/18 — `artifacts/2026-06-16-frames-parity-v2/` |
| 3 | `tool_behavior_probe.mjs` | PASS 12/12 — `artifacts/2026-06-16-tool-behavior/` |
| 4 | `layer_ops_probe.mjs` | PASS 10/10 — `artifacts/2026-06-16-layer-ops/` |
| 5 | `file_workflow_probe.mjs` | PASS 12/12 — `artifacts/2026-06-16-file-workflow/` |
| 10 | `recipe_runner_probe.mjs` | PASS 15/15 — `artifacts/2026-06-16-recipe-runner/` |
| 11 | `desktop_regression_v2_probe.mjs` | PASS 14/14 — `artifacts/2026-06-16-desktop-regression-v2/` |
| 12 | Physical iPad Safari | **OPEN — manual gate** (UQ-013 / FL-MOB-01 / FL-MOB-02) |

All automated probes at PASS. Physical iPad Safari acceptance is the sole remaining open gate.

---

## Architecture Decisions (locked)

| ID | Decision |
|----|----------|
| D1 | **Source import fidelity scope:** mobile parity = pipeline runs and produces structurally valid XP. Pixel oracle is out of scope until a stable fixture-pinned PNG is designated. |
| D2 | **Skin Dock visual parity:** Not part of mobile parity until EMFS injection architecture is in place. Ready-state is proven; visual rendering is blocked. |
| D3 | **Export handoff on real iOS:** Automation proves _downloadBlob only. iPad share-sheet / Files behavior requires physical device (UQ-013 manual gate). |
| D4 | **Advanced/Desktop surfaces:** All advanced tab surfaces are desktop-only. No mobile probe unless a feature brief explicitly requires it. |
