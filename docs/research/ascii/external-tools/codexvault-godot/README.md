# CODEXVault Godot and ASCII editor source archive

This directory is a research archive owned by FL-4714. It does not change the
FL-4512 product architecture, implement a pipeline-v3 editor, establish Godot
port status, provide runtime evidence, promote a paper claim, provide visual
proof, and supplies no acceptance.

The operator directed this archive to be created in both asciicker-Y9-2 and
asciicker-pipeline-v3. The two repositories contain byte-identical copies of
every captured source file. The local Sketchpad capture also includes its
companion assets so that the saved page retains its original relative imports.

## Provenance

Captured on 2026-08-10 JST after the intake was recorded in FL-4714.

| Source | Archived file | HTTP / origin state | Bytes | SHA-256 |
|---|---|---:|---:|---|
| Local `/Users/r/Downloads/ASCII Art Sketchpad.html`, originally saved from `https://patorjk.com/ascii-art-sketchpad/` | `ascii-art-sketchpad.html` | local complete-page capture | 528,647 | `b6fbeaf694ec90b8bc82469d204cd88434deab69616039a58191f96bb78c7b63` |
| `https://fromariel.github.io/CODEXVault_GODOT/` | `codexvault-godot-index.html` | HTTP 404 | 9,379 | `b620507312c5e97566a3c6cfaf99144fefc18a0da7d941401dfa0f5f58fb0368` |
| `https://fromariel.github.io/CODEXVault_GODOT/tools/` | `codexvault-godot-tools-index.html` | HTTP 200 | 37,134 | `67dc1c1139a68f5a840196f9430d718d4a741cfc4a223b24bfc633a54212fd1f` |
| `https://fromariel.github.io/CODEXVault_GODOT/tools/ascii.html` | `codexvault-godot-ascii.html` | HTTP 200 | 169,394 | `de5a3bc27dc0f2b28cf586f6b747e46a87ecfc216eb66bc32a1b4feba5244c1d` |
| `https://fromariel.github.io/CODEXVault_GODOT/tools/glyph.html` | `codexvault-godot-glyph.html` | HTTP 200 | 62,996 | `3c904ddcfeb0a42d6e2fe6e8396802219dc60aa841e56a59dee145a19c2aa6c1` |

Sketchpad companion assets:

| File | SHA-256 |
|---|---|
| `ASCII Art Sketchpad_files/index-Be_EdwvU.css` | `f7f63b40a600ee2a9f755c2c34e6ff784837c86eab7eacf5342826cb8bab8fb9` |
| `ASCII Art Sketchpad_files/index-CC-3q6yM.js` | `dc8f5ade64c287b2fc916a6ed744ecfe13554f912b5bb111ccbd85f776cf3f4d` |
| `ASCII Art Sketchpad_files/js` | `1cbb619c2bd51fc0a9f4163c5b29ea43cfb123fc168f5433cce9a62bd47b2642` |
| `ASCII Art Sketchpad_files/v4513226cdae34746b4dedf0b4dfa099e1781791509496` | `e1ac4849b9d4a498b68f8aca01e6ed99a11d94b35a2cec533b3916b8fb722fd6` |

The CODEXVault ASCII page declares copyright 2025 Ariel Williams and “All
Rights reserved.” No reusable implementation license was established for the
captured pages. This private custom-engine project does not classify that
uncertainty as a technical non-vendorability verdict. The exact sources can be
studied, retained, and adapted internally under the operator's private-use
policy while their provenance and unresolved license state remain attached.
Any later public distribution needs a separate license review; that future
distribution question is not an implementation blocker for this archive.

## 1. ASCII Art Sketchpad

The Sketchpad is a browser text-grid drawing application. It presents a
400-by-100 accessible grid with draw, select, line, ellipse, box, and erase
modes. Line output can use default, box, and block character families. It also
provides clear, undo, text loading, text export, clipboard copy, URL sharing,
keyboard editing, selection movement, and pointer drawing.

Its durable document is plain text. Share links compress that text with the
browser `CompressionStream` API into a URL fragment. This makes the page a
useful example of a low-friction cell sketch surface and a poor source for rich
compiler metadata.

### How pointer direction becomes a glyph

The operator's observation is correct for the default ASCII drawing family.
The page does not stamp one selected character into every visited cell. Its
pointer handler retains the previous continuous grid coordinate, whether the
stroke has started, and the previous normalized segment direction. A move is
accepted once either cell-axis delta reaches 0.35. The accepted segment then
enters a geometric rasterizer.

