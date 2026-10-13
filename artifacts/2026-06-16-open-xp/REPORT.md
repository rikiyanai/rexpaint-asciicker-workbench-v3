# Open XP Probe

Result: **PASS**
Exported XP: `/Users/r/Downloads/asciicker-pipeline-v3/data/exports/session-1f392e3e-69f8-425c-884d-f37fb44ea557.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — open-xp-file
3. PASS — cells-loaded
4. PASS — export-via-files-drawer
5. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ #fsOpenXpBtn → filechooser intercept → fixture XP injected → ws-session-loaded
✅ First screen dismissed by loadSession() success (not by ws-advanced toggle)
✅ Editor cells loaded from XP (L2 editorCount=9)
✅ Export XP via Files drawer
✅ Artifact oracle (gzip-aware): totalNonZero=10096 (all layers), editorCount=9 (L2)

## What this probe does NOT cover

- File System Access API path (showOpenFilePicker) — not supported in WebKit; fallback path proven
- Save-back to the original file (saveXpFile with handle — requires File System Access API)
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- Share / download UX (probe #9)
- Frame parity beyond Add Frame (probe #10)
