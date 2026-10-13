# Tool/Layer Parity Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-2cba4306-a516-4142-854b-9088c18dba1e.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — open-tools-drawer
4. PASS — switch-erase-tool
5. PASS — switch-line-tool
6. PASS — switch-cell-tool
7. PASS — open-layers-drawer
8. PASS — toggle-layer-visibility
9. PASS — restore-layer-visibility
10. PASS — add-layer
11. PASS — delete-layer
12. PASS — export-via-files-drawer
13. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ Tools drawer opens (injected by whole-sheet-init.js)
✅ Tool buttons reachable: cell=true, erase=true, line=true, select=true
✅ Switch to Erase: activeTool='erase'
✅ Switch to Line: activeTool='line'
✅ Restore to Cell: activeTool='cell'
✅ Layers drawer opens; 4 layer rows rendered
✅ Layer row info: [{"index":"0","name":"Metadata","visible":false},{"index":"1","name":"Layer 1","visible":false},{"index":"2","name":"Visual","visible":true},{"index":"3","name":"Layer 3","visible":false}]
✅ Visibility toggle: ws-layer-visible false→true
✅ Add Layer: count 4→5 (+1)
✅ Delete Layer: count 5→4
✅ Export XP via Files drawer
✅ Artifact oracle (gzip-aware): totalNonZero=10087 (all layers)

## What this probe does NOT cover

- Erase/Line/Fill/Eyedropper/Text tool actual canvas usage (cell count change) — tools proven reachable and switchable
- Layer lock/unlock toggle (reachable: ws-layer-lock-btn present in each row)
- Layer rename (not a button in the current UI — editing the name span directly)
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
