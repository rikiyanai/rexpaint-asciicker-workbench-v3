# Frames Parity v2 Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-f988d296-6736-47c5-8c59-8fde9d1c41ad.xp`

Playwright WebKit under iPad Pro 11 landscape — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — open-frames-drawer
4. PASS — select-frame-tile
5. PASS — col-right
6. PASS — col-left
7. PASS — add-frame
8. PASS — delete-frame
9. PASS — row-down
10. PASS — row-up
11. PASS — grid-zoom-input
12. PASS — grid-toggle-labels
13. PASS — clear-selected-deletecellbtn
14. PASS — context-menu-copy-paste
15. PASS — layer-select
16. PASS — focus-whole-sheet
17. PASS — export-via-files-drawer
18. PASS — artifact-oracle

## New controls proven (vs v1)

✅ Row Down: selectedRow 0→1; rowUpNowEnabled=true
✅ Row Up: selectedRow 1→0
✅ gridZoomInput: zoom 0→2 changed=true
✅ gridToggleLabels: false→true toggled=true
✅ Clear Selected (deleteCellBtn): executed=true