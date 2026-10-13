# Frames Parity Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-f489c3c2-59de-4733-8733-3624e8ab2aa4.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — open-frames-drawer
4. PASS — select-frame-tile
5. PASS — col-right
6. PASS — col-left
7. PASS — add-frame
8. PASS — delete-frame
9. PASS — layer-select
10. PASS — context-menu-copy-paste
11. PASS — focus-whole-sheet
12. PASS — export-via-files-drawer
13. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ Frames drawer opens; frame grid renders
✅ Frame tile click → .selected class; addFrameBtn+openInspectorBtn enabled
✅ Col Right: selected frame {"row":0,"col":0} → {"row":0,"col":1}
✅ Col Left: frame moved back
✅ Add Frame: count 72→80 (+8)
✅ Delete Frame: count 80→72
✅ Layer select: value 2→0 (confirmed=true); 4 options
✅ Context menu (right-click): menu visible=true; Copy Frame clicked; Paste enabled=true; Paste clicked
✅ Focus Whole-Sheet (openInspectorBtn): wholeSheetPanel visible=true
✅ Export XP via Files drawer
✅ Artifact oracle (gzip-aware): totalNonZero=10087 (all layers)

## Frame control availability (player_native_idle_only template)

- addFrameBtn: enabled=true
- openInspectorBtn: enabled=true
- colRightBtn: enabled=true
- colLeftBtn: enabled=false
- rowUpBtn: enabled=false
- rowDownBtn: enabled=true

## What this probe does NOT cover

- Row Up/Row Down (reorder rows) — requires template with ≥2 animation rows; player_native_idle_only has 1 row
- Clear Selected (deleteCellBtn) — reachability confirmed, not driven (would clear real content)
- gridZoomInput / gridToggleLabels — reachability confirmed in drawer open; not state-mutated in this probe
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