The rasterizer computes `slope = dy / dx` and walks the grid boundaries crossed
by that segment. For each crossed cell, it selects a character from the slope
and the subcell crossing position:

| Geometric case | Default ASCII family | Block family |
|---|---|---|
| near vertical, `abs(slope) > 1.6` | `|`, with `(` and `)` available at turns | `▌`, `▐`, `█` |
| diagonal, `0.75 < abs(slope) <= 1.6` | `\` for positive slope, `/` for negative slope | `▚`, `▞` |
| shallow segment | `-` plus `'`, `` ` ``, `´`, `.`, and `,` according to height and slope | `▀`, `▄`, `█` |

The previous segment direction supplies a second input. The implementation
computes the cross product and dot product between the previous and current
unit directions. A nontrivial turn sets a signed turn value used by the ASCII
selector; a near-horizontal reversal writes `>` and `<` at the reversal cell.
This is why two gestures that visit similar cells can display different
characters: slope, within-cell position, turn history, and traversal sequence
all participate. It is deterministic geometric quantization of pointer
samples, not glyph-atlas matching and not analysis of the pixels already on
screen. Pointer event spacing can therefore affect a corner when it changes
the segment sequence seen by the turn detector.

Box-character drawing uses a distinct rule. A grid traversal enumerates every
crossed cell. Each adjacent pair contributes left, right, up, and down bits to
a four-bit connectivity mask. A 16-entry lookup maps the mask to `─`, `│`,
rounded corners, tees, and `┼`. In this family, direction affects the visited
path, while the final glyph comes from accumulated connectivity. Reversing a
simple path should produce the same final mask. The mask exists only for the
current gesture, so a later stroke does not parse and merge connectivity from
previously painted box glyphs.

The relevant pinned-source anchors are the default/block selectors `ce` and
`le`, grid traversal `k`, connection accumulation `A`, connectivity lookup
`pe`, segment rasterizer `me`, path reducer `he`, and pointer-move handler
`St`, all on minified line 15 of
`ASCII Art Sketchpad_files/index-CC-3q6yM.js`. The archive hash above pins the
otherwise unstable minified names.

For FL-4512, the transferable idea is deeper than the visible punctuation.
A stroke can author structural facts: traversed cells, entry and exit edges,
junction degree, turn class, tangent direction, endpoint role, and optional
stroke order. The compiler should preserve those facts under stable glyph IDs,
then compile legal structural glyph sequences. It should not treat the
Sketchpad's emitted character as authoritative metadata. Undirected structure
must canonicalize forward and reversed gestures to the same result. Directed
semantics, such as an arrow and a temporal stroke order, need an explicit
authored direction field instead of accidental pointer traversal order.

Transfer value:

- pipeline-v3 can study its selection, shape, keyboard, clipboard, and
  text-grid interaction model beside the REXPaint workflow;
- FL-4512 can study its direct manipulation of structural character fields;
- a Godot port can separate the document, tools, history, renderer, and file
  exchange behind a logic-light screen orchestrator.

Missing for the destination:

- `.xp` layers, foreground/background parity, and REXPaint round-tripping;
- stable grapheme identities and offline-measured glyph attributes;
- pools, ramps, direction membership, morphology, connectivity, stroke
  identity, materials, feature roles, temporal profiles, and provenance;
- authored animation sequences and deterministic compiler output.

## 2. CODEXVault root page

The requested repository-root Pages URL currently returns the standard GitHub
Pages 404 document. The archive preserves that exact negative result. It must
not be described as a working landing page, tool index, Godot guide, and
must not be used as an evidence source.

## 3. CODEXVault `/tools/` page

The requested tools URL currently serves a standalone “MiniClone - Clone
Progress” interface, not a directory. Its source models a staged disk-cloning
demonstration with preflight checks, source locking, target selection, typed
destructive confirmation, progress, cancellation, and diagnostic detail.
Hardware labels are fixed, progress is timer-driven and randomized, and the
page contains no filesystem cloning implementation.

The page has almost no FL-4512 and pipeline-v3 content value. Its limited Godot
port value is the staged-operation UX: preflight state, operation state,
diagnostics, and presentation should have separate owners. External Iconify
and Google Fonts references mean this HTML capture is not fully self-contained
offline.

## 4. ASCII/Unicode Grid Studio (`ascii.html`)

