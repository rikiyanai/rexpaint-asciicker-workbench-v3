# Tool Behavior Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-e25e4406-fa64-4a91-acc8-04c9681c1fea.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — cell-tool-and-set-draw-state
4. PASS — cell-draw-canvas-mutation
5. PASS — eyedropper-sample
6. PASS — erase-canvas-mutation
7. PASS — draw-glyph-b-at-2-2
8. PASS — line-draw-canvas-mutation
9. PASS — fill-tool-switch
10. PASS — text-tool-switch
11. PASS — export-via-files-drawer
12. PASS — artifact-oracle

## Canvas mutation results

✅ Cell tool active; drawGlyph=64; activeTool=cell
✅ Cell draw: cell (4,4) after=508
✅ Eyedropper: activeTool=eyedropper; drawGlyph 64→64; glyphChanged=false
✅ Erase: cell (4,4) erased=true; after=508
✅ Draw glyph B prep: cell (2,2)=254
✅ Line (2,2)→(8,2): start=254 mid=257 end=260
✅ Fill: reachable; activeTool=fill
✅ Text: reachable; activeTool=text
✅ Export XP via Files drawer
✅ Artifact oracle (gzip-aware): totalNonZero=10094 (all layers)

## What this probe does NOT cover

- Fill flood-fill canvas mutation (only tool reachability confirmed)
- Text insertion canvas mutation (only tool reachability confirmed)
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
