# Mobile Editing Parity Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-a8f8e5d0-9461-43f0-9cd9-2d7fbef41fac.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — set-draw-state-1
4. PASS — paint-block-a
5. PASS — set-draw-state-2
6. PASS — paint-block-b
7. PASS — select-block-a
8. PASS — copy-selection
9. PASS — paste-at-loc1
10. PASS — cut-pasted-loc1
11. PASS — paste-at-loc2
12. PASS — clear-region
13. PASS — undo-redo
14. PASS — save-via-topbar
15. PASS — export-via-files-drawer
16. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ Paint glyph + color via Cell tool (Tools drawer)
✅ Paint second glyph + distinct color (verified in getDocumentSnapshot)
✅ Select region (Select tool via Tools drawer + canvas drag)
✅ Copy selection (Copy button via Tools drawer)
✅ Paste at new location — cells verified: glyph + fg + bg match source
✅ Cut selection (source cleared, clipboard updated)
✅ Paste moved content — cells verified at new location
✅ Clear/delete selection
✅ Undo (state restored) + Redo (re-cleared)
✅ Save via mobile top bar (sessionDirty → false)
✅ Export XP via Files drawer
✅ Artifact oracle: glyph + color in XP binary

## What this probe does NOT cover

- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- Source slicing / PNG import end-to-end
- File/session persistence across reload
- Skin Dock / preview pipeline
- Desktop layout unaffected (see `mobile-first-screen.spec.js` desktop tests)