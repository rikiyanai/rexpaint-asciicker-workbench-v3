# Recipe Runner Probe (Seed 1)

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-f6d8ca33-6732-4a74-a3f5-a2762fb03e32.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Recipe

Seed: 1 | Glyph: 71 | FG: #ff6600 | BG: #000022
Draw 2×2 at (5,5) → erase (5,5) → frames col-right → frames add → layers vis-toggle → layers add → save → reload → export → oracle

## Steps

1. PASS — fresh-first-screen
2. PASS — create-from-template
3. PASS — set-draw-state
4. PASS — draw-2x2-block
5. PASS — erase-5-5
6. PASS — frames-col-right
7. PASS — frames-add-frame
8. PASS — layers-toggle-vis
9. PASS — layers-restore-vis
10. PASS — layers-add-layer
11. PASS — save
12. PASS — reload-url-restore
13. PASS — export
14. PASS — share-download
15. PASS — artifact-oracle

## Cross-surface coverage in one session

Draw (Cell tool canvas mutation)
Erase (canvas mutation)
Frames (col-right + add-frame)
Layers (vis-toggle + add-layer)
Save → reload (URL restore)
Export → oracle
Share / download