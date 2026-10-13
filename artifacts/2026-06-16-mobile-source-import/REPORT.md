# Mobile Source/Import Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-b4109e87-a4cb-42f1-b2ba-9599b78cba94.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — upload-png
4. PASS — source-drawer-visible
5. PASS — draw-source-box
6. PASS — find-sprites
7. PASS — convert-to-xp
8. PASS — save-via-topbar
9. PASS — export-via-files-drawer
10. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ PNG upload via Import drawer (sourceImageLoaded=true, wbRun enabled)
✅ Source drawer: canvas visible + Draw Box + Find Sprites reachable
✅ Draw Box on source canvas (drawCurrent set via pointer drag)
✅ Find Sprites (extractBtn) clickable without Advanced mode
✅ Convert to XP: pipeline ran, L2 cells 0→4110 (glyph>32) in whole-sheet editor
✅ Save via mobile top bar (sessionDirty → false)
✅ Export XP via Files drawer
✅ Artifact oracle (gzip-aware): totalNonZero=14197 (all layers), editorCount=4110 (L2)

## What this probe does NOT cover

- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- File/session persistence across page reload (probe #5)
- Skin Dock / preview pipeline (probe #6)
- Desktop layout unaffected (broader gate — probe #7)
- Specific glyph/color mapping from PNG pixels (oracle verifies non-zero count only)
