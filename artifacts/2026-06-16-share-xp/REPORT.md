# Export/Share XP Probe

Result: **PASS**
Downloaded XP: `/Users/r/Downloads/asciicker-pipeline-v3/artifacts/2026-06-16-share-xp/downloaded-share.xp`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — share-file
4. PASS — verify-download-header
5. PASS — artifact-oracle

## Operations proven (mobile, no Advanced)

✅ Template applied via mobile first screen — editor-first shell
✅ [data-action="share-file"] visible in mobile top bar
✅ Download fallback (_downloadBlob) triggered — file: export.xp
✅ Downloaded bytes are a valid XP binary (gzip + REXPaint header)
✅ Artifact oracle (gzip-aware): totalNonZero=10087 (all layers)

## What this probe does NOT cover

- navigator.share() with files (Web Share API) — requires real iOS Safari user gesture on device
- iPad share sheet UX (AirDrop, Files app, etc.) — only testable on physical device
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
- Frame parity beyond Add Frame (probe #10)
