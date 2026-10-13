# Desktop Unaffected Gate

Result: **PASS**

Playwright WebKit, 1440×900 desktop viewport, no-touch (pointer:fine) — NOT real browser.

## Steps

1. PASS — desktop-fresh-load
2. PASS — apply-template
3. PASS — whole-sheet-editor
4. PASS — dashboard-controls
5. PASS — author-cells
6. PASS — save-session
7. PASS — export-xp
8. PASS — artifact-oracle
9. PASS — desktop-layout-intact

## Desktop workflow proven (mobile changes non-regressive)

✅ Mobile first screen hidden (CSS display:none); mobile top bar hidden
✅ Template applied via desktop #templateSelect + #templateApplyBtn
✅ Whole-sheet editor canvas mounted in #wholeSheetMount
✅ Dense dashboard controls visible: #templateApplyBtn, #btnExport, #webbuildDockPanel
✅ Cells authored via canvas click; sessionDirty set
✅ Session saved via desktop #btnSave (sessionDirty → false)
✅ XP exported via desktop #btnExport; xp_path returned
   XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-885fa1cb-e3b0-451a-b401-9ef0cca75a11.xp`
✅ Exported XP oracle: glyph 68+exact colors count=9/9 ✓
✅ No mobile UI visible; ws-session-loaded intact after full flow

## What this probe does NOT prove

- Real browser (Playwright WebKit, not native Safari/Chrome/Firefox)
- GPU/WebGL/WASM performance under real OS
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