This is the strongest editor reference in the set. It is a self-contained
Canvas 2D application in one HTML file. Its document model is a rectangular
grid with a flat `cells` array and a parallel nullable foreground-color array.
Blank cells are literal spaces. Snapshots contain width, height, glyph cells,
and foreground colors. Undo and redo use JSON snapshots with a 200-state limit
for each frame.

### Authoring surface

- pencil, eraser, eyedropper, type, text stamp, selection/move, box, line,
  circle, Braille, and connectivity-aware Worms tools;
- square and diamond brushes with adjustable size;
- ASCII, thin, heavy, double, and pseudo-3D box presets;
- authored corner, edge, line-pattern, circle-character, and thickness fields;
- Braille dot count and sampling controls;
- local-connectivity paths with turns, junctions, diagonals, and endpoint caps;
- foreground color, HSV editing, recent colors, glyph scaling, cell size,
  system font selection, zoom, grid lines, and ten-cell divisions;
- a movable, resizable, rotatable, lockable reference-image guide;
- a Unicode palette spanning common text, box, block, geometry, arrow, math,
  Greek, Braille, pipe, quadrant, and dotted-leader groups.

### Temporal surface

Frames can be added, duplicated, selected, deleted, named, and assigned delays
from 20 through 5000 milliseconds. The page provides previous/next onion skins,
looping playback, frame-local content, frame-local colors, and separate undo
history. This is directly useful as an interaction reference for authored
structural sequences and temporal review. It does not establish temporal
stability in the live 3D product.

### Persistence and exchange

- JSON stores grid metrics, font settings, glyph rows, color rows, frames,
  frame selection, frame delays, selected color, and color-mode state;
- TXT stores current-frame glyph rows;
- ANSI stores current-frame glyph rows with 24-bit foreground escapes;
- animation TXT stores frame names, delays, and glyph rows without colors;
- PNG stores the glyph canvas;
- settings JSON plus browser local storage retain editor preferences;
- TXT, JSON, settings JSON, and a local reference image can be loaded.

The reference image is transient DOM guidance. It is absent from the document
exports and PNG canvas output.

### Limits that matter

- no `.xp` import/export and no layer model;
- no per-cell background color;
- no stable grapheme ID, material role, morphology, connectivity record, ramp,
  direction score, stroke identity, feature class, temporal profile, atlas ID,
  compiler version, content hash, and provenance receipt;
- browser Canvas metrics and locally installed fonts can change availability,
  centering, blank detection, and visible output across machines;
- JavaScript UTF-16 indexing can split supplementary-plane scalars and cannot
  represent a general grapheme cluster as one stable cell;
- a raster-coverage heuristic can reject distinct thin glyphs and admit
  replacement-glyph variants;
- the implementation is one large script, which is unsuitable as the direct
  architecture for a Godot port.

### Required adaptation

Keep the interaction concepts and replace the authority model. A pipeline-v3
adapter must preserve `.xp` layers, foreground/background colors, sprite frame,
semantic anchors, source coordinates, and a defined CP437/Unicode mapping. An
FL-4512 authoring artifact must use compiler-owned grapheme IDs and explicit
memberships for pools, ramps, direction bins, morphology families, stroke
families, connectivity roles, structural positions, materials, features, and
temporal sequences. Every output needs schema, compiler, font, input, and
provenance hashes.

## 5. UNSCII Glyph Browser + Editor (`glyph.html`)

This self-contained browser application, branded GlyphLab in its source, loads
local TTF/OTF/TTC bytes, fingerprints the bytes, installs a Blob-backed font,
parses the font cmap, and presents supported Unicode codepoints in a
virtualized grid beside a plain-text scratch editor.

### Authoring surface

- searches accept a glyph, raw hexadecimal codepoint, `U+2588`, and ranges;
- quick pools cover ASCII, Latin-1, Box Drawing, Block Elements, Geometric
  Shapes, Braille, Miscellaneous Symbols, BMP PUA, Plane-15 PUA, and Plane-16
  PUA;
- filters expose favorites, recents, whitespace, combining marks, controls,
  labels, glyph size, and selected codepoint;
- tiles support selection, double-click insertion, drag/drop insertion, copy,
  and favorite marking;
- metadata shows character, codepoint, UTF-16 units, UTF-8 bytes, JavaScript
  escape, Python escape, HTML entity, and a coarse category.

Preferences live in `localStorage`. Favorites plus up to 64 recents are scoped
to a SHA-1 fingerprint of the local font bytes. Text can be copied, inserted,
dragged, and downloaded as UTF-8 plain text.

