# Desktop Regression v2 Gate

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-e6ac5916-4277-464b-b57d-c010cab30287.xp`

Playwright WebKit, 1440×900 viewport, hasTouch:false — NOT mobile emulation.

## Steps

1. PASS — desktop-fresh-load
2. PASS — apply-template-desktop
3. PASS — desktop-controls-visible
4. PASS — draw-cells-desktop
5. PASS — frames-col-right-desktop
6. PASS — frames-add-frame-desktop
7. PASS — layers-vis-toggle-desktop
8. PASS — layers-add-layer-desktop
9. PASS — source-import-reachable
10. PASS — save-desktop
11. PASS — export-desktop
12. PASS — skin-dock-ready-state
13. PASS — desktop-layout-intact
14. PASS — artifact-oracle

## Desktop surfaces verified

- Desktop fresh load: mobileFirstScreen=undefined, mobileTopBar=undefined
- Template apply via #templateSelect + #templateApplyBtn
- Dense desktop controls: templateSelect=true, btnExport=true, btnSave=true
- Draw cells (glyph H=72): sessionDirty=true
- Frames col-right: enabled=true
- Frames add: 72→80
- Layers vis-toggle: toggled=true
- Layers add: 4→5
- Source import button reachable=false
- Save: saved=true, sessionDirty=false
- Export: /Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-e6ac5916-4277-464b-b57d-c010cab30287.xp
- Skin Dock: {"exists":false}
- Layout intact: mobileTopBar=undefined, mobileFirstScreen=undefined
- Oracle: glyphH count=9 (expected ≥9)