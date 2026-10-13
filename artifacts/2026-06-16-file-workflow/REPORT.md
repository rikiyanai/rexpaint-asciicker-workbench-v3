# File Workflow Probe

Result: **PASS**
Export 1: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-795bf828-f1aa-4b03-b67a-7e7f8908837b.xp`
Export 2: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-795bf828-f1aa-4b03-b67a-7e7f8908837b.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — new-from-template
3. PASS — author-glyph-d-block
4. PASS — save-session
5. PASS — export-xp
6. PASS — download-blob-share
7. PASS — save-idb-draft
8. PASS — reload-fresh
9. PASS — continue-draft-restore
10. PASS — url-session-restore
11. PASS — re-export-xp
12. PASS — artifact-oracle

## Workflow coverage

✅ New from template (#fsTemplateSelect → #fsTemplateApplyBtn)
✅ Author cells (glyph D=68, fg=#ee44ff, bg=#001133)
✅ Save → .ws-mobile-top-bar [data-action="save"] → sessionDirty=false
✅ Export → .ws-drawer[data-drawer="files"] #btnExport → xp_path_1
✅ Share / _downloadBlob trigger
✅ IDB draft save (__wbPersistence.saveDraft)
✅ Continue Draft → #fsContinueDraftBtn → cells verified (Path B IDB)
✅ URL restore (?session_id=) → cells verified (Path A server-side)
✅ Re-export → xp_path_2
✅ Oracle: glyph 68 + exact colors ≥9 cells

## What this probe does NOT cover

- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- beforeunload-triggered saveDraftSync reliability (explicit saveDraft used for IDB path)
- Skin Dock / preview pipeline (separate probe)
- Desktop layout unaffected (separate probe)