### Transfer value

The strongest ideas for FL-4512 are font-byte identity, cmap-driven inventory,
explicit scalar labels, virtualized browsing, range filters, encoding
inspection, and operator-authored sets. The useful adaptation replaces
Favorites with compiler-owned pools, ramps, direction bins, morphology
families, stroke identities, connectivity roles, structural positions,
material profiles, and temporal sequences. Export must become a versioned,
deterministic artifact containing normalized grapheme identity, derived
measurements, authored attributes, provenance, and validation results.

For pipeline-v3, the searchable Unicode grid can inform a palette beside XP
cell editing. Integration must define the mapping among Unicode
scalar/grapheme, font glyph, XP encoding, cell width, colors, layer, semantic
anchor, sprite frame, and compiled atlas ID. Plain text cannot round-trip XP.

### Limits that matter

- advertised TTC input is not established because parsing assumes one sfnt
  offset table at byte zero;
- cmap format 4 enumeration does not resolve every mapping to a nonzero glyph
  ID, so displayed coverage can overstate usable coverage;
- font readiness is not awaited before blank-raster scans, permitting fallback
  rendering to contaminate cached visibility results;
- blank detection uses coarse alpha sampling and can reject thin strokes;
- categories are hand-coded rather than sourced from a pinned Unicode
  Character Database;
- JavaScript string length counts UTF-16 units, not graphemes;
- text export loses font provenance and authored selections;
- there is no shaping, ligature, variation selector, metric, baseline,
  connection, morphology, stroke, temporal, material, color, layer,
  structure, atlas-build, and relation-graph model.

## Combined use in the selected architecture

These pages demonstrate useful authoring interactions. They do not demonstrate
the FL-4512 destination. The selected ownership remains:

1. Offline compiler owns stable glyph identity, measurements, authored
   memberships, weighted relations, profile compilation, schema, and
   provenance.
2. Editor owns user intent and durable authoring documents; it does not select
   final runtime glyphs.
3. Runtime consumes compiled programs plus live scene facts through one final
   writer.
4. Paper describes the accepted architecture and evidence after the owning
   product gates close.

For a Godot port, the browser prototypes should become a composed authoring
application with explicit owners rather than one translated monolithic script.

### Godot ownership model

| Owner | Godot shape | Sole responsibility | Must not own |
|---|---|---|---|
| `AsciiDocument` | session-owned `Resource` | document ID, dimensions, layers, frames, cell records, authored delays, schema, source provenance | viewport state, pointer handling, compiled measurements |
| `CompiledGlyphAtlas` | immutable `Resource` | stable glyph IDs, font hashes, measured attributes, authored memberships, relation projections, profile tables, compiler receipt | current document edits, live scene facts, per-frame product choice |
| `EditorSession` | `RefCounted` | active frame, selection, active tool ID, zoom, unsaved state | durable cell content, glyph facts |
| `DocumentEditor` | `RefCounted` | validate and apply typed edit commands to the session document | input sampling, rendering, file-format parsing |
| `CanvasView` | one custom `Control` | grid-to-screen transforms, visible-range calculation, batched cell drawing, overlays, dirty-region redraw | document mutation, glyph selection policy, history |
| tool components | `RefCounted` strategies | convert normalized input into typed intents and edit commands | direct file writes, direct view mutation, runtime glyph selection |
| `HistoryService` | `RefCounted` | transaction boundaries plus undo and redo stacks of changed-cell deltas | whole-document snapshots per pointer event, rendering |
| `PlaybackClock` | lightweight `Node` | transient playback time and displayed-frame cursor | authored frame order and delay values |
| `ImportExportService` | injected service with format adapters | TXT, ANSI, JSON, XP, compiler-source, and canonical binary boundaries | UI dialogs, document display, hidden fallback mapping |
| `ReferenceImageState` | separate session `Resource` | image identity/hash, transform, opacity, visibility, lock state | glyph cells, compiler artifacts unless explicitly exported as a sidecar |
| `PaletteProvider` | read-only query service | expose authored pools and atlas records to palette UI | committing edits, selecting the final live-game glyph |
| `AsciiEditorRoot` | logic-light root `Control` | connect child signals, inject dependencies, call components downward | raster algorithms, serialization, history logic, document truth |

