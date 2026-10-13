# Mobile File/Session Persistence Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-009a9dd9-412f-46a3-94dc-6aec5b19fe85.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — author-cells
4. PASS — save-session
5. PASS — reload-with-session-id
6. PASS — verify-cells-persist-url
7. PASS — save-idb-draft
8. PASS — reload-fresh
9. PASS — continue-draft-restore
10. PASS — verify-cells-persist-idb
11. PASS — export-via-files-drawer
12. PASS — artifact-oracle

## Persistence paths proven (mobile, no Advanced)

✅ Path A (URL restore): authored cells present after ?session_id= reload
✅ Path B (Continue Draft): IDB draft → Restore → first screen dismissed
✅ Path B cells verified: same glyph + colors after IDB restore
✅ Files drawer reachable + native #btnExport works after IDB restore
✅ Artifact oracle: glyph 68 + exact colors confirmed in XP binary

## What this probe does NOT cover

- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- beforeunload-triggered saveDraftSync reliability (Path B uses explicit saveDraft)
- Skin Dock / preview pipeline (probe #6)
- Desktop layout unaffected (probe #7)
