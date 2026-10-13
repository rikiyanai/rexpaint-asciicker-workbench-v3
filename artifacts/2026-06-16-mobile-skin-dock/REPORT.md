# Mobile Skin Dock — Author → Save → Export → Test Skin

Result: **PASS**

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — author-cells
4. PASS — save-session
5. PASS — export-xp
6. PASS — open-test-drawer
7. PASS — click-test-this-skin
8. PASS — webbuild-loading
9. PASS — webbuild-ready
10. PASS — preview-screenshot

## Skin Dock pipeline proven (mobile, no Advanced)

✅ Authored 3×3 glyph block (glyph 68 'D') into session
✅ Saved via mobile top bar (sessionDirty → false)
✅ Exported XP via native #btnExport in Files drawer
   XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-dc46d32b-fb8d-49c5-b15a-4686acc323cc.xp`
✅ Test drawer reachable; runtime preflight ok; button enabled
✅ "Test This Skin" clicked — webbuildState changed
✅ webbuildFrame visible with src set
✅ state.webbuild.ready === true (skin injection complete)
✅ Screenshot captured after ready

## What this probe does NOT prove

- Visual rendering of the skin in the WASM game (EMFS injection limitation:
  engine caches sprites at init — post-init FS writes are not re-read)
- Live Y9-2 game integration (this is local flat test arena only: termpp-web-flat)
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