`AsciiDocument` and `CompiledGlyphAtlas` are deliberately different Resource
types. The first is mutable authoring truth owned by one editor session. A
loaded template must be duplicated before mutation so another scene cannot
share the same editable instance. The second is content-hash-pinned compiler
output and stays read-only. A palette may query it, yet neither the palette nor
the view may change it. Large cell arrays should use packed storage inside one
document aggregate plus a canonical binary exchange format; forty thousand
cell Nodes and thousands of individual `.tres` records would waste SceneTree
and Resource overhead.

The frame boundary also needs two owners. `AsciiDocument` owns authored frame
order, frame content, and delay values because those facts must survive save
and load. `PlaybackClock` owns only ephemeral elapsed time and the current
preview cursor because `_process()` state does not belong in the saved
document. Playback requests a frame projection from the document, then emits a
display-frame signal. It never rewrites authored timing.

The view should be a projection. One custom `Control` can draw the visible cell
range in `_draw()`, using pinned font metrics and dirty rectangles. It should
not create one `Label` per cell. `CanvasView` converts pointer coordinates into
continuous grid coordinates, then emits normalized pointer samples upward. It
does not decide that a slope means `/`; a stroke tool owns that policy and
returns a command. The root passes the command to `DocumentEditor`, which opens
one history transaction, applies validated cell deltas, and emits one
document-changed signal back toward the view.

The direction-sensitive tool can be represented as this deterministic flow:

```text
InputEvent
    -> CanvasView coordinate conversion
    -> StrokeSampler cell-space polyline
    -> StrokeTopologyResolver edge masks + turns + endpoints
    -> GlyphStructurePolicy authored structural roles
    -> EditCommand changed-cell delta
    -> DocumentEditor -> AsciiDocument
                       -> HistoryService

CompiledGlyphAtlas -> PaletteProvider -> operator glyph/pool intent
AsciiDocument ------------------------> CanvasView projection
ReferenceImageState ------------------> CanvasView guide overlay
```

For the FL-4512 architecture, `GlyphStructurePolicy` should produce structural
attributes and legal authored memberships, not an untracked final character.
The offline compiler consumes a frozen document/source snapshot and produces
`CompiledGlyphAtlas`. The live 3D runtime later combines that immutable artifact
with renderer-owned scene facts. The Godot editor therefore helps author the
compiler inputs without becoming a second runtime selector.

`ImportExportService` is the only interchange owner. Each adapter must map
into the same typed document transaction and report unsupported data
explicitly. The XP adapter preserves layer, foreground color, background
color, frame, source coordinate, semantic anchor, and the declared
CP437/Unicode/GlyphId mapping. TXT knowingly drops metadata. ANSI preserves
text plus supported colors. Compiler-source export carries glyph identity,
structural facts, memberships, schema version, font identity, and provenance.
No format adapter may silently reconstruct data through a plausible fallback.

`ReferenceImageState` remains separate because the guide is neither glyph
content nor compiled truth. A saved editor sidecar can retain its file hash and
transform when desired. Normal document export excludes it. `PaletteProvider`
is similarly narrow: it filters compiler-owned pools, ramps, direction bins,
morphology families, connectivity roles, and recent operator choices. Clicking
a tile emits glyph intent; only `DocumentEditor` commits the resulting command.

The root `Control` is an orchestrator in the strict Godot composition sense.
Children emit signals upward. The root calls injected components downward.
Sibling tools never call one another, views never reach into services, and
services never search the scene tree. Exported typed references plus direct
signals keep the scene testable in isolation.

The minimum architecture tests follow directly from those boundaries:

- forward and reversed undirected strokes compile to identical topology;
- the same polyline sampled at different pointer-event rates yields the same
  normalized cell path;
- connectivity masks produce the expected endpoint, corner, tee, and junction
  roles;
- one pointer gesture creates one undoable transaction;
- undo then redo reproduces the exact document hash;
- XP import then export preserves every represented field;
- atlas hashes and glyph IDs remain unchanged during editing;
- reference-image changes never alter document and atlas hashes;
- rendering the view never mutates the document;
- the root contains wiring while domain algorithms remain in components.

This separation is useful because it lets the private Godot tool evolve its UI,
file adapters, compiler inputs, and renderer independently while retaining one
owner for every truth surface. It also prevents the single-file browser
prototypes from becoming monolithic Godot scene scripts.

## Evidence boundary

The findings above come from HTTP status checks, exact byte archives, and
static source inspection. No interactive browser session, Godot runtime,
pipeline-v3 `.xp` round-trip, compiler execution, native game run, WebAssembly
run, temporal product capture, and operator visual signoff were performed.
