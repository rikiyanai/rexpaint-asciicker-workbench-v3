# Mobile Workbench Parity — reachable mechanics WITHOUT Advanced

Captured by `scripts/audit/probe_mobile_parity.mjs` (headed WebKit, iPad profile).
Each drawer below was opened in editor-first mode with `body.ws-advanced` **absent**.
Playwright WebKit is engine-family emulation, NOT a physical iPad / iOS Safari.

## portrait  (editor-first, ws-advanced=false)

### tools — ✅ [control] (in-editor (Panel 18 tools))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 65 total, 59 enabled
- PAINT · BROWSE · 64 · @ · #ffffff · ⇄ · #000000 · MAG transparent · YEL transparent-2 · button · button · button · button · button · button · button · button · Undo(disabled) · Redo(disabled) · Grid · FrameLayer0 Meta (14×10)1×12×24× · 1(disabled) · 1(disabled) · G

### frames — ✅ [control] (reparented Panel 9 (grid/frame nav))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 15 total, 8 enabled
- Row Up(disabled) · Row Down(disabled) · Col Left(disabled) · Col Right(disabled) · Add Frame · Clear Selected(disabled) · Delete Frame(disabled) · Focus Whole-Sheet(disabled) · 0: Metadata1: Layer 12: Visual3: · 0 · IDs · on · on · on · on

### layers — ✅ [control] (in-editor (layer stack))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 18 total, 16 enabled
- + · − · - · L · ↑(disabled) · ↓ · - · U · ↑ · ↓ · V · U · ↑ · ↓ · - · U · ↑ · ↓(disabled)

### files — ✅ [control] (reparented Panel 5 (session ops))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 11 total, 9 enabled
- Load From Job · Save · Export XP · New XP · Undo(disabled) · Redo(disabled) · xpImportFile · Import XP · Open File · Save to File · Save File As

### source — ✅ [control] (reparented Panel 8 (slice/canvas))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 11 total, 11 enabled
- Select · Draw Box · Drag Row · Drag Column · Vertical Cut · Delete Box · Find Sprites · on · 48 · 8 · 1

### import — ✅ [control] (reparented Panel 7 (upload/convert))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 5 total, 4 enabled
- wbFile · Upload PNG · Convert to XP(disabled) · wb_sprite · Geometric (fast, half-blocks)
  

### browse — ✅ [status] (in-editor session list (mode-gated to BROWSE; list-only))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- status/list surface — 0 controls (zero is by design; populated on use, not a parity surface)

### info — ✅ [status] (in-editor cell readout (status-only))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- status/list surface — 0 controls (zero is by design; populated on use, not a parity surface)

## landscape  (editor-first, ws-advanced=false)

### tools — ✅ [control] (in-editor (Panel 18 tools))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 65 total, 59 enabled
- PAINT · BROWSE · 64 · @ · #ffffff · ⇄ · #000000 · MAG transparent · YEL transparent-2 · button · button · button · button · button · button · button · button · Undo(disabled) · Redo(disabled) · Grid · FrameLayer0 Meta (14×10)1×12×24× · 1(disabled) · 1(disabled) · G

### frames — ✅ [control] (reparented Panel 9 (grid/frame nav))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 15 total, 8 enabled
- Row Up(disabled) · Row Down(disabled) · Col Left(disabled) · Col Right(disabled) · Add Frame · Clear Selected(disabled) · Delete Frame(disabled) · Focus Whole-Sheet(disabled) · 0: Metadata1: Layer 12: Visual3: · 0 · IDs · on · on · on · on

### layers — ✅ [control] (in-editor (layer stack))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 18 total, 16 enabled
- + · − · - · L · ↑(disabled) · ↓ · - · U · ↑ · ↓ · V · U · ↑ · ↓ · - · U · ↑ · ↓(disabled)

### files — ✅ [control] (reparented Panel 5 (session ops))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 11 total, 9 enabled
- Load From Job · Save · Export XP · New XP · Undo(disabled) · Redo(disabled) · xpImportFile · Import XP · Open File · Save to File · Save File As

### source — ✅ [control] (reparented Panel 8 (slice/canvas))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 11 total, 11 enabled
- Select · Draw Box · Drag Row · Drag Column · Vertical Cut · Delete Box · Find Sprites · on · 48 · 8 · 1

### import — ✅ [control] (reparented Panel 7 (upload/convert))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- controls: 5 total, 4 enabled
- wbFile · Upload PNG · Convert to XP(disabled) · wb_sprite · Geometric (fast, half-blocks)
  

### browse — ✅ [status] (in-editor session list (mode-gated to BROWSE; list-only))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- status/list surface — 0 controls (zero is by design; populated on use, not a parity surface)

### info — ✅ [status] (in-editor cell readout (status-only))
- opened: true · still editor-first (no Advanced): true · drawer in DOM: true
- status/list surface — 0 controls (zero is by design; populated on use, not a parity surface)

## End-to-end execution (mobile, no Advanced)

### Frames › Add Frame — ✅ executed
- Add Frame enabled: true · frame cells before: 72 → after: 80 · stayed editor-first: true
- NOTE: other reparented actions (source slicing, export, PNG upload, file save) are proven REACHABLE/enabled only; full end-to-end on those still needs the real-device pass.

---
Overall: ✅ all probed drawers reachable in editor-first