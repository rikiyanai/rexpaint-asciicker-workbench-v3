# Workbench Canonical Spec

**Authority:** this file and `PLAYWRIGHT_FAILURE_LOG.md` are the only active canon docs for the browser workbench.

**Last updated:** 2026-04-29
**Checkpoint baseline:** `v3-refactor-start @ a536b81`
**Audit scope:** current branch after the 2026-04-14 through 2026-04-17 failed refactor narrative, the manual-assembly runtime proof, the Y9-2 generalized-bundle porting audit, the semantic-runtime contract coverage slice, and the surviving local/browser/runtime assets in this repo

## Section 0 - Behavior Rule, Scope, And Authority

### Cardinal Behavior Rule

**Purpose:** Prevent frame-blind fixes where the repo keeps making local changes
inside the wrong owner boundary, proof surface, or product surface and then
mistakes that activity for progress.

Every task in this repo is nested inside a larger requirement. Before acting,
identify what the user is actually asking for, which boundary or owner that
requirement touches, and whether the current file, workflow, artifact, or
subsystem is the correct place to act. Do not assume the current structure is
already valid. If the frame is wrong, changing things inside it is accumulated
misalignment, not progress. Never confuse the nearest actionable patch with the
correct architectural action. Verify the frame first.

### Scope And Authority

Only two application sections own product behavior in this canon:

1. Section 1 - the root editor contract
2. Section 2 - the Asciicker wrapper/runtime contract layered on top of it

Section 3 is the harness/proof section that observes and proves Sections 1 and
2. It is not a third product owner.

Only two active canon docs exist:

1. `PLAYWRIGHT_FAILURE_LOG.md`
2. `docs/plans/2026-03-23-workbench-canonical-spec.md`

All former handoff, worksheet, claim-verification, and reference docs are
archive/reference material only unless this section or the failure log
explicitly revives them.

For canon work in this repo, the startup/read order is:

1. `python3 scripts/conductor_tools.py status --auto-setup`
2. `PLAYWRIGHT_FAILURE_LOG.md`
3. `docs/plans/2026-03-23-workbench-canonical-spec.md`
4. the live code and tests for the behavior under audit

If an older workflow references missing helpers such as
`scripts/git_guardrails.py`, `scripts/analyze_failure_log.py`, or
`scripts/analyze_runs.py`, treat that as stale repo alignment, not as a reason
to invent a new authority path.

### Canon And Repo Alignment

The 2-doc canon is the live authority model, but repo alignment is still
incomplete:

1. `README.md:75-76` still points at retired canonical paths.
2. `scripts/doc_lifecycle_stitch.sh:24-39`,
   `scripts/doc_lifecycle_stitch.sh:63-75`, and
   `scripts/doc_lifecycle_stitch.sh:250-252` still point at retired
   failure-log/spec paths and the older protected-doc set.
3. `scripts/git_guardrails.py` is referenced by older doc-health instructions
   but is absent in this repo, so any startup flow that assumes it exists is
   stale.
4. Top-level `AGENTS.md` and `CLAUDE.md` must stay aligned to the 2-doc canon
   and the deletion-first architecture rule.

These are repo-health failures. They are separate from, and additive to, the
Section 1 and Section 2 architecture failures.

### Non-Negotiable Architecture Laws

These are top-level canon. They are not historical notes, convenience
guidelines, verifier-local rules, or temporary refactor suggestions.

#### Law 1 - Single Ownership Or No Ownership Claim

**Purpose:** Simplicity and modularity are the governing engineering rules in
this repo. Every mutable truth source must have one owner or later proof cannot
tell which path actually produced the behavior.

No mixed ownership is allowed at any abstraction level. If editor, wrapper,
runtime, proof, deployment, or documentation ownership moves, the old owner
must be deleted or hard-disabled before the replacement is added. Wrapping,
shadowing, bridge logic, compatibility fallbacks, and temporary parallel owners
are regressions unless they are explicitly non-runtime historical material.

#### Law 2 - Section 1 Owns The Editor Root

**Purpose:** Prevent template, bundle, runtime, or proof workflows from
redefining the base editor contract.

Section 1 is the root editor owner. Whole-sheet document state, editing
behavior, layers, history, browse mode, and root image actions belong to the
Section 1 owner graph. Section 2 may adapt, seed, validate, export, or preview
that state, but it may not replace the root editor, create a second
authoritative document/session owner, or redefine the base editing workflow.

#### Law 3 - Section 2 Owns Runtime And Engine Truth Only Downstream

**Purpose:** Keep the wrapper/runtime layer useful without letting it reclaim
authoring ownership.

Section 2 owns engine-facing filename/runtime truth, bundle structure, export
contracts, native-builder constraints, and runtime preview adaptation. It does
not own the root image/session, authored geometry, or the primary editor
workflow. If Section 1 and Section 2 disagree, Section 1 wins for editor
ownership and Section 2 wins only for downstream engine/runtime truth.

#### Law 4 - Proof Observes; It Does Not Own

**Purpose:** Prevent acceptance, structural, or runtime proof from becoming a
hidden architecture owner.

Acceptance proof, structural gates, and visual/runtime proof are observational
surfaces only. They may reveal contradictions, but they do not establish
product ownership, redefine behavior, or justify bypassing the shipped UI.
Verifier gaps are verifier gaps; they are not permission to move the boundary.

#### Law 5 - Debug And Diagnostic Paths Are Not Product Flows

**Purpose:** Keep `/workbench` honest about what a user can actually do.

Debug harnesses, raw iframe loaders, external XP injection helpers,
`/termpp-skin-lab`, MCP-only shortcuts, and other diagnostic paths may remain
for development, but they must stay explicitly diagnostic and off the primary
product path. Do not surface them as peer user actions inside `/workbench`, and
do not use them as acceptance substitutes.

#### Law 6 - Geometry Ownership Must Stay Explicit

**Purpose:** Prevent source analysis, template shape, and runtime constraints
from collapsing into one hidden geometry owner.

Source PNG mapping, authored frame geometry, and runtime/native export are
separate problems. The analyzer is advisory only. Frame navigation owns authored
row/frame geometry. The whole-sheet editor owns the stored document. Templates,
native builders, and runtime/export paths are downstream adapters that may seed,
normalize, or reject shapes, but they may not silently redefine authored
geometry.

#### Law 7 - Uniform Frame Geometry Is Session-Level Truth

**Purpose:** Preserve the whole-sheet/frame-nav contract and prevent
per-sprite special cases from becoming silent geometry owners.

One authored session/action has one frame-slot size. Individual sprite content
may vary inside those slots, but the slot geometry itself is uniform across the
session. If one mapped sprite must be larger, enlarge the authored session
geometry for that action. Do not create one special larger frame while other
frames remain smaller.

#### Law 8 - Live Pipeline-V2 Behavior Stays Frozen Until Replacement

**Purpose:** Prevent premature public cutover and split ownership on the live
`/xpedit` URL.

Do not change live pipeline-v2 `rikiworld.com/xpedit` behavior until the v3
replacement is complete, working, and ready for same-URL cutover. The target is
replacement, not indefinite dual ownership. Any ownership move on the public URL
must delete or retire the old owner rather than layering a second one beside it.

#### Law 9 - Canon Requirements Stay Above Status Mirrors

**Purpose:** Prevent doc cleanup from burying active rules under audits,
sequence notes, or historical narration.

This spec may contain deployment notes, sequence queues, audits, and current
state mirrors, but those sections may not replace or bury the laws above. If a
status note conflicts with a law, the law wins unless
`PLAYWRIGHT_FAILURE_LOG.md` records a reviewed replacement.

## Application Statement

Asciicker XPEdit is a browser-based XP sprite-sheet authoring workbench for the Asciicker / TERM++ game runtime.

It currently does all of the following:

- creates blank template-backed authoring sessions
- imports existing `.xp` files
- uploads `.png` source art as reference input
- optionally runs backend source loading to populate XP/session geometry
- edits XP cells and layers in an embedded whole-sheet editor
- shows source images and canonical layout state in a separate source panel
- provides a separate frame-navigation/grid surface for preview, selection, and metadata operations around the root sheet
- saves and exports `.xp`
- injects authored XP or bundle payloads into the embedded Skin Dock/runtime preview
- can stage native TERM++ diagnostic skin runs from repo-local assets

That is the current shipped application. It is not already a pure whole-sheet-root REXPaint clone, and it is not just a sprite-slicing wrapper.

The user-facing runtime lane is singular: the current whole-sheet XP editor state is what gets tested in the embedded Skin Dock/runtime preview (`Test This Skin` or the bundle equivalent). Debug-only harnesses such as `/termpp-skin-lab`, raw iframe loaders, or external-XP injection helpers may exist for developers, but they are not part of the `/workbench` product surface and must not appear as peer user actions.

Public/local parity note: the current local served workbench now exposes the
same named direct source controls (`Select`, `Draw Box`, `Drag Row`,
`Drag Column`, `Vertical Cut`, `Find Sprites`) and the same major panel
surfaces (`Recorder`, `Skin Test dock`, `Verification`, `Session`) on both
root-hosted and `/xpedit` local URLs. Full public parity is still not proven
until a direct live-vs-local audit is rerun against `rikiworld.com/xpedit`.

### Deployment Lineage And Replacement Target

The deployment lineage is now explicit:

1. The public `https://rikiworld.com/xpedit` site is still the behavior-frozen
   pipeline-v2 baseline served from its own repo/deploy line.
2. This repo/branch (`asciicker-pipeline-v3`, `v3-refactor-start`) is the
   refactor successor to that pipeline-v2 baseline.
3. The target end state is not long-term dual ownership. The target is
   retirement-and-replacement on the same public URL:
   - keep the live pipeline-v2 site frozen until the v3 replacement is ready
   - privately archive the current public pipeline-v2 repo/site so the old
     implementation is no longer publicly visible
   - retire the current `asciicker-pipeline-v3` repo identity
   - create the replacement repo named `xpedit` from this v3 code line
   - redeploy the v3 workbench so `rikiworld.com/xpedit` resolves to the
     replacement repo/deploy line
   - rerun public smoke/parity verification on the replacement before calling
     the cutover complete
4. Until that cutover is executed and logged, this repo remains the refactor
   candidate rather than the live public owner.

Deployment-path clarification verified from the live deploy files in this repo:

1. Public `/xpedit` traffic is routed by Cloudflare Worker to Cloud Run, not
   served directly from repo visibility.
   - `deploy/cloudflare-worker/wrangler.toml` routes both
     `rikiworld.com/xpedit` and `rikiworld.com/xpedit/*`.
   - `deploy/cloudflare-worker/xpedit-router.js` forwards those paths to the
     configured Cloud Run URL.
   - `.github/workflows/deploy-cloudrun.yml` deploys the app with
     `PIPELINE_BASE_PATH=/xpedit`.
2. Therefore, making the current live `xpedit` repo private should not by
   itself take down `https://rikiworld.com/xpedit`, as long as:
   - the current Cloud Run service remains up
   - the Cloudflare Worker routes remain in place
   - deploy secrets / workload identity / GitHub Actions access required for
     future deploys remain valid after the repo visibility change
3. This statement applies to the `/xpedit` app route only. It does not make any
   claim about unrelated non-`/xpedit` GitHub Pages/origin content on
   `rikiworld.com`.

### Verified Replacement Progress (2026-04-26)

The following replacement-sequence facts are now directly verified:

1. The current live GitHub repo `rikiyanai/asciicker-xpedit` was switched from
   `PUBLIC` to `PRIVATE` on 2026-04-26.
   - `https://rikiworld.com/xpedit` remained live because the app route is
     still served by Cloudflare Worker -> Cloud Run.
   - formal GitHub "archive" state was not toggled in this slice; only
     visibility was changed.
2. The current local branch has one real headed authored-XP runtime proof lane
   for the classic/manual-assembly path:
   - root-hosted PASS artifact:
     `output/manual_assembly_e2e_root_runtime_2026-04-26/report.json`
   - prefixed `/xpedit` PASS artifact:
     `output/manual_assembly_e2e_prefixed_runtime_fixed_2026-04-26/report.json`
3. The prefixed proof did not pass by assumption. It first failed on a real
   base-path defect:
   - `/xpedit/workbench` still referenced `/workbench-template-gating.js`
     without the `/xpedit` prefix
   - the prefixed HTML loaded, but the missing asset broke workbench JS
     readiness and blocked the headed verifier before any workflow action
4. That `/xpedit` asset-path defect is fixed in the current branch baseline by
   adding the missing base-path rewrite for
   `/workbench-template-gating.js` and pinning it with a focused prefixed-route
   regression test.

## Section 1 - Fundamental REXPaint-Parity Spec

This section is the root editor canon.

Everything in Section 2 is subordinate to this section. Sprite-sheet slicing, bundle/template helpers, Skin Dock, and runtime injection are wrappers over the editor contract defined here. They are not allowed to redefine the root owner or the base editor workflow.

### 1.1 Embedded Local REXPaint Manual (Verbatim)

The local manual is embedded here wholesale so the parity target lives inside the canon spec instead of in a separate active doc.

```text
=================================================================
 REXPaint v1.70 - Manual
=================================================================

A powerful and user-friendly ASCII art editor.


-----------------------------------------------------------------
 Background
-----------------------------------------------------------------

There are a number of ASCII art editors available on the web, but most suffer from poor usability or small feature sets (one notable exception being eigenbom's awesome fork of ASCII Paint). For development of my own projects, I needed an application equipped with a wide range of tools for quickly drawing and manipulating ASCII art, as well as the ability to easily browse the images created as stored in their native format. Thus REXPaint was born.

Over the years since its first public release, REXPaint has found use as a general purpose ASCII art editor, as well as a roguelike development tool for mockups, mapping, and design. I love seeing what people create with this program, so send me a link/copy if you've made something cool! (Or share it with us on the forums: www.gridsagegames.com/forums/index.php?board=8.0)


-----------------------------------------------------------------
 Features
-----------------------------------------------------------------

An overview of REXPaint's major features:
* Edit characters, foreground, and background colors separately
* Draw shapes and text
* Copy/cut/paste areas
* Undo/redo changes
* Preview effects simply by hovering the cursor over the canvas
* Palette manipulation
* Image-wide color tweaking and palette swaps
* True-color RGB/HSV color picker
* Create multi-layered images
* Zooming: Scale an image by changing font size on the fly
* Custom fonts and support for extended characters and tilesets
* Browse art assets and begin editing at the press of a button
* Images highly compressed
* Export PNGs for use in other programs or on the web
* Import/export .ANS files for ANSI art
* Other exportable formats: TXT, CSV, XML, XPM, BBCode, C:DDA
* Import .TXT files
* Skinnable interface


-----------------------------------------------------------------
 Table of Contents
-----------------------------------------------------------------

* Canvas
    Resizing
    Shifting
* Drawing
    Apply
    Draw Modes
    Text Input
    Preview
    Undo
* Fonts
    Glyphs
    Glyph Swapping
    Custom and Extended Fonts
    Custom Glyph Mirroring
    Custom Unicode Codepoints
* Palettes
    Selection & Editing
    Color Picker
    Palette Files
    Extraction
    Adding
    Organization
    Palette Swapping
    Transparency
* Layers
    Control
    Active Layer
    Order
    Visibility & Locking
    Merging
    Extended Layers Mode
* Browsing
    File/Image Control
    Viewing & Editing
    Saving
    Exporting
* Customization
    Options
    Skins
* Commands
* Appendix A: Known Issues
* Appendix B: .xp Format Specification
* Appendix C: External Libraries and Tools
* Appendix D: ANSI Art (.ans)
* Appendix E: Exportable Text Formats (.txt, .csv., .xml, BBCode)
* Appendix F: Importing Text Files
* Appendix G: Importing PNGs
* Appendix H: Additional Command Line Options
* Appendix I: Exporting ANSI art for C:DDA

-----------------------------------------------------------------
 Canvas
-----------------------------------------------------------------

The black area to the right of the tool menus is the canvas view where all image editing occurs, and the image itself initially appears as a box outline that defaults to the size of the entire canvas view.

 Resizing
----------
Resize the image as necessary (Ctrl-r), ideally before starting to draw so that later changes are not affected by a change in image dimensions. Resizing can be done at any time, but the dimensions are always based from the top-left corner of an image, so make sure the portion of a larger image you wish to retain is based in the top-left corner before shrinking it (move the relevant section with the copy tool).

 Shifting
----------
To view different parts of a large image (or reposition a smaller one), hold spacebar while left-clicking on the image and moving the mouse to drag it (Photoshop style). The numpad can also be used for eight-directional shifting of the image, Enter resets its location, and Ctrl-Enter centers it.


-----------------------------------------------------------------
 Drawing
-----------------------------------------------------------------

 Apply
-------
The apply menu determines what is actually produced by the current draw mode when you left-click on the image. Glyphs (characters), foreground color, and background color are each drawn/edited separately, and can be individually toggled on and off via the menu buttons or 'g', 'f', and 'b'. Thus if you activate "glyph" and deactivate "fore" and "back," when you draw only the current glyph will be applied, while the image's colors remain unchanged. Activating all modes will overwrite the glyph and both foreground and background colors when drawing. (Turning all apply modes off would draw... nothing, and be completely pointless!)
    The colors to be applied are shown to the right of their button, and the current glyph is that highlighted/chosen among the characters in the font box. Change the glyph by left-clicking on a different one in the font box, and change the colors by either left-clicking on the color square (see Color Picker explanation further below) or chosing a color from the palette (LMB choses a color for the foreground, RMB for the background).

 Draw Modes
------------
Drawing modes define the shape and area of the image affected while drawing. Only one mode can be active at a time, and some modes have an alternate setting that changes their behavior (left-click on the active mode to toggle its secondary feature, or cycle through them if more than one).
    Cell ('c'): Applies the effect to a single "cell" (space) on the image. Hold LMB and move the cursor to keep drawing. Alternate mode: Auto-wall/auto-box drawing.
    Line ('l'): Applies the effect to a line. Left-click at the line's start and release the button at its end, or press RMB/ESC before releasing the button to cancel the line.
    Rect ('r'): Applies the effect to a rectangular area. Left-click at one corner of the rectangle and release the button at the opposite corner, or press RMB/ESC before releasing the button to cancel the rectangle. Alternate mode: Fills the entire rectangle instead of drawing an outline.
    Oval ('o'): Like rect mode, but draws ovals. Alternate mode fills the oval. By default ovals are centered on the point chosen; to instead draw from any corner switch the oval drawing method via Alt-o.
    Fill ('i'): Applies the effect to all like cells attached to the one under the cursor. Alternate Mode: Fill search is performed in 8 directions rather than 4.
    Text ('t'): Types text onto the image.
    Copy (Ctrl-c): Copies a rectangular area of the image into the clipboard for later pasting. Alternate mode: Cut (Ctrl-x).
    Paste (Ctrl-v): Paste the clipboard contents to the image. Alternate modes: Flip clipboard contents horizontally, vertically, or both.

 Preview
---------
While the cursor is hovering over the image, applicable draw modes (cell, fill, paste) will show a preview of what the image will look like assuming a left-click at that location.

 Undo
------
All image manipulation actions can be undone/redone (Ctrl-z/Ctrl-y, or just z/y). Undo histories are also saved separately for each image.


-----------------------------------------------------------------
 Fonts
-----------------------------------------------------------------

Images themselves do not store font information, instead remembering only what glyph/character index belongs at each position. This means you can dynamically change the size and/or appearance of an image by simply switching the font (Ctrl-PgUp/Dn or '<'/'>').

 Glyphs
--------
Select a glyph to draw with by clicking on it in the font window. Right-click on a cell in the image to pick up its glyph and colors.
    Toggle highlighting of all used glyphs by pressing 'u'. To see where a specific glyph has been used, hold Alt while hovering over it in the font window.

 Glyph Swapping
----------------
To replace every occurence of a glyph in all visible unlocked layers, Shift-LMB on it in the font window, then Shift-LMB on the new glyph to replace it with.

 Custom and Extended Fonts
---------------------------
By default, both the GUI and images use a standard 256-glyph Code Page 437 font. REXPaint makes this same font available at several sizes. You can edit these fonts (in the "data/fonts/" directory), and/or add new ones by creating a new .png bitmap and listing it in the "data/fonts/_config.xt" text file. Fonts do not require square glyphs (rectangles are okay), but both the GUI and Art font must use the same glyph dimensions.
    Although the default number of rows in a font bitmap is 16, fonts with additional rows are supported, essentially allowing space for an unlimited number of glyphs in an image. Simply specify the proper number of rows available for the relevant art font in _config.xt.


-----------------------------------------------------------------
 Palette
-----------------------------------------------------------------

Palettes in REXPaint are tools intended purely for color selection and organization, thus images themselves do not store palettes (i.e., image colors are not "indexed").

 Selection & Editing
---------------------
Left-clicking on a palette color selects it as the foreground color; right-clicking selects it as the background color. Clicking on the same color again will allow you to edit it in the color picker.

 Color Picker
--------------
Left-click on a color to select it, and click on it again to accept it. Choose a precise color by specifying HSV/RGB number values (click on the number, or press 'h'/'s'/'v'/'r'/'g'/'b').

 Palette Files
---------------
Any number of palettes can be created by clicking on the '+' button (switch between them with the buttons or '['/']' keys). Stored in text format in the "data/palettes/" directory.

 Transparency
--------------
Background color 255,0,255 (hot pink) identifies transparent cells. Draw using the transparent background color to create a transparent cell/area.


-----------------------------------------------------------------
 Layers
-----------------------------------------------------------------

 Control
---------
Each image automatically comes with one base layer (required). More can be created with Ctrl-l or by clicking on the layer window's '+' button. A single image can have up to nine separate layers, and all newly created layers are automatically filled with transparent cells (255,0,255).

 Active Layer
--------------
The "active layer" is the one which effects are applied to when drawing. Change the active layer by clicking on a different number, pressing 1~9, or using the mouse wheel while the cursor is over the canvas area.

 Order
-------
Layers are listed in top to bottom order, and their order determines which are drawn on top. The relative order of layers can be changed by clicking on the arrow buttons.

 Visibility & Locking
----------------------
Individual layers can be hidden from view. Locked layers (Shift-# or the "Lck" button) prevent editing.

 Merging
---------
Use Ctrl-Shift-m to merge the active layer downward.


-----------------------------------------------------------------
 Browsing
-----------------------------------------------------------------

Switch between paint mode and browse mode with Tab. Browse mode allows you to view all the images in the "images/" directory and subdirectories.

 File/Image Control
--------------------
New images: Ctrl-n or New button. Rename (RMB), duplicate (Shift-LMB) and delete (Ctrl-Shift-Alt-LMB).
    Reload all image files: Ctrl-Shift-r or the "R" button.

 Viewing & Editing
-------------------
Images do not need to be explicitly opened. When the program starts, all images are loaded into memory. Browse through them by clicking on their name or pressing up/down.

 Saving
--------
Save with Ctrl-s or the Save button.

 Exporting
-----------
Export PNG: Ctrl-e. Export TXT: Ctrl-t. Export CSV: Ctrl-k. Export ANS: Ctrl-a. Export XML: Ctrl-m. Export XPM: Ctrl-p. Export BBCode: Ctrl-b.


-----------------------------------------------------------------
 Commands
-----------------------------------------------------------------

 Font
------
Ctrl-PgUp/Dn / </>      Change Font (Scale Image/UI)
LMB                     Select Glyph
Arrows                  Shift Selection
u                       Toggle Used Glyph Highlighting
Alt (hold)              Highlight Hovered Glyph in Current Layer
Shift-LMB x2            Swap Occurences of Glyph 1 with Glyph 2

 Palette
---------
[/]                     Change Palette
LMB (x2)                Set (Edit) Foreground Color
RMB (x2)                Set (Edit) Background Color
Shift-LMB x2            Swap Occurences of Color 1 with Color 2
Ctrl-Shift-o            Organize Palette
Ctrl-Shift-e            Extract Image Palette
Ctrl-Shift-p            Purge Unused Colors
Ctrl-LMB x2             Swap Palette Colors

 Drawing
---------
c (x2)                  Cell (Auto-walls)
l                       Line
r (x2)                  Rectangle (Filled)
o (x2)                  Oval (Filled)
Alt-o                   Toggle oval drawing method (center/corner)
i (x2)                  Fill (8-direction)
t                       Text
Ctrl-c                  Copy
Ctrl-x                  Cut
Ctrl-v (x2)             Paste (Flip)
ESC / RMB               Stop/Cancel

 Text Tool
-----------
Enter                   Confirm
Ctrl-Enter              New line below
Escape                  Cancel
Left/Right Arrow        Move caret
Backspace               Delete before caret
Delete                  Delete at caret
Up/Down                 Cycle text history
Ctrl-v                  Paste from clipboard

 Apply
-------
g (G)                   Toggle (Solo) Glyph
f (F)                   Toggle (Solo) Foreground Color
b (B)                   Toggle (Solo) Background Color
RMB                     Add Color to Palette
Alt-w                   Swap Foreground/Background Colors
d                       Increment Copy/Cut/Paste Layer Depth

 Canvas
--------
Spacebar (hold)         Enter Drag Mode
LMB                     Hold Canvas to Drag
RMB                     Copy Cell Contents (Applied Modes Only)
Shift/Alt (hold)        Hide Preview
z/Ctrl-z                Undo
y/Ctrl-y                Redo
Ctrl-d                  Toggle Rect Dimension Display
Ctrl-g                  Toggle Grid
Ctrl-Tab                Switch between current/latest image
Ctrl-Up/Down            Edit Previous/Next Image

 Layers
--------
Ctrl-l                  New Layer
Wheel                   Cycle Active Layer
1~9                     Activate Layer
Ctrl-1~9                Toggle Layer Hide
Shift-1~9               Toggle Layer Lock
Ctrl-Shift-m            Merge Active Layer
Ctrl-Shift-l            Toggle Extended Layers Mode

 Browse
--------
Wheel / PgUp/Dn         Scroll List
LMB                     View Image
Up/Down                 View Previous/Next Image
RMB                     Rename Image
Shift-LMB               Duplicate Image
Ctrl-Shift-Alt-LMB      Delete Image
Ctrl-Shift-r            Reload All Image Files
Home/End                First/Last Image

 Image
-------
Ctrl-n                  New (in Base Path)
Ctrl-r                  Resize
Ctrl-s                  Save
Ctrl-e                  Export PNG
Ctrl-t                  Export TXT
Ctrl-k                  Export CSV
Ctrl-a                  Export ANS
Ctrl-m                  Export XML
Ctrl-p                  Export XPM
Ctrl-b                  Export BBCode

 General
---------
Tab                     Toggle Paint/Browse
F1 / ?                  Commands
F3                      Options
F4                      Change Skin
Alt-F4                  Exit
Alt-Enter               Fullscreen


-----------------------------------------------------------------
 Appendix B: .xp Format Specification
-----------------------------------------------------------------

The .xp files are deflated with zlib (gzipped); once decompressed the format is binary:

#-----xp format version (32)
A-----number of layers (32)
 /----image width (32)
 |    image height (32)
 |  /-ASCII code (32) (little-endian!)
B|  | foreground color red (8)
 |  | foreground color green (8)
 |  | foreground color blue (8)
 | C| background color red (8)
 |  | background color green (8)
 \--\-background color blue (8)

Data stored in column-major order. Transparent cells identified by background color 255,0,255.


-----------------------------------------------------------------
 Appendix H: Additional Command Line Options
-----------------------------------------------------------------

 Exporting PNGs
----------------
-exportAll              Export every .xp file as PNG
-export:XXX             Export individual .xp file as PNG

 Creating/Opening Images
-------------------------
-create:XXX             Create new .xp file
-open:XXX               Open REXPaint with .xp file preselected
-txt2xp:XXX             Convert .txt file to .xp
-png2xp:XXX             Convert .png file to .xp (filename must include _WWWxHHH)
-uniqueGlyphs           Use unique glyphs for different characters in png2xp


-----------------------------------------------------------------
 Key Configuration Reference
-----------------------------------------------------------------

REXPaint.cfg options:
* unlimitedFontSize: Load all fonts even if too large for screen
* txtOutputUTF8: UTF8 encoding for TXT export
* baseImagePath: Base path for image loading (relative to .exe)
* exportsToBase: Export to base path vs source subdirectory
* ignorePath: Paths to exclude from browser
* ansiMode: Enable ANSI art restrictions
* fontKeyColorOverride: Override font background color detection
* glyphScrollRowCount: Mouse scroll rate for glyph area
* glyphSelectAlwaysAutoscrolls: Auto-scroll to selected glyph
* noSaveForOutOfBoundsGlyphs: Block saving images with OOB glyphs
* ansOutputNoCursorShift: Disable cursor shift in ANS export
```

### 1.2 Northstar Product Goal

The long-range product target is:

1. a web-based, mobile-accessible, REXPaint-class XP editor
2. with Asciicker-specific sprite/bundle/runtime helpers layered on top of it
3. without letting those helpers own the root image/session model

This means the current workbench must be treated as a transitional hybrid, not as
the final architecture.

Two corollaries are mandatory:

1. `rikiworld.com/xpedit` stays behavior-frozen until the deletion-first refactor is complete and working.
2. No design or implementation choice in Section 2 may override the root editor contract in Section 1.

### 1.3 Derived Non-Negotiable Parity Contract

The embedded manual yields the following non-negotiable editor contract:

1. The image/canvas is the primary object.
2. `New`, open/import, resize, save, and export are image actions.
3. Paint mode and browse mode are peer modes of the same editor.
4. Layers are intrinsic to every image and must be directly controllable.
5. Apply modes split glyph, foreground, and background behavior.
6. The active tool operates on the active image and active layer.
7. Undo/redo are editor-level operations, not wrapper-only helpers.
8. PNG/source workflows are helpers around the editor, not replacements for the editor.
9. The browser implementation must converge on pointer-device-agnostic interaction for mouse, touch, and pen. Detailed mobile UX remains a research-backed design phase, but the requirement itself is already part of the canon.

### 1.4 Canonical Root Behavior Families

The root editor SAR tree must be organized around editor behavior, not around
template or pipeline remnants:

1. **Image Lifecycle**
   - new
   - open/import
   - resize
   - save
   - export
2. **Mode Control**
   - paint mode
   - browse mode
3. **Canvas Navigation**
   - pan/shift
   - zoom/font scale
   - grid toggle
4. **Apply State**
   - glyph on/off
   - foreground on/off
   - background on/off
5. **Draw Tools**
   - cell
   - line
   - rect
   - oval
   - fill
   - text
   - copy/cut/paste
6. **Glyph and Palette**
   - glyph selection
   - palette selection/edit
   - eyedrop/sample semantics
7. **Layers**
   - create
   - select active
   - visibility
   - locking
   - ordering
   - merge
8. **Browse**
   - list images
   - select image
   - rename
   - duplicate
   - delete
   - reload
9. **History**
   - undo
   - redo
10. **Animation Authoring**
   - ordered frame sequence
   - explicit holds or timing
   - loop behavior
   - frame anchor and padding policy
   - document-derived playback preview

Everything in this tree belongs to Section 1. Source slicing, template/bundle
state, engine-family routing, and runtime injection belong to Section 2.

### 1.5 Canonical Owner Graph

The target owner graph is:

1. an image/session is created or loaded
2. the whole-sheet XP editor owns the image, layers, mode, and history
3. browse is a peer mode inside that same owner
4. source panel and frame navigation are views or overlays on that owner
5. save/export emit from that owner
6. bundle/runtime helpers observe or adapt that owner, but never become a parallel owner

No wrapper feature is allowed to replace this graph.

### 1.6 Current Section-1 Misalignment Ledger

The Step 2-7 deletion slices removed several earlier root-owner violations:
template-first startup, template-gated blank creation, legacy inspector fallback,
the deferred-browse placeholder state, raw-vs-XP source flipping,
viewport-hit-test drop targeting, duplicate frame-nav ownership, and the old
local history owner are no longer the current blockers. The Step 4 mirror-sync
owner (`FL-STEP4-01` / `FL-STEP4-06`) was also removed on `2026-04-16`; the
remaining live misalignments are below.

The audit below tracks the previously misaligned areas and whether they remain
open or are now resolved:

| Finding | Current evidence | Why this is misaligned |
|---------|------------------|------------------------|
| Wrapper views are now demoted into in-root drawers rather than peer sections | `web/workbench.html`, `web/workbench.js` | The standalone alpha/header peer shell was deleted on 2026-04-16, and source/frame/runtime/obs surfaces now open as toggleable drawers inside `#wholeSheetPanel` instead of living as separate top-level browser sections. RESOLVED. |
| Canonical manifest authoring now exists, but it is still JSON-first | `web/workbench.html:133-145`, `web/workbench.js:2196-2377`, `web/workbench.js:3278-3367`, `src/pipeline_v2/app.py:496-525`, `src/pipeline_v2/service.py:3831-3887` | The deleted source overlay owner was replaced with a manifest JSON draft editor, saved-manifest routes, and guide/region rendering on the source canvas. The remaining gap is ergonomic interactive slicer tooling; authoring is still a JSON-first wrapper flow. |
| Source panel now reloads canonical PNG/manifest without grid geometry | `web/workbench.js:2242-2305`, `web/workbench.js:3278-3367`, `web/workbench.js:4310-4332`, `src/pipeline_v2/app.py:496-525` | The source panel now reads `source_path` / `source_manifest` directly, reloads the PNG through `/api/workbench/source-image`, and can render manifest geometry before the PNG finishes loading. This Step 5 projection dependency is resolved. |
| Sprite-by-sprite source-to-frame drag coverage is now first-class in the official headed runner | `scripts/xp_fidelity_test/verifier_lib.mjs`, `scripts/xp_fidelity_test/run_source_to_grid_workflow_test.mjs`, `tests/fixtures/known_good/source_grid_multirow.png`, `PLAYWRIGHT_FAILURE_LOG.md` entries dated `2026-04-17` | The canonical runner now proves all currently visible source-box families through shipped UI actions only: manual single-box, auto-detected single-box, grouped row-select, and grouped column-select drags into `9A`. RESOLVED on `2026-04-17`. |
| Frame-nav multi-row selection and frame-slot deletion now behave as separate shipped interaction contracts | `web/workbench.html`, `web/workbench.js`, `scripts/xp_fidelity_test/run_m2d_action_proof_test.mjs`, `output/m2d_action_proof_multirow_v1/report.json` | `Clear Selected` remains the clear-content action, `Delete Frame` remains the semantic-slot removal action, and `shift+click` selection now persists across rows instead of collapsing back to one row. The official headed M2-D runner now proves cross-row clear/delete behavior through shipped UI actions only. RESOLVED on `2026-04-17` (`3dd7042`, `2ec2238`, `d689a14`). |
| Panel identity map and panel topology now exist in code, but public-parity proof is still open | `web/workbench.html`, `web/styles.css`, `web/workbench.js:7984-8099` | The current branch now exposes numbered/named panel badges (`8 source`, `9 grid`, `9A frame-nav`, `9B grid-panel`, `10 whole-sheet`, etc.) and a full clickable-ID overlay toggle (`hide IDs` / `Alt+I`). That closes the raw tagging gap that fueled the three-day refactor confusion, but it is still code-state until it is re-proved against the frozen public workflow grouping. |

These are architectural failures. They are not just missing buttons.

**AUDITOR FOUND GAP (2026-04-15):** The five ownership misalignments above are not the only Section 1 failures. The 2026-04-15 parallel audit found that parity contract items 2, 3, 4, 5, and 9 are also unimplemented or broken. These are feature gaps, not just ownership gaps. They must be tracked alongside the ownership items:

| Finding | Evidence | Why this violates the parity contract |
|---------|----------|---------------------------------------|
| Resize action completely missing | No Ctrl-r handler, no resize UI, no logic in `web/workbench.js` or `web/whole-sheet-init.js` | Parity item 2: resize is a first-class image action |
| Browse mode non-functional - Tab toggle not wired | `web/whole-sheet-init.js:1086-1091` renders a `BROWSE` button, but there is no mode state, no click binding, and no `Tab` handler in `web/whole-sheet-init.js:885-992` | Parity item 3: paint and browse are peer modes, Tab toggles them |
| Undo/redo surface is broken after the deletion pass | `web/whole-sheet-init.js:219-238`, `web/whole-sheet-init.js:896-901`, `web/workbench.js:5410-5509` | The whole-sheet UI still renders Undo/Redo controls and shortcuts, but `workbench.js` no longer supplies `onUndo`/`onRedo`, so Family 9 history has no live owner. |
| Apply mode keyboard shortcuts not bound | `applyGlyph`/`applyFg`/`applyBg` state exists; g/f/b handlers do not | Parity item 5: apply modes split glyph/fg/bg behavior |
| Draw tool set is still incomplete | `web/whole-sheet-init.js:16-20`, `web/whole-sheet-init.js:905-916`, `web/whole-sheet-init.js:965-992` | Cell/erase/eyedropper/line/rect/fill/select and clipboard shortcuts now exist, but Oval and Text are still absent, so the Family 5 draw-tool set and full keyboard map are incomplete. |
| Mouse-only input - touch and pen events absent | `web/whole-sheet-init.js` uses mousedown/mousemove/mouseup only | Parity item 9: pointer-device-agnostic interaction |
| Zoom / font-scale not implemented | No zoom control or font-scale handler in `web/whole-sheet-init.js` | Family 3 in Section 1.4: canvas navigation includes zoom |
| Grid control is only partially implemented | `web/whole-sheet-init.js:1241-1279` provides a sidebar toggle and step selector, but there is no Ctrl-g authority and no zoom/grid persistence contract | Family 3 in Section 1.4 requires grid control as a direct canvas-navigation behavior |
| Layer control is only partially implemented | `web/whole-sheet-init.js:1757-1850`, `web/workbench.js:3498-3505` | Click-based visibility/lock/reorder UI exists, but Ctrl-l / 1~9 / Ctrl-1~9 / Shift-1~9 / Ctrl-Shift-m / wheel authority is missing and lock state is not part of the root session save contract. |

These gaps require an explicit behavioral contract before any closure claim is
valid. The execution sequence for resolving them lives only in Unified Sequence
Of Actions.

### 1.6.1 State Checkpoint - 2026-04-26

The 2026-04-15 gap table above remains valid as historical audit context, but
some of those rows are no longer literally current code state.

What current code now does:

1. `web/whole-sheet-init.js` now ships a root-editor `Resize` action plus
   `Ctrl-r`.
2. `web/whole-sheet-init.js` now ships live `PAINT` / `BROWSE` mode toggling
   with `Tab`.
3. Oval and text tools are now wired into the whole-sheet editor surface.
4. Grid/zoom shortcuts and layer keyboard/wheel controls now exist in the root
   keymap.
5. `web/rexpaint-editor/canvas.js` now prefers Pointer Events when available,
   and whole-sheet session metadata now persists layer locks plus zoom/grid
   state through the Flask save/load contract.
6. The whole-sheet root now preserves cell state correctly for three Section 1
   parity cases that were regressed in the first slice:
   - selection delete preserves existing background colors while clearing glyphs
   - text-edit backspace restores the prior active-layer cell inside the current
     text session
   - layer-merge-down copies non-default source cells even when `glyph == 0`,
     so color-only/background-only cells survive the merge without letting
     untouched default blanks erase the target layer

Verification evidence:

- `python3 -m pytest tests/test_workbench_flow.py tests/test_base_path.py -q`
  passed on `2026-04-26` (`61 passed`)
- `tests/web/rexpaint-editor-canvas.test.js` passed through the VM-module
  runner on `2026-04-26` (`14 passed, 0 failed`)
- `node --test tests/web/whole-sheet-cell-ops.test.mjs` passed on
  `2026-04-26` (`3 tests`)

Closure update for `UQ-002` / `UQ-003` on `2026-04-27`:

1. The root-owner law is now satisfied for the shipped whole-sheet edit path:
   live undo/redo is owned in `web/whole-sheet-init.js`, wrapper layer controls
   delegate into the mounted root API, and ordinary wrapper renders no longer
   blanket-sync the root editor.
2. Root resize is no longer constrained by the wrapper frame-topology save law.
3. Headed shipped-UI Section 1 proof now exists for both the root-hosted and
   prefixed `/xpedit` surfaces.
4. The stale whole-sheet `Clear` failure was verifier contract drift. Current
   canon semantics remain: `Clear` is active-layer-only, while layered clearing
   belongs to `Cut`.
5. Hot-path proof for the whole-sheet root path is now present through the
   history-ownership tests plus same-day headed whole-sheet button, layer,
   clipboard, tools, transform, bulk-edit, and grid runs.

### 1.6.2 Current UQ-002 Hot-Path Contract - 2026-04-26

The remaining "super slow" feel is treated as part of `UQ-002`, not as a later
polish lane.

Current checkpoint state after the 2026-04-26 UQ-002 hot-path refactor cuts:

1. whole-sheet live undo/redo is now owned in `web/whole-sheet-init.js`.
   `web/workbench.js` may delegate UI commands and expose combined diagnostic
   history depths, but it must not reintroduce whole-sheet `onStrokeStart`,
   `onUndo`, or `onRedo` ownership.
2. ordinary whole-sheet cell edits now mark dirty frame-grid coordinates and
   refresh only matching frame tiles on stroke completion. Full
   `renderFrameGrid()` remains for structural wrapper flows, not ordinary root
   edit completion.
3. explicit/checkpoint saves still serialize full session payloads through
   `saveSessionState()`, but ordinary whole-sheet edit completion now only
   queues autosave intent for the idle autosave pump.
4. dirty frame-grid thumbnail projection is now coalesced through an idle
   secondary refresh queue instead of running synchronously from ordinary
   whole-sheet edit completion.

Current hot-path closure facts recorded against `UQ-002`:

1. Wrapper-owned undo/redo is deleted from the whole-sheet edit path, and live
   history ownership now resides in `whole-sheet-init.js`.
2. Ordinary root edits no longer trigger full `renderFrameGrid()` rebuilds;
   only the dirty/visible shipped projection surfaces refresh.
3. Session save/autosave is decoupled from ordinary edit completion, so normal
   drawing no longer immediately serializes the full live session payload.
4. Any remaining secondary projection or serialization work belongs outside the
   direct edit completion path.

Queue sequencing, proof order, and stop conditions for any remaining `UQ-002`
work live only in Unified Sequence Of Actions.

### 1.7 Section-1 Refactor Rule

Do not add a new owner while leaving the old owner alive.

The deletion-first order for Section 1 was:

1. remove template-first blank-image assumptions
2. promote whole-sheet image/session ownership to the root
3. make browse/new/save/export true image actions at that root
4. demote source and frame-nav into overlays/views on that root
5. only then preserve or rebuild wrapper features from Section 2

**AUDITOR FOUND GAP (2026-04-15):** These slices are NOT largely complete. The 2026-04-15 parallel audit found that the Section 1 parity alignment rate is 28% fully aligned, 44% partial, and 28% gap or missing. The ownership inversion is partially done (whole-sheet canvas exists) but the root owner contract (whole-sheet owns history/layers/mode, workbench.js is subordinate) is not met. Feature completeness (resize, browse, tools, shortcuts, touch) is also not met. The current state is a hybrid that passes structural syntax checks but does not deliver the behavioral contract. The current remaining sequence from this state is tracked in Unified Sequence Of Actions.

### 1.8 Section-1 Feature Behavioral Contract

This subsection defines the behavioral contract that Section 1 closure claims
must satisfy. Queue sequencing and implementation status live in Unified
Sequence Of Actions, not here.

#### 1.8.1 Root Document And Surface Contract

1. The authoritative in-memory editor document contains:
   - geometry: `gridCols`, `gridRows`, frame geometry, viewport position, zoom
   - image data: ordered layers plus per-layer visibility and lock state
   - editor state: active layer, current mode, current tool, draw glyph/colors,
     apply toggles, selection, clipboard, and undo/redo history
2. `whole-sheet-init.js` is the owner of that document. `workbench.js` may
   request commands and observe snapshots, but it may not directly mutate
   layers, history, mode, tool state, or panel visibility.
3. The whole-sheet panel is always present as the root editor surface. When no
   image is loaded, it shows an empty-state root surface and image actions. It
   must not disappear merely because no session is mounted.
4. Frame focus, source selection, bundle navigation, and preview helpers are
   overlays on this owner. They may pan/select within the root canvas, but they
   do not decide whether the editor exists.

#### 1.8.2 Image Action Contract

1. `New` is a root image action. It creates a blank document through the
   whole-sheet owner after an explicit geometry prompt. Section 2 templates may
   seed the initial layer set, but they do so by calling the same root command.
2. `Open` / `Import XP` are root image actions. They replace the active
   document in the same whole-sheet owner; they do not mount a second editor.
3. `Open` / `Import XP` must accept ordinary XP documents as root-editor
   documents even when they do not satisfy Section 2 template/runtime metadata
   conventions. Missing layer-0 metadata may block later wrapper export/runtime
   flows, but it may not block Section 1 open/edit/browse behavior itself.
4. `Resize` is a root image action. It opens a geometry dialog seeded from the
   current image size. Confirming resize:
   - applies one transaction to every layer
   - anchors preservation at top-left
   - fills new cells with transparent/blank cells when growing
   - crops right/bottom extents when shrinking
   - clips or clears selections outside the new bounds
   - recomputes frame/grid overlays derived from image geometry
5. If a wrapper/template flow requires template-compatible metadata and an
   opened XP lacks it, Section 2 may offer an explicit conversion/repair step
   after open. It may not silently mutate the document on browse open, and it
   may not redefine the root browse/open contract around template ownership.
6. Section 2 may warn that a resize breaks template/runtime expectations, but
   it may not block or own the resize behavior itself.
7. `Save` persists the current root document/session without download.
8. `Export XP` serializes the same root-document snapshot. If the document is
   dirty, export flushes save/autosave first, then exports from that snapshot.

#### 1.8.3 Mode Model: Paint And Browse

1. `PAINT` and `BROWSE` are peer modes inside the same whole-sheet owner.
2. `Tab` toggles between them. Clicking the mode buttons performs the same
   toggle.
3. `PAINT` exposes editing tools and allows canvas mutation.
4. `BROWSE` exposes the image list and image CRUD actions while keeping the
   whole-sheet canvas as the single preview/edit surface. Browse is not a
   second editor and not a separate workbench owner.
5. Browse mode supports list/select/open/rename/duplicate/delete/reload over
   the current image collection, regardless of whether that collection is
   backed by server sessions, local drafts, or file-picker imports.
6. The semantic meaning of browse-open is: load the chosen XP/root-editor
   document into the root whole-sheet owner. Whether the backing item is stored
   as a session, a local draft, or a plain XP file is an implementation detail,
   not a different editor model.
7. Template/workflow ownership is a Section 2 concern layered after browse-open.
   Browse must not require template selection merely to inspect or edit an XP
   document in the Section 1 editor.

#### 1.8.4 Apply, Tool, Selection, And Clipboard Contract

1. Apply channels are authoritative root-editor state. `g`, `f`, and `b`
   toggle glyph, foreground, and background application respectively.
2. `Shift-g`, `Shift-f`, and `Shift-b` solo the selected channel by turning it
   on and turning the other two off. Pressing the same solo key again while
   already solo restores all three channels.
3. The editor must never enter an all-off apply state. Attempting to disable
   the final active channel is a no-op.
4. The required tool set is:
   - cell
   - line
   - rect
   - oval
   - fill
   - text
   - eyedropper
   - erase
   - selection
5. Only one primary tool is active at a time. Required plain-key bindings are:
   `c`, `l`, `r`, `o`, `i`, `t`, plus additive browser-specific aliases `d`
   (eyedropper), `e` (erase), and `s` (selection).
6. Copy/cut/paste operate on a rectangular document selection, not on a frame
   tile abstraction. The clipboard preserves cells for every visible layer in
   the selected bounds, and paste commits as one transaction.
7. Tool switches do not implicitly destroy the current selection. Selection
   remains visible and authoritative until explicitly cleared, canceled, or
   invalidated by a geometry-changing document mutation.
8. `Delete` / `Backspace` clear the current selection on the active visible
   unlocked layer as one transaction.
9. `Cut` still operates on the visible-layer clipboard model: it captures the
   selection across visible layers, then clears the cut rectangle across the
   visible unlocked layers as one transaction.
10. `Esc` cancels in-progress line/rect/oval/text/paste interactions without
   emitting a history entry.
11. `Text` tool contract:
   - click sets the insertion anchor on the active unlocked layer
   - printable keys emit glyphs using current apply/color state
   - `Enter` moves to the next line from the anchor column
   - `Backspace` removes the previous typed cell inside the current text edit
   - `Esc` commits and exits text mode

#### 1.8.5 Keyboard Authority Map

The whole-sheet editor owns the following command map. Browser-default handlers
must be intercepted where necessary.

| Command family | Required keys |
|----------------|---------------|
| Image actions | `Ctrl-n` new, `Ctrl-o` open/import, `Ctrl-r` resize, `Ctrl-s` save, `Ctrl-Shift-s` export XP |
| Mode | `Tab` toggle paint/browse |
| Apply | `g` / `f` / `b` toggle, `Shift-g` / `Shift-f` / `Shift-b` solo |
| Draw tools | `c` cell, `l` line, `r` rect, `o` oval, `i` fill, `t` text, `d` eyedropper, `e` erase, `s` select |
| Selection / clipboard | `Ctrl-c`, `Ctrl-x`, `Ctrl-v`, `Delete`, `Backspace`, `Esc`, `[` rotate CCW, `]` rotate CW |
| History | `Ctrl-z` undo, `Ctrl-y` redo |
| Layers | `Ctrl-l` add, `1-9` select active, `Ctrl-1-9` toggle visibility, `Shift-1-9` toggle lock, `Ctrl-Shift-m` merge active downward, `Alt` + mouse wheel over canvas cycles active layer |
| Viewport | `Ctrl-g` grid toggle, `<` / `>` and `Ctrl-PgUp` / `Ctrl-PgDn` zoom/font-scale, `Space` + drag pan |

Intentional hosted-surface divergence from the embedded verbatim REXPaint manual:
plain wheel scrolling is not used for layer cycling here. The shipped browser
workbench requires `Alt` + wheel because plain two-finger / wheel scrolling was
logged as a practical UX/safety regression in `PLAYWRIGHT_FAILURE_LOG.md` and
corrected in the `2026-04-26` product slice.

#### 1.8.6 Layer And History Contract

1. Layers are owned by the root document, not by workbench mirror state.
2. Layer add/delete/reorder/visibility/lock/merge are document mutations and
   therefore produce history transactions.
3. `Ctrl-l` creates a transparent layer matching current image geometry
   immediately above the active layer and makes it active.
4. Hidden layers remain part of the document and export payload; hiding affects
   viewport rendering and clipboard capture, not document existence.
5. Locked layers reject all mutating commands: draw, fill, text, paste,
   selection transforms, and merge targets.
6. Lock state, visibility, ordering, and layer names are part of session/draft
   persistence even if `.xp` export cannot encode every editor-only flag.
7. Layer 0 is an ordinary document layer in principle. It is inspectable and
   editable under the same root-editor law as any other layer.
8. Section 2 may impose stricter defaults for template-owned sessions when
   layer 0 carries pipeline/runtime metadata: hide it by default, lock it by
   default, and warn on unlock/edit. Those defaults are wrapper policy, not a
   redefinition of layer 0 as a non-editable or hidden-only root concept.
9. Raw XP / non-template sessions should expose layer 0 as a normal layer by
   default. Template-owned sessions may start with different visibility/lock
   defaults, but the layer must remain discoverable and intentionally
   inspectable.
7. Undo/redo history is owned by the whole-sheet editor. Each of these is one
   history transaction:
   - one drag stroke
   - one fill
   - one text-edit session commit
   - one paste/cut/delete/transform command
   - one resize
   - one layer add/delete/reorder/visibility/lock/merge command
10. Viewport pan/zoom, active tool, browse selection, and other non-document UI
   state are not history transactions.
11. Each open image keeps its own undo journal. Switching images in browse mode
   swaps journals with the active document.

#### 1.8.6a Session Kind And Metadata Compatibility Contract

This subsection is the implementation contract for landing the browse/layer-0
decision without mixing Section 1 editor truth and Section 2 template/runtime
truth.

1. Persisted workbench sessions must distinguish document kind from template
   ownership. Minimum required fields:
   - `session_kind`: one of `root_blank`, `raw_xp`, `pipeline_job`,
     `template_owned`
   - `metadata_status`: one of `valid`, `missing`, `invalid`, `generated`
2. `template_set_key` and `action_key` remain the only authoritative markers of
   template ownership. Non-empty `template_set_key` means the session is
   Section 2/template-owned. Empty `template_set_key` means it is a generic
   Section 1 document regardless of `family` label.
3. `family` remains compatibility/display data only. It must not decide whether
   an XP can be opened in the root editor.
4. `Open` / `Import XP` must accept syntactically valid XP files with one or
   more layers. A single-base-layer XP is a valid Section 1 document even if it
   is not sufficient for current Section 2 template/runtime workflows.
5. Raw XP ingest must stop treating missing or invalid layer-0 template
   metadata as a fatal open error. Instead:
   - parse all available layers into the root document
   - preserve the original layer count and cells
   - set `metadata_status = valid` when template/runtime metadata parses cleanly
   - set `metadata_status = missing` when the expected metadata is absent
   - set `metadata_status = invalid` when metadata is present but malformed
6. Geometry for raw-XP open must come from the XP itself when template metadata
   is missing or invalid. Section 2 geometry derivation from layer-0 metadata
   remains a later wrapper/runtime concern, not an open precondition.
7. `Save`, `load-session`, browse summaries, and public session payloads must
   round-trip `session_kind` and `metadata_status` so the browser can apply the
   correct layer-0 defaults without guessing from `family`.
8. Layer-0 defaults must derive from session kind:
   - `raw_xp`, `root_blank`, `pipeline_job`: layer 0 visible and editable by
     default
   - `template_owned`: layer 0 may start hidden and locked by default, but it
     must remain discoverable and intentionally inspectable
9. Generic `Export XP` remains a Section 1 operation and must work for any
   session kind by serializing the current root document/layer set. It must not
   silently inject or rewrite template metadata for raw XP documents.
10. Template/bundle export and runtime payload endpoints are where metadata
    compatibility is enforced. For sessions with `metadata_status != valid`
    where template/runtime metadata is required, those endpoints must fail with
    an explicit repair/conversion-needed error instead of rewriting the
    document silently.
11. Converting a raw XP into a template-compatible session must be an explicit
    Section 2 action. That action may inject/repair layer-0 metadata, update
    `metadata_status` to `generated`, and switch the session into
    `template_owned`, but browse-open itself may not do this implicitly.
12. Minimum backend proof required before UI work:
    - raw one-layer XP opens successfully
    - raw multi-layer XP with no valid metadata opens successfully
    - save/load/browse preserve `session_kind` and `metadata_status`
    - generic export preserves raw XP layers without template injection
    - template/runtime endpoints refuse incompatible metadata with explicit
      repair-needed errors

#### 1.8.7 Pointer, Pan, Zoom, And Grid Contract

1. Pointer input follows Section 1.9.1 exactly: Pointer Events are the only
   authoritative input model for canvas interaction.
2. One active pointer drives the current tool. Two active pointers are reserved
   for viewport pan/zoom and must never paint.
3. The canvas root owns `touch-action` and must prevent browser gesture capture
   on the active editing surface while tool input is active.
4. Mouse/pen panning uses `Space` + drag. Touch panning/zooming uses the
   two-pointer gesture path from Section 1.9.1.
5. Zoom changes viewport font scale only; it never changes XP cell geometry or
   export data. Required discrete zoom levels are `50%`, `75%`, `100%`,
   `150%`, `200%`, `300%`, and `400%`.
6. Grid display is viewport decoration, not document data. `Ctrl-g` toggles
   it. Grid spacing may switch between frame-aligned and cell-step modes, but
   grid lines must remain cell-aligned under pan, resize, and zoom.
7. Zoom level, pan offset, and grid visibility are editor-session state. They
   persist in drafts/sessions when possible, but never alter `.xp` export.

### 1.9 Research Requirements And Decisions

This subsection folds the former global research section into Section 1. The
relevant research areas for the root editor are:

1. mobile pointer model
2. browser/mobile persistence
3. small-screen editor layout
4. comparative editor behavior

These are design decisions for the refactor, not proof that the current code
already behaves this way.

#### 1.9.1 Touch / Mobile Interaction Contract

Evidence:

- MDN Pointer Events says pointer events provide a single DOM event model for
  mouse, pen, and touch, and expose `pointerType` for device-specific handling.
- MDN `touch-action` says the browser will otherwise take over panning/pinch
  gestures, fire `pointercancel`, and that custom-gesture intent should be
  declared on the top-level interactive element before handlers run.
- MDN pinch-zoom guidance shows two-pointer gesture detection via cached pointer
  events and explicit pinch-distance tracking.
- `xero/text0wnz` documents mouse/touch drawing support and explicit touch
  gesture control in a browser-first ASCII editor.

Decision (inference from sources):

1. The whole-sheet canvas remains the single mobile editing surface.
2. All editor interaction moves to Pointer Events. Do not keep a separate
   mouse-only path as the authoritative editor path.
3. Single-pointer contact on the canvas is tool input. Two active pointers are
   reserved for viewport pan/zoom only and must never paint.
4. The canvas root gets explicit `touch-action` ownership. Final implementation
   should use `touch-action: none` on the editor canvas while paint/select tools
   are active, with browser scrolling left enabled only on surrounding chrome.
5. Hover-only affordances are not acceptable as the sole UX. Any hover preview
   must have a touch equivalent: tap-hold inspect, explicit selection handles,
   or a visible status strip.
6. Context actions on touch use an explicit selection toolbar first. Long-press
   can open the same menu, but long-press is an accelerator, not the only path.
7. Two-finger scroll is viewport pan. Two active pointers on the canvas pan the
   viewport; they never paint. The gesture must be available as the primary mobile
   viewport navigation method. Scroll affordance chrome must not assume users
   will discover the gesture — any visible scroll controls must be non-blocking:
   translucent overlays or controls positioned adjacent to the whole-sheet editor
   zoom bar at the top, not opaque persistent sidebars.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures
- https://github.com/xero/text0wnz

#### 1.9.2 Browser Persistence Contract

Evidence:

- MDN File System API says picker-based file access is secure-context only and
  exposes `showOpenFilePicker()` / `showSaveFilePicker()`.
- MDN says OPFS is private to the origin, not visible to the user, optimized
  for performance, and supports synchronous worker access.
- MDN install-prompt guidance uses `beforeinstallprompt` and `appinstalled` as
  the browser-managed install lifecycle hooks.
- `xero/text0wnz` uses local storage plus IndexedDB auto-save/restore and also
  documents platform-specific open flows for desktop, Android share sheet, and
  iPad/iOS file picker.
- `ASCII_Art_Paint` is explicitly offline-in-browser and TXT-file oriented.
- `ASCIIFlow` is client-side only, which is useful as a low-friction baseline
  but insufficient for multi-layer XP sessions and undo/history durability.

Decision (inference from sources):

1. Persistence is three-tier:
   - Tier A: always-on draft persistence for the active image and undo history.
   - Tier B: explicit user-facing import/open/save/export.
   - Tier C: optional PWA install/offline shell.
2. Tier A uses browser-local storage, with OPFS and/or IndexedDB for drafts and
   undo journals. OPFS is for internal durability, not for user-visible export.
3. Tier B prefers file pickers when available in secure contexts. When picker
   APIs are unavailable, the fallback is import via file input plus export via
   Blob download/share flows.
4. The editor must not require installation to work. PWA install is optional
   acceleration only, surfaced only after `beforeinstallprompt`.
5. Mobile persistence cannot assume desktop-class "save back to same file".
   Final mobile UX must always offer an explicit export/share path.
6. `Continue Draft` on the mobile first screen is a deliberate product entry,
   not merely the existing opportunistic restore banner. The workbench already
   has IndexedDB draft persistence and latest-draft restore plumbing; UQ-013
   must decide the mobile draft-discovery UX, including whether the first screen
   exposes only the latest draft or a small recent-drafts chooser.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt
- https://github.com/xero/text0wnz
- https://github.com/Kirilllive/ASCII_Art_Paint
- https://github.com/lewish/asciiflow

#### 1.9.3 Small-Screen Layout Contract

Evidence:

- REXPaint keeps the image/canvas as the primary workflow and treats browse/file
  operations as image-level actions, not as the main surface.
- `xero/text0wnz` keeps browser-native file handling, zoom, grid, and
  touch-capable drawing on one primary canvas experience.
- `ASCII_Art_Paint` exposes explicit hand/scroll, brush, fill, and selection
  shortcuts and keeps a simple editor-first layout.

Decision (inference from sources):

1. On narrow screens the whole-sheet canvas stays primary and visible. Do not
   preserve the current desktop two-column panel layout as the mobile baseline.
2. Layers, frame navigation, source helpers, and file/browse actions become
   drawers, sheets, or segmented overlays that can be summoned over the canvas.
3. Only one dense support panel may be expanded at a time on mobile:
   `layers`, `frames`, `source`, or `browse/files`.
4. The default small-screen chrome is:
   - top bar: file/new/save/export + mode toggle
   - center: canvas
   - bottom bar: tool switch + current layer + frame/location status
   - drawers/sheets: source helpers, frame nav, browse, layer management
5. The frame-navigation view should become a compact logical strip/filmstrip on
   mobile, not a second full grid competing with the canvas for space.
6. `Show IDs` / frame labels are off by default on every viewport, including
   iPad/mobile. They may exist as an explicit debug/navigation toggle, but the
   default editing surface must show the sheet, not overlaid cell/frame IDs.
7. Mobile must expose a clear `Open Workbench` mode before any dense authoring
   dashboard. The iPad upload helper proving drag/drop, picker, and URL intake
   does not by itself make the product usable if the next screen is the current
   multi-panel workbench menu.
8. On iPad-sized screens, the full workbench editor may prefer landscape
   orientation for the canvas/tool layout, but orientation cannot be a hard gate
   for opening an XP. Portrait may show a compact open/import/continue sheet and
   a rotate hint after the file is loaded.
9. The mobile first screen is task-rooted: `Open XP`, `Continue Draft`,
   `New From Template`, `Export/Share`, and a clearly secondary
   `Advanced Workbench` entry. ActorVisualProfile draft controls, TERM++ native
   controls, verification command templates, recorder controls, and source/debug
   panels are not first-screen mobile controls.
10. Mobile usability precedes broad workbench pruning. UQ-013 may keep the
    existing desktop workbench available as a fallback/escape hatch, but the
    default mobile route must open into a responsive landscape-oriented editor
    shell rather than the current dense dashboard.
11. Source authoring is not junk-drawer advanced UI. On mobile it belongs in the
    named `source` drawer from item 3 above, while low-level source-debug output
    may stay behind Advanced.
12. Viewport scroll controls must be translucent and/or positioned adjacent to
    the whole-sheet editor zoom bar at the top of the editor. Persistent opaque
    scroll bars or directional buttons must not occlude canvas content. Two-finger
    pan is the primary mobile viewport scroll gesture per §1.9.1:7; visible scroll
    chrome is a secondary affordance only and must not compete with the canvas
    for vertical space.
13. `Export/Share` is not proven by server-side XP export alone. Mobile proof
    must distinguish: generated XP path, browser download behavior, and native
    share/download affordance where the platform exposes one. iPad closure must
    show the user can actually get the exported XP out of the mobile browser.
14. Desktop/Advanced fallback surfaces are allowed, but they are not mobile
    parity unless separately proven in mobile mode. ActorVisualProfile draft
    controls, Verification, TERM++ native launch, Recorder, and hidden/advanced
    Skin Dock controls must be documented as `Advanced/Desktop fallback` until
    dedicated mobile proof exists.

Sources:

- https://www.gridsagegames.com/rexpaint/features.html
- https://github.com/xero/text0wnz
- https://github.com/Kirilllive/ASCII_Art_Paint

#### 1.9.4 Comparative Editor Decisions

Evidence:

- REXPaint advertises layers, hover preview, browse, and image-first control.
- Durdraw documents mouse input, selection, undo/redo, frame-based animation,
  configurable undo size, and export paths.
- ASCIIFlow is a client-side-only ASCII diagram editor.
- `ASCII_Art_Paint` combines a graphic editor with bitmap-to-text conversion and
  uses plain TXT save/load compatibility.
- `xero/text0wnz` demonstrates a browser-first, offline-first ASCII editor with
  touch, IndexedDB persistence, and platform-specific open flows.

Decision (inference from sources):

- Borrow from REXPaint:
  image-first ownership, intrinsic layers, browse as a peer mode, and
  `New` / `Save` / `Export` as image actions.
- Borrow from Durdraw:
  strong undo/redo expectations, explicit selection workflows, frame/animation
  mental model, and mouse-assisted editing.
- Borrow from `xero/text0wnz`:
  offline-first browser durability, touch-capable tooling, and multi-platform
  open/install behavior.
- Use `ASCII_Art_Paint` as source-helper inspiration only:
  bitmap-to-text conversion and simple built-in text affordances are useful,
  but its TXT-first persistence model must not replace XP-root image ownership.
- Reject ASCIIFlow as the editor baseline:
  it is useful as proof that low-friction client-side drawing works, but it is
  too diagram-centric and too shallow for layer/history/browse/runtime needs.
- Reject terminal-era menu/chord UX as the mobile baseline:
  Durdraw is valuable for editor behavior, but Esc-heavy terminal interaction is
  not the touch/browser contract.

Sources:

- https://www.gridsagegames.com/rexpaint/features.html
- https://github.com/cmang/durdraw
- https://github.com/lewish/asciiflow
- https://github.com/Kirilllive/ASCII_Art_Paint
- https://github.com/xero/text0wnz

---

### 1.x - Section 1 Performance And Architecture Audit Status (2026-04-27)

All six perf/architecture audit items (S1-PERF-001 through S1-PERF-004,
S1-ARCH-001, S1-ARCH-002) are PASS with commit SHAs and timed evidence.
Full details, verification notes, and benchmark measurements live in
`PLAYWRIGHT_FAILURE_LOG.md` under the `Section 1 Performance And Architecture
Audit` heading dated `2026-04-27`. They no longer leave unresolved Section 1
blockers in `1.6.1` and `1.6.2` for the current worktree state.

---

## Section 2 - Asciicker Engine Sprite Wrapper Spec

The Asciicker runtime now resolves character sprites through a canonical
`skin_family` axis plus presentation state and appearance bits. The final asset
filenames still follow `{family}-{AHSW}.xp`, where the suffix encodes equipment
state, but prefix selection is no longer the only family concept in the system:
main-game `engine/game.cpp` now derives those prefixes from `SkinFamilyDefinition`
tables. Base families are currently `human` and `green`; on-foot prefixes are
`player` / `plydie` / `attack` and `player-green` / `plydie-green` /
`attack-green`, while mounted/bee-related prefixes such as `wolfie`, `wolack`,
and `bigbee` still live on the human side with fallback behavior from green.

Section 2 defines the target authoring pipeline contract that is supposed to
produce those files from source art and get them into the runtime for proof.
The live implementation is still partial and is audited later in this section.
The user-facing workflow
shape stays familiar: upload source art, slice it, drag or adjust mappings,
materialize the result into the root XP editor, validate it, and then compile
or inject runtime-facing output. What changes is the authoring paradigm. The
old template-first wording is deleted from the canonical model and replaced by
bundle-sprite authoring terms derived from the Y9-2 appearance bundle system:

- `bundle blueprint`
- `presentation target`
- `source manifest`
- `materialized XP`
- `compile bundle`

The goal is a repeatable, validated path from raw source art to a
runtime-proven bundle contribution - but Section 2 is only ever a set of tools
layered on top of the root XP editor (Section 1). It helps; it does not own.

This section defines the bundle-blueprint, source-manifest, presentation-target,
and runtime-wrapper behavior layered on top of Section 1.

The asset pipeline is the part of the project responsible for taking raw sprite artwork - character animations like "wolfie" and "wolack" - and converting them into the engine's runtime format. The intended flow is: an artist authors an XP (experience pack) by feeding it source sprite sheets, the pipeline slices and maps those sheets into per-action, per-angle frames, runs them through a series of structural quality gates (geometry density, non-empty content checks, ap handoff population), and exports a final bundle the game engine can load. A local web-based workbench server is the primary UI for this authoring loop.

From the launcher's perspective, this would have appeared as a top-level menu option - [3] ASSET PIPELINE - giving you three choices: launch the workbench server and open its URL in a browser, check pipeline server health and reachability, and configure the server path and port. The idea is that a content creator could sit down, run the launcher, start the workbench, drag in new sprites, see them validated, and export them into the game without touching code. The workbench also connects back into the game's Skin Dock and TERM++ sandbox for runtime observation of the converted result.

In practice, the pipeline is still gated from claiming more than it can prove.
The node slot `[3]` remains reserved until the launcher path, export gates, and
visual/runtime proof all agree. The refactor has already added normalized
prefix/family metadata for mounted rows such as `wolfie` and `wolack`, but the
spec must not treat that as closure. The remaining question is not "which
templates exist"; it is whether one truthful bundle-authoring surface can take
source art to a compiled bundle contribution without mixed ownership. The
spec's position is still clear: do not surface the launcher option as shipped
capability until the whole wrapper path is proven.

The older questionary template wizard is no longer the canonical Section 2
shape. The relevant bridge today is the Y9-2 bundle-wizard request-artifact
flow plus the workbench browser surface in this repo. Both are still partial.
Neither is allowed to become a parallel long-term owner. The replacement
direction is fixed by §2.3.0 and §2.10: one shared bundle-authoring contract,
multiple thin clients.

**Status correction - 2026-06-09:** the Y9-2 replacement path is still partial
and implemented-unproven, but its latest `origin/main` no longer matches the
older `appearance_bundle.py` / `render_plans.json` wording below. The fetched
Y9-2 branch has deleted legacy render-plan owners in commit `ea54ffb86` and
deleted `engine/bundle_runtime.cpp` in commit `6fe089012`; its live replacement
surface is now the ActorVisualProfile generated-table path
(`scripts/compile_actor_visual_profiles.py`,
`engine/actor_visual_profile_table.generated.h`,
`engine/actor_visual_profile_runtime.h`). That production compiler explicitly
derives rows from server reachability and upstream sprite resolver/load
semantics; authored pipeline-v3 `config/actor_visual_profiles/*.json` files do
not participate in that track. Therefore the current misalignment is not
"pipeline-v3 behind a completed Y9-2 refactor." It is: pipeline-v3 still ships
a legacy `BundleSession` workbench authoring UX, while Y9-2 has a partial
ActorVisualProfile replacement path whose authoring seam is not yet shared with
pipeline-v3.

Section 2 is not allowed to own the image/session root. It may only:

- help ingest source art
- help author and validate source manifests
- help materialize source regions into presentation-target XP documents
- validate exported XP and compiled bundle contributions against engine expectations
- inject/test authored XP or bundle payloads in runtime surfaces

### 2.1 Engine Truth: `skin_family`, Legacy Combo Sheets, Direct Overlays, And AHSW Naming

> **⚠ DELETION TARGET / HISTORICAL REFERENCE (2026-06-09):** This section
> documents the old Y9-2 runtime visual-resolution architecture —
> selector-driven bundles, family fallback chains, `LookupPresentationSprite()`,
> combo-sheet matrices, `bundle_layer_resolver`, and
> `ActorAppearanceBundleCache`. Those owners were deletion targets under
> §2.15. In the fetched Y9-2 `origin/main` state, several of the older
> `RenderPlanTable` transition owners have themselves been superseded by the
> ActorVisualProfile generated-table path. Treat this subsection as historical
> context and compatibility background, not the current target architecture.

The main game no longer treats player appearance as a presentation-state-only
lookup. The canonical runtime dispatch is now:

- `skin_family`
- `presentation_state`
- `appearance_bits`

That dispatch now spans two parallel asset owners in `asciicker-Y9-2`:

1. the legacy combo-sheet matrices (`SpriteGrid[2][A][H][S][W]`)
2. the direct presentation-overlay registry added for FL-903

Both are live today. Pipeline-v2 must not describe the engine as if the direct
overlay path replaced the legacy combo-sheet path entirely; the engine still
loads and warms both.

The family axis is wire-visible and compile-time bounded in
`server/network.h`:

- `SKIN_FAMILY::HUMAN = 0`
- `SKIN_FAMILY::GREEN = 1`
- `SKIN_FAMILY::SIZE`

`SIZE` is the only compile-time bound changed when adding a family, and it is
guarded to fit the join packet field. The current join-time family assignment
is server-owned in `server/server_tick.cpp::SvrResolveSkinFamilyAndName()`.
Today:

- `green:` name prefixes map to `SKIN_FAMILY::GREEN`
- `[green]` name prefixes map to `SKIN_FAMILY::GREEN`
- there is no client-side "choose skin family" packet yet

So adding a new family is not a template-only change. It requires server join
resolution, engine family registration, and assets.

The engine carries base-family identity through `SkinFamilyDefinition` entries
in `engine/game.cpp`. Each family entry now owns:

- debug family name
- per-motion filename prefixes
- legacy `SpriteGrid*` pointers for the combo-sheet path
- `fallback_family`

`fallback_family` is now part of the runtime contract. `LookupPresentationSprite()`
walks the family fallback chain when a direct overlay is missing. This is what
makes partial families viable: `green` can inherit missing overlays from
`human` without pretending that every strip/overlay exists independently.

The engine-facing filename convention for animated equipment-bearing strips is
still `{family}-{AHSW}.xp`, where:

- `A` = armor state index
- `H` = helmet state index
- `S` = shield state index
- `W` = weapon state index

Critical clarification from the engine re-audit:

1. The 4-character suffix is an equipment-state index, not animation frames.
2. Directions and animation frames live inside the XP file and its layer-0
   metadata, not in the filename suffix.
3. The canonical preview file for an animated family/prefix remains the
   representative action XP such as `{family}-0001.xp`; the direct overlay
   atlas files (`*-body.xp`, `*-armor-gold.xp`, etc.) do not replace that
   preview-owner contract.

The current base-family mapping in the main game is:

- `human`
  - on-foot idle/walk prefix: `player`
  - on-foot fall/death prefix: `plydie`
  - on-foot attack prefix: `attack`
  - mounted / bee-related prefixes: `wolfie`, `wolack`, `bigbee`
- `green`
  - on-foot idle/walk prefix: `player-green`
  - on-foot fall/death prefix: `plydie-green`
  - on-foot attack prefix: `attack-green`
  - mounted/bee strips are not independently authored yet; missing strips and
    overlays fall back to `human`

Two engine loading paths now matter for every family:

1. **Legacy combo-sheet path** - `LoadSpriteGridFiles()`
   - loads `{prefix}-AHSW.xp` matrices for supported equipment-state
     combinations
2. **Direct overlay path** - `LoadDirectPresentationAssetsForFamily()`
   - loads `*-body.xp`
   - loads slot overlays such as `*-armor-regular.xp`, `*-armor-gold.xp`,
     `*-helmet-dark.xp`, and `*-weapon-sword.xp`
   - registers them in the direct presentation registry

`WarmComposedPresentationCache()` then precomposes
`[kind][family][armor][helmet][shield][weapon]` combinations across the active
family set. Family count therefore scales cache warm time and memory.

Current engine-side evidence:

- `server/network.h`
- `server/server_tick.cpp`
- main-game `engine/game.cpp` family tables, direct-presentation loader,
  fallback lookup, and warm-cache code
- `scripts/pipeline/generate_presentation_overlays.py`

### 2.2 Engine Browser Schema, Wearable Schema, And The Active Workbench Gap

For launcher/browser purposes, sprites now group by engine-derived filename
prefix, not by this repo's old flat template list. The engine/browser-relevant
animated prefix groups are:

| Prefix Group | Base `skin_family` | Runtime role | Canonical preview file | Current pipeline-v2 state |
|-------------|--------------------|--------------|------------------------|---------------------------|
| `player` | `human` | on-foot idle/walk | `player-0001.xp` | partially authorable; backend execution still carries legacy `family` compatibility |
| `attack` | `human` | on-foot attack | `attack-0001.xp` | partially authorable; backend execution still carries legacy `family` compatibility |
| `plydie` | `human` | on-foot fall/death | `plydie-0001.xp` | partially authorable; backend execution still carries legacy `family` compatibility |
| `player-green` | `green` | on-foot idle/walk | `player-green-0001.xp` | runtime/proof-only |
| `attack-green` | `green` | on-foot attack | `attack-green-0001.xp` | runtime/proof-only |
| `plydie-green` | `green` | on-foot fall/death | `plydie-green-0001.xp` | runtime/proof-only |
| `wolfie` | `human` (green falls back here today) | mounted idle/walk | `wolfie-0001.xp` | engine-real; **authorable: true** — UQ-007 identity CLOSED, mounted builder landed. Proof-blocked on `mounted_authoring_e2e`, latest Y9-2 ActorVisualProfile runtime acceptance, and no legacy fallback in the claimed runtime path. Old resolver proving mounted rows is not acceptable evidence. |
| `wolack` | `human` (green falls back here today) | mounted attack | `wolack-0001.xp` | engine-real; **authorable: true** — UQ-007 identity CLOSED, mounted builder landed. Proof-blocked on `mounted_authoring_e2e`, latest Y9-2 ActorVisualProfile runtime acceptance, and no legacy fallback in the claimed runtime path. Old resolver proving mounted rows is not acceptable evidence. |
| `bigbee` | `human` | bee-mount / NPC path | `bigbee-0001.xp` | runtime-real, not authorable |

`player-nude.xp` remains a special runtime file, but it is not the canonical
animated preview representative for browser grouping.

There is now a second engine-relevant schema layered over those prefixes:

1. **Wearable slot schema**
   - the item wire format encodes wearable slot in the variant nibble
   - current authoritative slots are armor, helmet, and shield
2. **Wearable style schema**
   - the item wire format encodes wearable visual style in the style nibble
   - current authoritative styles are default, gold, and dark
3. **Presentation registry schema**
   - body overlays are looked up by `{family, kind, slot, variant}`
   - world/inventory item art is looked up by `{proto_kind, visual_style}`

Pipeline-v2 therefore has two related but distinct schema obligations:

1. action/prefix authoring contracts for exported character strips
2. slot/style contracts for direct overlays and wearable/item presentation

Current mismatch:

1. The engine/browser canon has both a base `skin_family` axis and a generalized
   wearable overlay schema.
2. The current branch's `config/template_registry.json` is now normalized and
   mounted-aware: it exposes explicit `filename_prefix` / `skin_family` /
   `preview_xp` metadata plus mounted/deferred prefix state.
3. The remaining split is now narrower than the original backend gate problem:
   runners, the browser, and template-driven backend bundle/runtime/export
   paths consume the normalized contract, but classic/runtime override-name
   generation now derives from registry `prefix_catalog.ahsw_range`; the former hardcoded
   `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`.
   The `preview_xp -> l0_ref` fallback in `_resolve_preview_xp_fields()` was
   fail-closed: the normalizer raises ValueError on missing `preview_xp` instead
   of silently falling back to `l0_ref`. Registry load/fetch errors are now
   operator-visible (503 status in API, degraded-state warning in browser UI)
   rather than silently caching empty truth.
4. There is still no wearable/item template surface in pipeline-v2, so the
   current workbench can only author full character strips, not standalone
   wearable or item sprites.
5. Current priority remains base skin authoring. Wearable authoring workflow /
   template design is future work and must not interrupt closure of the current
   on-foot skin-authoring surface plus its canonical from-scratch acceptance
   proof.

Current evidence:

- `config/template_registry.json`
- `src/pipeline_v2/app.py` `GET /api/workbench/templates`
- `src/pipeline_v2/service.py` backend bundle/runtime/export gates
- `web/workbench.js::getEnabledActions()`
- `scripts/xp_fidelity_test/bundle_contract.mjs`
- `web/termpp_skin_lab.js` runtime override path

This remains a wrapper/backend gap. It is not a justification for letting the
wrapper own the editor root.

### 2.3 Wrapper Layers

Section 2 wrapper behavior has four layers:

1. **Source-wrapper layer**
   - upload PNG or load source art
   - mark sprite regions, cuts, and selections
   - optionally populate grid/session state from source
2. **Bundle/presentation wrapper layer**
   - map authored XP into bundle blueprint / presentation-target wrappers
   - enforce runtime-prefix dimensions, layer counts, and metadata contracts
3. **Runtime injection layer**
   - emit web payloads or native sandbox staging
   - write override filenames
4. **Proof/test layer**
   - Skin Dock / webbuild preview
   - native TERM++ sandbox launch
   - failure-log-aware visual/runtime gates

None of these layers may replace the Section 1 owner graph.

**STEP 5 DESIGN OUTPUT (2026-04-15):** The source-wrapper layer is now defined by the four contracts below. These decisions unblock Step 6 and Step 7, but they do not by themselves implement either step.

#### 2.3.0 Deletion-First Cutover Surface And Replacement Model

Section 2 may not add a new bundle-authoring owner while the old template/family
owners remain authoritative. The cutover is deletion-first and the exact
deletion surface is:

1. **Delete backend live authority from legacy template/family execution paths**
   - delete `family` as an authoritative runtime/export input
   - delete `ENABLED_FAMILIES` as a live gating source
   - delete any bundle/export/runtime branch that still resolves authoring intent
     through old template-family aliases after the normalized registry exists
   - replacement: one normalized authoring contract keyed by
     `filename_prefix`, `skin_family`, `bundle_blueprint`, and
     `presentation_target`
2. **Delete frontend template-first product wording**
   - delete "template set" / "family + action template" as the user-facing
     paradigm for Section 2
   - delete any UI state whose meaning depends on the user thinking they are
     selecting a standalone template rather than contributing rows to a bundle
   - replacement: one user-facing selection model of
     `bundle blueprint -> presentation target -> source manifest -> materialized XP -> compile bundle`
3. **Delete session-local source-layout authority**
   - delete `source_boxes`, `source_cuts_v`, and `source_cuts_h` as
     authoritative saved state for combined-sheet slicing
   - replacement: one canonical sidecar
     `<source>.asciicker-source.json`, with session state only mirroring it
4. **Delete false or planned gateway claims**
   - delete spec, MCP, and docs claims that a route or tool exists when the
     live backend does not expose it
   - replacement: one truthful headless surface, shared by browser, CLI, MCP,
     launcher, and CI
5. **Delete parallel Y9-2 ownership after the shared contract exists**
   - Y9-2 local wizard/subprocess code may remain as a temporary client, but it
     may not become the long-term owner of registration/compile behavior
   - replacement: Y9-2 launcher, MCP, and manual terminal flows become thin
     clients over the same pipeline-v3 bundle-authoring surface

The workflow shape is intentionally preserved. A user still uploads a sheet,
slices it, drags mappings, inspects the result, and exports. What changes is
the interpretation of that work: the user is no longer "choosing templates";
they are authoring bundle-ready presentation targets inside a blueprint.

#### 2.3.1 Source Sprite Sheet Layout Contract

1. Section 2 accepts exactly two source-layout modes:
   - `uniform_grid`: the only valid naked-PNG mode
   - `explicit_regions`: manifest-required mode for ad hoc or multi-action sheets
2. `uniform_grid` means:
   - one source PNG describes one logical sprite sheet
   - rows top-to-bottom map to angle indices `0..angles-1`
   - columns left-to-right map to frame slots
   - when `source_projs == 2`, columns are grouped as `[all proj0 frames][all proj1 frames]`, matching the current `run_pipeline()` arithmetic and output packing
   - when `source_projs == 1` but target output needs two projections, projection 1 is a derived mirror of projection 0 rather than a second independently-authored source track
3. A naked PNG may use `uniform_grid` only if the declared layout is evenly divisible by the target slot count (`image_w % (frames * source_projs) == 0`, `image_h % angles == 0`) and every required slot is present. If not, the sheet must be represented as `explicit_regions`.
4. `explicit_regions` is the canonical answer for irregular atlases, multi-action sheets, or any source where angle/frame/projection boundaries are not already encoded by a uniform grid. No implicit geometry guess is authoritative in this mode; the manifest must enumerate the regions explicitly.
5. Source pixels do not define engine geometry. Bundle-blueprint /
   presentation-target geometry still comes from the authoring registry and the
   active presentation contract. The source-layout contract only defines how
   PNG-space maps into those target slots.

#### 2.3.2 Source Manifest Contract

1. The canonical Section 2 authority is a JSON sidecar adjacent to the source PNG: `<source>.asciicker-source.json`.
2. The sidecar is the only manifest authority. Workbench sessions may cache a snapshot of the current manifest for local editing continuity, but that snapshot is a mirror, not the source of truth.
3. The manifest root must contain:
   - `version`
   - `source`: path, sha256, image width, image height
   - `bundle_blueprint_key`
   - `layout_mode`: `uniform_grid` or `explicit_regions`
   - `layout`: the mode-specific declaration
   - `guides`: optional editorial guides
   - `regions`: canonical target mappings
4. `layout` rules:
   - for `uniform_grid`, it declares `angles`, `frames`, `source_projs`,
     optional `angle_labels`, and optional `presentation_target_default`
   - for `explicit_regions`, it may declare only shared sheet metadata; export/import behavior must come from `regions`
5. Each `regions[]` entry must contain:
   - stable `id`
   - `source_rect`: `[x, y, w, h]` in PNG pixels
   - `target`: `presentation_target_key`, `angle`, `frame`, `projection`
   - optional `notes`, `tags`, and `confidence`
6. `regions[]` are the only manifest entries that may drive conversion/import/export. Editorial helpers are separate:
   - `guides.anchor_rect`
   - `guides.cuts_v`
   - `guides.cuts_h`
   - `guides.detected_boxes`
7. Step 6 must demote live `extractedBoxes`, `sourceCutsV`, and `sourceCutsH` into these `guides` fields or derive them from `regions`; they may no longer be independent session authority once the manifest contract is implemented.
8. `template_set_key` and `action_key` are deleted from the canonical
   user-facing contract. If migration code temporarily mirrors them for
   compatibility, that mirror is internal-only and must not regain authority.

#### 2.3.3 Agent/Human Slicing Workflow Contract

1. Source slicing is a wrapper workflow layered over the Section 1 root editor. It may never export XP directly without first materializing a root-editor document/session snapshot.
2. Human workflow:
   - load PNG and existing sidecar if present
   - choose `uniform_grid` or `explicit_regions`
   - use the source panel as a slicer surface that edits manifest draft state
   - commit confirmed mappings into `regions[]`
   - materialize a selected presentation target into the root editor for
     inspection/editing
3. Agent workflow:
   - read or write the same sidecar manifest through MCP/HTTP tools
   - request manifest validation and presentation materialization using the same
     contract the UI uses
   - never rely on hidden session-local source arrays
4. The legacy action-grid helpers remain compatibility wrappers only. Their
   long-term contract is:
   - if given only `source_path`, they create an ephemeral `uniform_grid`
     manifest from the selected presentation-target geometry and then call the
     generic manifest-driven materializer
   - if given a manifest in a later step, the manifest path/doc becomes
     authoritative and `source_path` is only provenance
5. The slicer produces root-editor documents, not final runtime files. Bundle
   registration/compile still happens only after the root editor snapshot or
   converted XP exists and passes the wrapper gates.
6. The canonical Section 2 flow remains visually similar to the current
   workbench:
   - upload or load source art
   - slice or guide the sheet
   - drag/adjust mappings
   - inspect the materialized XP in Section 1
   - validate, register, and compile
   Only the selection paradigm changes.
7. The manifest contract is explicit even where front-door tooling is still
   incomplete. Missing slicer/UI/MCP/CLI front doors are implementation gaps
   tracked by `UQ-006` and `UQ-010`, not design gaps.

**RESOLVED (FL-STEP4-03, 2026-04-16):** `/api/workbench/create-blank-session` again accepts the legacy blank-root entry point. Bare `{}` now creates the default generic 126x80 root session, `blank_session` payloads are accepted for explicit geometry, and the template-backed `template_set_key`/`action_key` path still resolves against the mounted-aware registry. This does not claim mounted-family authoring/runtime parity or native-builder support.

#### 2.3.4 Conversion Quality And Agent Vision Substitute Contract

1. Section 2 quality validation must return a machine-readable report with `PASS`, `WARN`, or `FAIL`.
2. `FAIL` means any of the following:
   - a required target slot is unmapped or multiply mapped
   - manifest rectangles fall outside the declared source image
   - `uniform_grid` divisibility/layout requirements are violated
   - any required structural gate fails (`G7` through `G12`, or their direct replacement)
   - conversion falls back to the generic whole-image fit path during agent-autonomous export
3. `WARN` means the conversion is structurally legal but suspicious and needs human review or explicit override. Warning-class signals include:
   - fallback conversion used in a human-guided run
   - duplicate-frame clusters
   - large source-to-XP occupancy deltas
   - low non-empty coverage in otherwise mapped frames
4. `PASS` means:
   - every required `(action, angle, frame, projection)` slot is mapped exactly once
   - the declared layout mode is internally consistent
   - the conversion did not require warning-class fallback
   - the validation report contains no `FAIL` or `WARN` signals
5. The quality report must include enough signal for non-visual agent loops to decide deterministically:
   - required slot count, mapped slot count, unmapped slot count
   - fallback-used boolean
   - per-gate results for `G7`-`G12`
   - per-slot non-empty coverage summary
   - duplicate-frame or near-empty-frame findings
6. `xp_cat.py` or preview PNGs may remain human aids, but they are not the canonical agent proof surface. Agents proceed automatically only on `PASS`; `WARN` requires explicit human acceptance or a higher-level override policy.

**CONTRACT CLARIFICATION (2026-04-27):** the canonical `validate-xp` surface is
required to remain non-exporting and machine-readable, but this spec no longer
claims that the exact `/api/workbench/validate-xp` route is live in current
pipeline-v3 code. The route/tool name must stay truthful to the implementation.
The contract requirement is the behavior: quality proof without export-side
mutation.

#### 2.3.5 Family Expansion Policy

1. Main-game `SkinFamilyDefinition` tables are the engine/runtime authority for
   base `skin_family`, filename-prefix inventory, direct-overlay prefix
   inventory, and fallback behavior. Pipeline-v2 may not invent a new base
   family or prefix group by template-only change.
2. Adding a new family is an engine-wide change, not a template-only change. At
   minimum it touches:
   - `server/network.h` `SKIN_FAMILY`
   - `server/server_tick.cpp::SvrResolveSkinFamilyAndName()`
   - `engine/game.cpp` family globals + `g_skin_family[]`
   - legacy AHSW assets
   - direct overlay generation inputs in
     `scripts/pipeline/generate_presentation_overlays.py`
3. `config/template_registry.json` is the pipeline-v2 authoring-surface
   authority, but it is not the engine authority. The required normalized
   action contract is:
   - `filename_prefix`
   - `skin_family`
   - `xp_dims`
   - `angles`
   - `frames`
   - `source_projs`
   - `projs`
   - `cell_w`
   - `cell_h`
   - `layers`
   - `ahsw_range`
   - `preview_xp`
   - `preview_xp_sha256`
   - `l0_ref`
   - `l0_ref_sha256`
4. The current branch still does not fully meet that normalized template
   contract. Template-driven backend execution and operator-visible
   `registry_status` handling now consume the normalized action schema, but
   `UQ-004` was narrowed to its final residual: `preview_xp` silently falling back
   to `l0_ref`. The four hardcoded `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were
   deleted in `a58eda6`..`e23fd3f`, and all override-name paths now derive from
   registry `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was
   fail-closed in this session.
5. `preview_xp` is the canonical representative-preview authority. `l0_ref`
   remains the structural metadata authority. G12 or its direct replacement
   must derive expected L0 row-0 metadata from the referenced XP contract, not
   from a second handwritten family table when a reference XP is available.
6. Local sprite inventory is evidence, not authority. Pipeline-v2 may not infer
   family contracts by scanning disk; it must use the declared template/action
   contract plus engine-family truth.
7. Partial-family support is allowed only through explicit engine fallback:
   - pipeline-v2 may export a family/action subset
   - missing direct overlays or strips must be treated as inherited via
     engine-side `fallback_family`, not as silently-authorable coverage
8. Initial mounted-family scope remains explicit and limited once the normalized
   schema lands:
   - `wolfie` idle/walk
   - `wolack` attack
   - `bigbee` deferred
9. Green proof-prefix support exists in engine/runtime, but green remains
   proof-only in pipeline-v2 until checked-in green template/reference assets
   and authoring contracts exist in this repo.
10. `player-nude.xp` remains a special runtime filename derived from the human
    on-foot contract. It is not a separate family-expansion mechanism, and it
    is not the canonical browser preview representative for animated families.
11. UI/MCP/runtime implications:
    - `/api/workbench/templates`, bundle action tabs, blank-session creation,
      bundle export, and validation must derive authorable scope from
      template-set actions only
    - browser/launcher grouping should follow engine-derived filename prefixes,
      not old flat template labels
    - runtime override helpers are downstream name writers only
    - absence from the active template set means "not authorable here", even if
      runtime naming code knows the prefix
    - legacy saved sessions/jobs may still be read through `family` fallback,
      but new outward payloads must use `filename_prefix` / `skin_family`

#### 2.3.6 Wearable Slot/Style Expansion Policy

1. Wearables now use a generalized backend contract in `asciicker-Y9-2`:
   - item archetype/variant/style bits are packed into one 16-bit flags field
   - the variant nibble selects wearable slot
   - the style nibble selects wearable visual style
2. Two parallel engine lookups happen for each wearable:
   - world/inventory sprite lookup through `item_proto[]` rows keyed by
     wearable proto kind plus visual style
   - body overlay lookup through the presentation registry keyed by
     `{family, kind, slot, variant}`
3. Adding a new wearable style requires coordinated changes to:
   - `server/network.h` style constants and
     `PresentationVariantFromWearableStyle()`
   - `engine/game.cpp::NormalizeWearableVisualStyle()`
   - `item_proto[]` style rows
   - overlay-generation color maps and output assets
4. Adding a new wearable slot requires coordinated changes to:
   - the server-side item flag producer
   - `GetAuthoritativeWearableProtoKind()`
   - presentation-slot tokenization / registry keys
   - `item_proto[]`
   - overlay-generation prefix/slot output
   - the wire-packing budget if the current nibble allocation is exhausted
5. Pipeline-v2 currently has no wearable/item template surface. That is now an
   explicit backend/product gap, not an ambiguity about how the engine works.
6. `UQ-004` and the runner work that follows must distinguish:
   - character strip authoring
   - direct presentation-overlay compatibility
   - standalone wearable/item authoring, if and when that surface is added

#### 2.3.7 Required Contract Architecture Split

The normalized family/wearable model is now too broad to leave in one ambiguous
"template registry" blob. The required architecture split is:

1. **Engine schema truth**
   - sourced from Y9-2 family, prefix, fallback, slot, and style behavior
2. **Pipeline authoring registry**
   - the subset that is authorable in this repo now
3. **Runner contract helper**
   - a derived helper consumed by backend tests and fidelity runners so the
     same schema drives proofs instead of each runner re-encoding assumptions

If those three layers drift, the canon must treat that as a backend/schema
regression before it is treated as a UI problem.

#### 2.3.8 Porting Precondition - Semantic Runtime Parity, Not Just Action Tabs

> **⚠ PARTIALLY SUPERSEDED (2026-05-12, §2.15):** This section describes the
> Y9-2 selector-driven bundle system as the parity target. The server-side
> identity contract (`appearance_profile_id`, `skin_definition_id`, etc.) and
> the compile-time coverage obligation remain accurate. However, the *runtime*
> interpretation layer — selectors, semantic tables, conditional row lookup — is
> now the deletion target per §2.15.0. The porting precondition is restated:
> pipeline-v3 must emit compiler-validated `RenderPlan` rows keyed by
> `ServerVisualKey`, not just prove semantic coverage in the old selector model.

The active Y9-2 runtime contract is no longer narrow "three action tabs"
truth. The current game repo (`/Users/r/Downloads/asciicker-Y9-2` on
`main @ 0ef8d327`, dirty worktree) now consumes generalized bundle identity and
semantic selector state:

1. `server/network.h` appearance V2 carries:
   - `appearance_profile_id`
   - `skin_definition_id`
   - `mount_definition_id`
   - per-entry `slot_kind_id`
   - per-entry `item_definition_id`
   - per-entry `visual_style_id`
2. `STRUCT_SNAPSHOT_ENTITY` carries bundle-era `presentation_kind_id`, and
   snapshot layout version `9` is the bundle-aware layout.
3. `engine/inventory.h` item instances now carry `item_definition_id`,
   `visual_style_id`, and `presentation_kind_id`.
4. `engine/game_app.cpp` reads
   `assets/appearance_bundle/current/compile_report.json` during join and
   requires bundle contract hashes.
5. The compiled appearance bundle in Y9-2 is selector-driven with semantic
   tables such as:
   - `on_foot_idle`
   - `on_foot_move`
   - `melee_attack`
   - `fall_dead`
   - `world_item`
   - `inventory_grid`
   and those selectors are keyed by semantic state inputs like
   `combat_states`, `life_states`, `locomotion_states`, `mount_states`, and
   `presentation_kinds`.

Therefore the porting/testing precondition is strict:

1. Current workbench authoring/runtime proof in this repo remains necessary.
2. It is **not sufficient** for generalized-bundle porting by itself.
3. Before claiming ported parity with the Y9-2 bundle system, this repo must
   add a verifier/contract layer that can prove the **same semantic
   action/state rows** the game repo uses, rather than only the current
   `idle` / `attack` / `death` authoring tabs.
4. Do not collapse this into "replace the editor tests." The correct split is:
   - keep editor/workbench authoring proof
   - add semantic runtime/bundle parity proof
   - only then claim generalized bundle-port readiness
5. Y9-2 canon law also requires the same reachable action surface for real
   players, manual runs, scripted runs, and proof artifacts, with recipes
   remaining input-only and analyzer gates owning proof. Any future porting
   verifier here must follow that same boundary.
6. Boundary correction: it is not accurate to say "Section 1 stayed unchanged
   and only Section 2 changed." Current code shows material Section 1 root
   editor changes (whole-sheet primary-surface ownership, Session Ops blank-root
   flow, whole-sheet browse/zoom/clipboard/mode behavior). The correct claim is:
   Section 1 changed materially, while the specific missing generalized-bundle
   parity layer lives in Section 2 semantic-runtime coverage.

#### 2.3.9 Semantic Runtime Coverage Model And Current-Scope Rows

The repo now has an explicit contract-model layer for the Y9-2 semantic runtime
rows it must eventually prove.

Current contract surfaces:

1. `scripts/xp_fidelity_test/bundle_contract.mjs`
   - `getSemanticRuntimeParityContract()`
2. `scripts/xp_fidelity_test/run_semantic_runtime_contract_test.mjs`
   - contract-audit verifier lane
3. `tests/xp_fidelity_test/semantic_runtime_contract.test.mjs`
   - row/blocker assertions

Current-scope actor-row set now modeled:

1. `actor.on_foot_idle`
2. `actor.on_foot_move`
3. `actor.melee_attack`
4. `actor.fall_dead.fall`
5. `actor.fall_dead.dead`

Deferred or later-scope rows that remain modeled as blockers:

1. `item.world_item`
2. `item.inventory_grid`
3. `actor.mounted_idle_walk`
4. `actor.mounted_attack`

Current modeled coverage state in this repo:

1. Mapped to the current authoring surface:
   - `actor.on_foot_idle` -> `player_native_full / idle / player`
   - `actor.on_foot_move` -> `player_native_full / idle / player`
   - `actor.melee_attack` -> `player_native_full / attack / attack`
   - `actor.fall_dead.fall` -> `player_native_full / death / plydie`
   - `actor.fall_dead.dead` -> `player_native_full / death / plydie`
2. Explicit deferred/not-yet-authorable rows:
   - `item.world_item`
   - `item.inventory_grid`
3. Explicit broader-readiness blockers:
   - mounted rows are specified but not authorable in the current registry
   - the live pipeline-v3 backend still lacks the Y9-2 runtime identity layer
   - headed semantic gameplay proof is still missing

What this contract slice means:

1. The repo is no longer allowed to over-claim "generalized bundle parity"
   while silently remaining action-tab only.
2. The contract layer is necessary, but it is not the same thing as runtime
   proof.
3. `generalized_bundle_port_ready` remains `false` until:
   - a live runtime identity layer exists in pipeline-v3 backend/compiler truth
   - the current-scope actor rows are proven in runtime-facing lanes, not just
     modeled
   - any deferred item/wearable or mounted rows are explicitly brought into
     scope and then implemented/proven
   - headed semantic gameplay proof exists for the same action surface Y9-2
     canon requires

#### 2.3.10 Runtime Identity Layer Contract And Queue Placement

The Y9-2 bundle system depends on a numeric runtime identity layer. Pipeline-v3
cannot honestly claim generalized-bundle parity until that identity layer
exists in live backend/compiler state rather than only in explanatory docs.

Required identity surfaces:

1. `skin_definition_id`
2. `presentation_kind_id`
3. `layer_definition_id`

Current honest state:

1. The Y9-2 architecture reference in §2.14 explains these IDs.
2. Pipeline-v3 backend/service code does not yet own them as live execution
   truth.
3. `scripts/xp_fidelity_test/bundle_contract.mjs` may carry informational rows
   or string-scoped helper data, but that does not count as runtime-identity
   implementation.
4. A helper that still returns string scope such as `"human"` is honest as a
   current-scope placeholder, but it must not be presented as Y9-2 runtime-id
   parity.

Queue placement and scope law:

1. `UQ-007` owns the runtime identity layer in this repo.
2. `UQ-007` is blocked on `UQ-004` normalized registry authority cleanup. Do
   not bolt numeric runtime IDs onto mixed `family` / `filename_prefix`
   authority.
3. `UQ-008` mounted-family authoring/runtime parity sits on top of that
   identity layer and may not replace it.
4. Item/wearable authoring surface (`S2-FAM-04`, including `world_item` and
   `inventory_grid`) remains explicitly deferred post skin-authoring signoff.
   Keeping those rows visible in contract helpers is allowed; treating them as a
   current blocking queue row is not.

Minimum `UQ-007` deliverables:

1. one live owner for pipeline-side runtime identity
2. consistent ID use across bundle contract helper, register/compile outputs,
   and any backend/API proof surfaces that claim Y9-2 bundle parity
3. no remaining claim that string-only scope is sufficient for generalized
   bundle-runtime readiness

#### 2.3.11 Per-Angle Semantic Dictionary And Overlay Slot Affinity Contract

The Y9-2 semantic dictionary (`scripts/pipeline/bundle_wizard/semantic_dict.py`)
currently uses a static `_REGION_ATLAS` with 17 fractional-bounded body regions
that are the same for every angle and every frame. This makes body-part
identification unreliable when the character is not facing the reference pose
(angle 4, South). `get_body_part_at(0, 3)` returns `"head_top"` regardless of
whether the character faces North (back of head, no face visible) or South
(full face). Documented as FL-2897.

Per-angle semantic accuracy is a prerequisite for three downstream surfaces:

1. Wearable overlay authoring validation (`S2-FAM-04`) — a new helmet overlay
   needs validation that its cells actually cover head regions at each angle
2. Palette-role-scoped recoloring in the workbench — "recolor just the armor
   cells" requires knowing which cells are armor vs body at each angle
3. Mounted composition validation (`UQ-008`) — rider/mount overlap cells
   change dramatically between angles

The pipeline-v3 semantic map JSON schema
(`docs/research/ascii/semantic_maps/schema.json`) already supports per-frame
regions with per-frame bboxes, but only 4 frames out of ~352 total (across 3
families) are annotated — all at angle 0, projection 0. The gap is coverage
and tooling, not data model.

This section codifies the per-angle semantic dictionary contract:

1. **Anchor model**: The static fractional `_REGION_ATLAS` is replaced by
   per-angle anchor data. For each sprite family (player, attack, plydie), the
   user defines one ground-truth region map per angle (8 angles x 1 idle frame
   = 8 anchor frames per family). Anchors are stored as pipeline-v3 semantic
   map JSON files with 8 frame entries (one per angle), each containing
   per-angle `regions` with `bbox`, `semantic_cells`, `palette_roles`, and
   `slot_affinity`.

2. **Anchor format**: Anchors use the existing pipeline-v3
   `semantic_maps/schema.json` format. No new data format is introduced. The
   `frame_w` and `frame_h` fields in the anchor JSON define the coordinate
   space for that family's anchors. Player anchors use `frame_w: 7`, attack
   anchors use `frame_w: 9`. Each family's anchors are independent.

3. **`slot_affinity` field**: Each region in the semantic map may carry an
   optional `slot_affinity` string linking it to an engine wearable slot. Valid
   values correspond to the engine `APPEARANCE_SLOT_KIND` enum in
   `server/network.h`:
   - `"body"` (APPEARANCE_SLOT_KIND_BODY = 300)
   - `"head"` (APPEARANCE_SLOT_KIND_HEAD = 301)
   - `"shield"` (APPEARANCE_SLOT_KIND_SHIELD = 302)
   - `"weapon"` (APPEARANCE_SLOT_KIND_WEAPON = 303)
   - `"armor"` (APPEARANCE_SLOT_KIND_ARMOR = 306)
   - `"mount"` (APPEARANCE_SLOT_KIND_MOUNT = 307)

   `slot_affinity` is a region-level field, not a cell-level field. Individual
   cells inherit slot affinity from their containing region.

4. **Overlay mask derivation**: For each existing overlay XP file (e.g.,
   `player-armor-regular.xp`), overlay masks are derived — not independently
   authored — by combining the cell-level diff from
   `generate_presentation_overlays.py` with the body semantic map:
   a. Load body and overlay XP files
   b. At each (angle, frame), compute cell-level diff using visual signatures
   c. For each differing cell, look up body_part from the body semantic map
      using angle-aware `get_body_part_at(y, x, angle)`
   d. Aggregate covered body parts and cells per angle
   e. Infer slot from the dominant body parts covered (>80% head = helmet slot)
   f. Overlay cells extending beyond body region bboxes (helmet crowns, weapon
      swings) are labeled `"overlay_extension"` and excluded from slot
      inference percentage
   g. Cells marked with SWOOSH_INDEX=254 are assigned weapon slot regardless

5. **Palette-role x slot binding**: Each `palette_roles` entry in the semantic
   map may carry an optional `slot` string linking a palette role to a wearable
   slot. This enables scoped recoloring commands: "recolor armor cells" maps to
   palette roles with `"slot": "armor"`, leaving body palette roles untouched.

6. **Propagation algorithm**: Given the 8 angle anchors (idle frames), a
   propagation algorithm labels non-anchor frames (walk, attack, death) at the
   same angle using RGB-based signature tracking:
   a. For each angle, extract `(glyph, fg_rgb, bg_rgb)` signatures per body
      region from the anchor frame
   b. For each non-anchor frame at the same angle, match cells against anchor
      region signatures
   c. When signatures collide (inevitable with a limited palette), use spatial
      proximity as tiebreaker: prefer the nearest cell within +/-2 of the
      anchor position for the same region
   d. Cells with no signature match get `"unknown"` label for human review
   e. Each propagated region carries a `propagation_confidence` score

   Note: the overlay system's `visual_key()` in
   `generate_presentation_overlays.py` uses palette indices, not RGB. The
   propagation algorithm must build its own RGB-based signature function.

7. **Mirror projection**: Projection 1 anchors are derived from projection 0
   by X-mirroring: `mirrored_x = frame_w - 1 - x`. Left/right body-part
   labels swap. The user only defines 8 anchors for projection 0.

8. **Backward compatibility**: The `angle` parameter is optional on all
   public API functions (`get_body_part_at()`, `get_rect_body_part()`,
   `identify()`). When no anchor data is loaded, results are identical to the
   existing fractional atlas. When anchor data is loaded and `angle` is
   supplied, results reflect the per-angle ground truth.

9. **Anchor file convention**: Anchor files are stored in pipeline-v3 at
   `docs/research/ascii/semantic_maps/<family>-anchors.json`. Y9-2
   `semantic_dict.py` loads them via an explicit path argument.

Current evidence:

- `scripts/pipeline/bundle_wizard/semantic_dict.py` — Y9-2 static atlas
- `docs/research/ascii/semantic_maps/schema.json` — pipeline-v3 schema
- `scripts/pipeline/generate_presentation_overlays.py` — Y9-2 overlay diff
- `server/network.h` — engine `APPEARANCE_SLOT_KIND` enum
- FL-2897 — static fractional bounds diagnosis

Queue placement:

1. This contract is a prerequisite for `S2-FAM-04` wearable authoring
   validation surface. Do not build the wearable authoring UI without per-angle
   semantic accuracy.
2. This contract is a prerequisite for `UQ-008` mounted composition
   validation. Do not claim mounted overlay validation without per-angle
   region data for rider and mount sprites.
3. Anchor data authoring (defining the 8 angle anchors per family) is a user
   task that follows tooling delivery, not a pipeline code deliverable.

### 2.4 Structural Gate, Export, And Injection Contract

Current wrapper-side structural gates are:

- G7 geometry cell count
- G8 non-empty coverage
- G9 handoff population
- G10 dimension match
- G11 layer count match
- G12 L0 row-0 metadata glyphs

Current gate/export code path:

1. `workbench_export_bundle()` exports each ready action XP
2. `_run_structural_gates()` checks the art-layer quality gates plus dims,
   layers, and L0 metadata
3. failing actions hard-stop bundle export or payload generation

Current evidence:

- `src/pipeline_v2/service.py:3668-3716`
- `src/pipeline_v2/service.py:3720-3783`
- `src/pipeline_v2/service.py:3786-3840`

These gates are wrapper safeguards. They do not define the editor root contract.

Current open issues in the gate and registry implementation:

1. **The quality contract exists and the canonical validate-xp surface is now live.** The `/api/workbench/validate-xp` route and MCP `validate_xp` tool run G7-G12 validation on a single XP against its template spec without requiring bundle/session context. G8/G9 threshold policy is locked in `gates.py`.

2. **`UQ-004` registry authority is closed.** `config/template_registry.json` is the live authority for template-driven backend bundle/session/export gates, `/api/workbench/templates` surfaces `registry_status`, and legacy session identity resolves `filename_prefix` / `skin_family` on read plus next-save persistence. The four hardcoded `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`; all override-name paths derive from registry `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was fail-closed (normalizer raises ValueError on missing `preview_xp`). Registry load/fetch errors return 503 from the API and surface as a degraded-state warning in the browser UI rather than silently caching empty truth.

3. **G8/G9 export semantics policy is locked in code.** Export-time structural gating runs `G7-G12`. `_G8_MIN_RATIO=0.05` is a named constant in `gates.py` with policy documentation. The canon queue table marks `UQ-005` CLOSED as of `2026-04-29`. The G8/G9 threshold/report semantics now match across validate-xp, export, and payload paths.

4. **FL-STEP4-04 resolved on `2026-04-16`: dead `force_fallback` and `crop_box` removed from `RunConfig`.** The live `/api/run` and `/pipeline/run` contracts no longer advertise fields the handlers ignore; legacy callers now get an explicit `unsupported_run_fields` error if they still send those keys.

### 2.5 Current Section-2 Misalignment Ledger

The live wrapper architecture is still misaligned in these exact ways after the
`2026-04-16` removal of the Step 4 mirror-sync owner:

| Finding | Current evidence | Why this is misaligned |
|---------|------------------|------------------------|
| Canonical source-manifest authoring is defined, but live code still keeps session-local source-layout authority | `web/workbench.html:133-145`, `web/workbench.js:2196-2377`, `web/workbench.js:3278-3367`, `src/pipeline_v2/service.py:4004-4048` | The spec now requires `<source>.asciicker-source.json` to be the only authoritative source-layout owner, but the live workbench still persists `source_boxes`, `source_cuts_v`, and `source_cuts_h` in session save/load state. Combined-sheet slicing therefore still lacks one canonical manifest owner. |
| Source panel workflow exists, but it is not yet canonical-manifest-first | `web/workbench.js:2242-2305`, `web/workbench.js:3278-3367`, `web/workbench.js:4310-4332`, `src/pipeline_v2/app.py:496-525` | The source canvas is interactive and useful, but the live code path still centers on session state rather than a sidecar-first manifest lifecycle shared by browser, CLI, and MCP. |
| Template registry is normalized and mounted-aware in data; `FAMILY_W_RANGE` hardcoded maps deleted; `preview_xp` fail-closed; registry errors operator-visible | `config/template_registry.json`, `src/pipeline_v2/service.py:1105-1232`, `src/pipeline_v2/service.py:1417-1460`, `src/pipeline_v2/service.py:3018-3178`, `src/pipeline_v2/service.py:3895-3982`, `web/workbench.js`, `web/termpp_skin_lab.js`, `runtime/termpp-skin-lab-static/termpp_skin_lab.js` | `ENABLED_FAMILIES` is gone from live backend gates and the four `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`. All override-name paths derive from `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was fail-closed (normalizer raises ValueError). Registry load/fetch errors return 503 and surface as browser warnings. CLOSED. |
| MCP override-name validation now accepts engine-valid hyphenated prefixes | `scripts/workbench_mcp_server.py` | `_AHSW_RE` now accepts `player-green-0001.xp`-style names. RESOLVED. |
| Mounted-family authoring is live, but runtime parity proof is still absent | `config/template_registry.json`, `config/runtime_identity_registry.json`, `src/pipeline_v2/service.py`, `src/pipeline_v2/app.py:817-890`, `scripts/workbench_mcp_server.py:542-708`, `tests/test_mounted_calibration_backend.py`, `tests/test_mounted_semantic_review.py`, `web/workbench.html`, `web/workbench.js`, `asciicker-Y9-2/scripts/pipeline/mounted_wrapper_mask_selector.py`, `asciicker-Y9-2/scripts/pipeline/xp_semantic_atlas_reviewer.py` | `wolfie` and `wolack` now have mounted template actions, `authorable: true`, native builders, V2 runtime identity IDs, backend/MCP calibration and semantic-review artifact routes, and browser U2/U4 sibling buttons that call those artifact routes without mutating XP art through jitter. The remaining gap is the `mounted_authoring_e2e` runtime proof: generated mounted XP must produce Y9-2 rows with server-owned V2 IDs, pass parser acceptance, be selected at runtime, and prove no legacy sprite fallback. |
| Green proof coverage now exists, but green authoring remains deliberately proof-only until green reference assets exist | `src/pipeline_v2/service.py`, `config/template_registry.json`, `scripts/workbench_png_to_skin_test_playwright.mjs`, `web/workbench.js` | Runtime/proof helpers now preserve and inject `player-green` / `attack-green` / `plydie-green`, but the green bundle-authoring surface stays human-only by explicit boundary. This is a product-scope limitation, not a missing proof-path owner. |
| Skin Dock proof is now explicit, but it is still wrapper proof rather than editor proof | `src/pipeline_v2/service.py:2898-2921`, `web/workbench.js:1453-1558`, `web/workbench.html:320-404` | Single-session runtime scope and structural-vs-runtime verification are now explicit, but runtime proof still does not establish Section 1 editor correctness. |
| Wrapper run paths still do not use one canonical manifest owner end-to-end | `src/pipeline_v2/app.py:438-446`, `src/pipeline_v2/service.py:1437-1660`, `src/pipeline_v2/service.py:2558-2710`, `tests/test_workbench_validation.py` | Live conversion/run behavior still mixes source-path/session-local state with partial normalized registry logic. The spec's sidecar-first manifest contract is not yet the sole live execution owner. |
| Export/web payload paths use the shared structural-gate owner, validate-xp is live, G8/G9 policy locked | `src/pipeline_v2/service.py:3917-3970`, `src/pipeline_v2/service.py:3992-4070`, `src/pipeline_v2/gates.py`, `src/pipeline_v2/app.py:645-660`, `scripts/workbench_mcp_server.py:435-452` | Export and web-skin payload paths run `_run_structural_gates()` with G7-G12. Canonical `/api/workbench/validate-xp` route + MCP `validate_xp` tool added. G8 threshold `_G8_MIN_RATIO=0.05` and G9 policy are locked with named constants and documentation in `gates.py`. |
| Agent quality contract — validate-xp route/tool is live | `src/pipeline_v2/app.py:645-660`, `src/pipeline_v2/service.py:3920-3965`, `scripts/workbench_mcp_server.py:435-452` | The canonical `/api/workbench/validate-xp` route and MCP `validate_xp` tool are now live. They run G7-G12 on a single XP against its template spec without requiring bundle/session context. |
| Agent session inspection remains limited to the older workbench wrapper surface | `scripts/workbench_mcp_server.py`, `scripts/xp_mcp_server.py` | The repo has MCP tooling, but not the canonical Section 2 manifest/presentation/bundle inspection surface. Browser, MCP, and CLI parity is therefore still incomplete. |
| Classic conversion no longer reintroduces geometry-first wrapper ownership | `web/workbench.html`, `web/workbench.js`, `src/pipeline_v2/app.py`, `src/pipeline_v2/service.py`, `tests/test_workbench_flow.py` | The upload panel remains source-only, while classic root geometry now enters through `Session Ops` / `New XP` and the active session. `Use Auto-Plan` is advisory only. `wbRun()` now requires an active session and posts explicit target geometry (`target_cols` / `target_rows`) into `/api/run`, and the backend honors that exact non-native target grid. RESOLVED for the browser-owned geometry path; richer frame-nav row/cell editing is still a separate product gap. |
| Browser bundle scope and backend template-driven authority now consume the same registry contract; `FAMILY_W_RANGE` maps deleted; `preview_xp` fail-closed | `src/pipeline_v2/app.py:389-393`, `web/workbench-template-gating.js`, `web/workbench.js:7286-7307`, `src/pipeline_v2/service.py:1105-1232`, `tests/test_template_registry_schema.py`, `tests/web/workbench-template-gating.test.js` | Browser action gating and backend template-driven gating now both honor `skin_family_scope`, `proof_only`, `authorable`, and `template_actions` linkage. The four `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` hardcoded maps were deleted in `a58eda6`..`e23fd3f`. All override-name paths derive from `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was fail-closed. CLOSED. |
| `UQ-004` registry stabilization - `FAMILY_W_RANGE` maps deleted, `preview_xp` fail-closed, registry errors operator-visible | `web/workbench.js`, `web/termpp_skin_lab.js`, `runtime/termpp-skin-lab-static/termpp_skin_lab.js`, `src/pipeline_v2/service.py`, `src/pipeline_v2/app.py:389-393`, `tests/test_template_registry_schema.py`, `tests/web/workbench-override-names.test.js`, `tests/web/termpp-skin-lab-registry.test.js` | Registry load/fetch failures are operator-visible (503 API, browser warn). The four `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`. All override-name paths derive from `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was fail-closed. Empty registry is not cached — errors re-surface on each call. CLOSED. |
| Y9-2 stable bundle-authoring API contract does not yet exist in live pipeline-v3 routes | `src/pipeline_v2/app.py`, `scripts/workbench_mcp_server.py` | Live routes are still the older `/api/workbench/*` family plus `/healthz`, and the MCP server is still a workbench wrapper. Y9-2 has a useful local CLI wizard, but there is still no single truthful bundle-authoring API/CLI surface shared across repos. |
| Y9-2 bundle wizard not wired as launcher sub-action | `Y9-2 scripts/launcher.py`, `Y9-2 scripts/pipeline/bundle_wizard/main.py` | The current bundle-wizard client exists, but `[3] ASSET PIPELINE` is still absent from the launcher rather than wired to the shared owner contract. Tracked as Y9-2 DESIGN OPEN B-13. |
| **GAP: No wearable or item templates, and no backend parity runner for wearable slot/style contracts** | `config/template_registry.json`, `scripts/xp_fidelity_test/`, `tests/` | Pipeline-v2 has no wearable/item authoring surface, and there is no structural-contract runner that proves the local schema matches Y9-2 slot/style truth. That means gold/dark/default wearable semantics are still only partially covered by ad hoc runtime or engine-side knowledge. Tracked as S2-FAM-04. |
| **GAP: Runtime identity is live, but semantic-runtime proof still lacks mounted/item runtime evidence** | `scripts/xp_fidelity_test/bundle_contract.mjs`, `scripts/xp_fidelity_test/run_semantic_runtime_contract_test.mjs`, `tests/xp_fidelity_test/semantic_runtime_contract.test.mjs`, `scripts/xp_fidelity_test/run_bundle_fidelity_test.mjs`, `scripts/xp_fidelity_test/run_manual_assembly_e2e_test.mjs`, `config/template_registry.json`, `config/runtime_identity_registry.json`, `Y9-2 server/network.h`, `Y9-2 engine/inventory.h`, `Y9-2 scripts/pipeline/staging/appearance_bundle/phase2-positive/appearance_bundle.json` | Pipeline-v3 now has live `skin_definition_id` / `presentation_kind_id` / `layer_definition_id` ownership. Generalized bundle-port readiness remains false because item/world/inventory rows are still explicit blockers and mounted runtime proof still needs `mounted_authoring_e2e` evidence. |
| **GAP: Y9-2 replacement path is partial and no longer the old `appearance_bundle.py` target** | Y9-2 `origin/main`: `scripts/compile_actor_visual_profiles.py`, `engine/actor_visual_profile_table.generated.h`, `engine/actor_visual_profile_runtime.h`; deleted legacy refs: `scripts/pipeline/appearance_bundle.py`, `assets/appearance_bundle/current/render_plans.json`, `engine/bundle_runtime.cpp` | The latest fetched Y9-2 branch has moved beyond the May 12 `appearance_bundle.py` / `render_plans.json` transition language: commits `ea54ffb86` and `6fe089012` delete those legacy/transition owners. The active production path emits ActorVisualProfile generated-table artifacts from server reachability and upstream sprite resolver/load semantics. It is still implemented-unproven and partial because authored profile JSON is not a production input, parser/visual proof remains a separate gate, and pipeline-v3 has no shared authoring seam into that compiler. Tracked by the Y9-2 bundle family around FL-3912, FL-3943..FL-3946, FL-4049, FL-4055, and FL-4125, not the local-stale FL-3861..FL-3868 numbering. |
| **GAP: pipeline-v3 `ActorVisualProfile` UI exists, but generated profiles are not authoritative** | `src/pipeline_v2/app.py::api_wb_create_actor_visual_profile()`, `src/pipeline_v2/service.py::workbench_create_actor_visual_profile()`, `config/actor_visual_profiles/` | Pipeline-v3 now has an ActorVisualProfile schema, route, examples, and workbench button, but the generated object is scaffolding: unstable `hash(session_id)` identity, hardcoded `layer_definition_id=700`, hardcoded `visual_style_id=1`, one full-sheet region, and no durable Y9-2 compiler consumer. The current workbench must not claim that this button produces live Y9-2 runtime rows. |
| **GAP: Structured authoring artifact (Step 7) missing semantic map refs, variation, slot/layer assignments** | `src/pipeline_v2/service.py::workbench_export_bundle()`, `src/pipeline_v2/service.py::workbench_web_skin_bundle_payload()` | Current export produces per-action XP paths + runtime identity IDs. Missing: semantic map refs, `variation` field, explicit slot/layer assignments (which XP covers which slot), mount rear/front separation, mount composition data, quality gate summary per slot. This is the pipeline-v3 side of Step 7 of the content authoring workflow. FL-3863. |
| **GAP: Runtime parser / headed visual proof remains mandatory for any replacement-path claim** | Y9-2 generated ActorVisualProfile table and runtime loader surfaces; pipeline-v3 Skin Dock proof surfaces | A Python-only compile or generated-header presence is not enough. The accepted gate is still runtime acceptance plus headed visual proof for the content path being claimed. In pipeline-v3, the proven May 15 path is legacy `BundleSession` -> Skin Dock payload, not authored ActorVisualProfile -> Y9-2 runtime. |
| **GAP: Bundle/System Guide and workbench labels teach mixed or stale models** | Y9-2 launcher guide; pipeline-v3 `web/workbench.html` Panel 4b; `docs/plans/2026-03-23-workbench-canonical-spec.md` §2.10; `docs/plans/2026-06-09-workbench-prune-proposal.md` | User-facing surfaces still mix old template bundle language, May 12 `RenderPlanTable` language, and latest ActorVisualProfile generated-table language. Until the shared authoring seam exists, labels must distinguish "legacy Skin Dock preview" from "ActorVisualProfile artifact draft" and must not imply that pipeline-v3 profile JSON compiles into live Y9-2 runtime rows. The prune proposal is the remediation plan for current workbench labels and first-screen pruning. |

#### 2.5.1 Exact Live Gap Inventory By Surface

The rows above are the canonical misalignment ledger. This subsection turns them
into exact implementation gaps by live surface so Section 2 execution can be
queued without hand-waving.

| Surface | Live owner(s) | Exact gap | Must change in |
|---------|---------------|-----------|----------------|
| Bundle creation API | `src/pipeline_v2/app.py::api_wb_bundle_create()`, `src/pipeline_v2/service.py::create_bundle()` | Still takes `template_set_key` and seeds bundle state through legacy template-family language instead of a bundle blueprint / presentation-target contract | `UQ-004`, `UQ-010` |
| Conversion API | `src/pipeline_v2/app.py::api_wb_action_grid_apply()`, `src/pipeline_v2/service.py::bundle_action_run()` | Still accepts only `{bundle_id, action_key, source_path}`. There is no request artifact, no manifest path owner, and no separate intake / convert / register / compile phases | `UQ-006`, `UQ-010` |
| Session persistence / schema migration | `src/pipeline_v2/service.py::_session_payload()`, `src/pipeline_v2/service.py::workbench_save_session()`, session JSON on disk | New sessions now write normalized identity and legacy sessions now resolve `filename_prefix` / `skin_family` on read plus next-save persistence. Hardcoded `ahsw_range` maps deleted in `a58eda6`..`e23fd3f`. No remaining session-read normalization gaps. | `UQ-004` |
| Session persistence / source layout | `src/pipeline_v2/service.py::workbench_save_session()` | Still persists `source_boxes`, `source_cuts_v`, and `source_cuts_h` as saved authority | `UQ-006` |
| Registry authority | `src/pipeline_v2/service.py::create_bundle()`, `workbench_create_blank_session()`, `bundle_action_run()`, `workbench_export_bundle()`, `workbench_web_skin_bundle_payload()`, `web/workbench.js`, `src/pipeline_v2/service.py`, `web/termpp_skin_lab.js`, `runtime/termpp-skin-lab-static/termpp_skin_lab.js` | Template-driven backend gates and override-name generation all derive from the normalized registry. `ENABLED_FAMILIES` and the four `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` hardcoded maps are deleted. `preview_xp -> l0_ref` fallback fail-closed in this session. Remaining gaps: none for `UQ-004` registry authority scope. | `UQ-004` |
| Registry operator visibility | `src/pipeline_v2/service.py::load_template_registry()`, `src/pipeline_v2/app.py::api_wb_templates()`, `web/workbench.js::fetchTemplateRegistry()` | API/UI error surfacing exists via `registry_status`. Missing/malformed registry returns 503 with error details, browser surfaces a degraded-state warning. Empty truth is not cached — errors re-surface on each call. `preview_xp -> l0_ref` fallback was fail-closed. CLOSED. | `UQ-004` |
| Classic/runtime AHSW range truth | `config/template_registry.json`, `src/pipeline_v2/service.py`, `web/workbench.js`, `web/termpp_skin_lab.js`, `runtime/termpp-skin-lab-static/termpp_skin_lab.js` | `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` deleted in `a58eda6`..`e23fd3f`. All override-name paths now derive from `prefix_catalog.ahsw_range`. Normalizer drift-checks action-level mirror. Regression tests prove derivation via mutation. | `UQ-004` |
| Export-quality contract | `src/pipeline_v2/service.py::_run_structural_gates()`, `workbench_export_bundle()`, `workbench_web_skin_bundle_payload()` | Export/web payload paths now share live G7-G12 enforcement, but the canon still owes locked policy wording for export-time G9 populated-count semantics and for how low-coverage G8 should differ between manual authoring and autonomous flows | `UQ-005` |
| Headless validation surface | `scripts/workbench_mcp_server.py:435-452`, `src/pipeline_v2/app.py:645-660` | Canonical `validate-xp` route and MCP tool are live. `status`, `register-skin-request`, and `compile-skin-request` remain planned. | `UQ-005` (closed), `UQ-010` |
| Browser bundle UI | `web/workbench.html`, `web/workbench.js` | User-facing controls still speak in template/bundle-action terms and do not expose request-artifact lifecycle, manifest ownership, or explicit register/compile phases | `UQ-006`, `UQ-010` |
| Source panel UI | `web/workbench.html#source`, `web/workbench.js` source-box/cut handlers | Source slicing is interactive but not manifest-first; there is no explicit sidecar path, save/load status, or per-region presentation assignment workflow | `UQ-006` |
| Runtime identity layer | `config/runtime_identity_registry.json`, `bundle_contract.mjs`, backend create/export/payload contract, emitted bundle metadata | Pipeline-v3 has one live owner for `skin_definition_id`, `presentation_kind_id`, and `layer_definition_id`; string-only scope remains invalid without those IDs | `UQ-007` |
| Mounted-family parity | `config/template_registry.json`, mounted calibration/proposal service + MCP/browser surfaces, `web/workbench.html`, `web/workbench.js`, runtime scope helpers, Y9-2 bundle truth | `wolfie` / `wolack` are declared runtime prefixes with mounted template actions, native builders, authorability, and artifact-producing U2/U4 browser/backend flows. Runtime parity is still proof-blocked on `mounted_authoring_e2e` generated-row/no-fallback evidence | `UQ-008` |
| Deferred item/wearable surface | `bundle_contract.mjs`, `config/template_registry.json`, future template/runner surfaces | `world_item` and `inventory_grid` remain explicit blocker rows with no live authoring surface in pipeline-v3; they stay deferred rather than masquerading as a current blocking queue lane | `S2-FAM-04` |
| Y9-2 client parity | `scripts/pipeline/bundle_wizard/main.py` in Y9-2 vs `pipeline-v3` workbench routes | Y9-2 has a useful local request-artifact flow, but it is still a separate owner rather than a thin client over shared commands. The `FAMILY_W_RANGE` hardcoded maps that blocked `UQ-010` were deleted in `a58eda6`..`e23fd3f`. `UQ-010` is now unblocked by `UQ-004` but stays parked until `UQ-004` through `UQ-009` are green. | `UQ-010` |

#### 2.5.2 Locked Design Decisions For Section 2

The following design decisions are now fixed. Later implementation may refine
mechanics, but it may not reopen these decisions without a canon change.

1. Section 1 stays Section 1. The whole-sheet XP editor remains the root
   document owner. Section 2 may not absorb or redefine it.
2. The user-facing workflow shape stays familiar: upload, slice, drag, inspect,
   validate, and export/compile. The paradigm change is in naming and state
   ownership, not in making the tool fundamentally less direct.
3. `template set` / `action key` are no longer the canonical user-facing
   selection nouns. The replacement nouns are `bundle blueprint`,
   `presentation target`, `source manifest`, `materialized XP`, and
   `compile bundle`.
4. One versioned request artifact owns cross-presentation bundle-authoring
   progress. Per-presentation root sessions remain editable artifacts, but they
   do not become the cross-client workflow owner.
5. Separate-file and combined-sheet intake are both valid, but their authority
   differs:
   - separate-file intake may stay the easier default path
   - combined-sheet intake must use one canonical
     `<source>.asciicker-source.json` sidecar
6. Intake may be permissive; canonical mutation is not. Walk-only intake
   validation may pass, but register/compile for the current skin lane must
   require walk + attack + death coverage.
7. Every safety check that matters to users or agents must be reachable through
   the shared headless contract. No browser-only or launcher-only protection is
   allowed to remain authoritative.
8. Current-scope closure is still on-foot skin authoring. Wearables, items, and
   mounted-family authoring remain later rows and must not be pulled forward to
   avoid unresolved current-scope gaps.
9. Session-schema migration is in-place on load/save. Legacy `family` values
   may be accepted on read, but the next successful write must normalize to
   `filename_prefix` / `skin_family`; a one-time offline migration script is
   not part of the current queue.
10. Classic/runtime AHSW/range truth comes from registry
    `prefix_catalog[prefix].ahsw_range`. The former `FAMILY_W_RANGE` /
    `_FAMILY_W_RANGE` hardcoded maps were deleted in `a58eda6`..`e23fd3f`.
    Action-level `ahsw_range` in `template_sets` is mirror-only data,
    verified by the normalizer drift-check.
11. `UQ-007` is the runtime-identity row in this repo. It owns
    `skin_definition_id` / `presentation_kind_id` / `layer_definition_id`
    integration on the pipeline-v3 side; it is not the item/wearable authoring
    row.
12. `world_item` and `inventory_grid` stay deferred under `S2-FAM-04` after
    skin-authoring signoff unless canon is changed explicitly. Keeping those
    rows visible in contract helpers is allowed; promoting them into the
    current blocking queue is not.

#### 2.5.3 Required UI Changes

Section 2 UI changes are now specific enough to execute. These are not optional
polish; they are the visible shape of the ownership cutover.

| Current UI surface | Required change | Why |
|--------------------|-----------------|-----|
| `templateSelect` + `Apply Template` | Keep the basic entry control but rename/reframe it as blueprint selection and bundle-authoring start. The action must create or load a bundle-authoring request context, not sell itself as template application. | Removes false template-first product language while preserving a familiar top-of-workflow action |
| `bundleActionTabs` | Rename and restyle as presentation-target coverage tabs/status chips. Status must show coverage and workflow state, not only converted/saved action state. | The user is authoring bundle contributions, not isolated template actions |
| `templateGuide`, `templateStatus`, `uploadPanelLabel` copy | Rewrite around `Single XP` vs `Bundle Authoring` modes, and around intake / convert / register / compile phases. Remove "Bundle mode" and "Classic workflow" copy that still assumes template-first semantics. | Product language must match the new owner model |
| Upload + Convert panel | Split one overloaded panel into explicit staged actions: `Validate Intake`, `Convert`, `Register Dry-Run`, `Register`, `Compile Bundle`, and `Validate XP`. | The current single `Convert to XP` button hides the real lifecycle and cannot represent Y9-2 parity |
| Source Panel | Add explicit manifest status/path, save/load sidecar affordances, per-region target assignment, and clear derived-vs-authoritative guide labeling. | Source slicing must become canonical-manifest-first rather than session-box-first |
| Bundle status area | Add request-artifact summary: current blueprint, coverage completeness, blockers, next steps, copied assets, and compile result/provenance. | Browser users need the same state model headless clients use |
| Whole-sheet panel helper text | Keep Section 1 as primary surface, but explain that Save marks presentation progress while register/compile mutate bundle-level state. | Preserves Section 1 ownership while clarifying Section 2 workflow |
| Runtime test controls | Keep runtime proof controls, but disable bundle-level runtime actions based on shared bundle-authoring readiness rather than ad hoc local action-tab heuristics. | Runtime gating must reflect the shared contract, not UI-local guesses |

#### 2.5.4 Open Section-2 Contract Slices

Section 2 open work is decomposed into the following contract slices. Literal
row order, state, and stop conditions live only in Unified Sequence Of Actions.

| Slice | Parent row | Files / surfaces | Required closure | Closure condition |
|-------|------------|------------------|------------------|-------------------|
| `S2-R1` | `UQ-004` | `src/pipeline_v2/service.py`, session JSON on disk, `tests/test_template_registry_schema.py`, bundle/runtime/export tests | One registry-derived backend helper owns bundle create, blank-session create, bundle run, export, and web-skin payload identity, and legacy session `family` values normalize on load/save. | No live Section 2 backend branch takes authority from compat family fields, and newly written sessions no longer depend on legacy `family` as primary identity |
| `S2-R2` | `UQ-004` | `load_template_registry()`, `web/workbench.js::fetchTemplateRegistry()` | Registry load/fetch failures are operator-visible and fail-closed for authoring surfaces instead of silently caching empty truth. | Registry errors are explicit in backend responses and visible in the UI |
| `S2-R3` | `UQ-005` | `src/pipeline_v2/service.py` gate/export paths | One shared quality evaluator gates export-bundle and web-skin payload generation in addition to convert-time checks, and export-time `G9` measures populated visual cells rather than dense-array length. | Export/web payload reject the same failures the quality contract defines, and export-time `G9` is no longer a dead gate |
| `S2-R4` | `UQ-005` | quality contract docs + gate code | `G8`/`G9` threshold policy and report shape are fixed across browser, MCP, and CI. G8 threshold `_G8_MIN_RATIO=0.05` locked. G9 safety-net gate documented. | `validate-xp`, export, and payload paths use the same `PASS`/`FAIL` semantics and the same threshold/report fields |
| `S2-R5` | `UQ-006` | source-manifest library + session save/load | Real sidecar read/write/materialize plumbing exists, and `source_boxes` / `source_cuts_*` are demoted to derived mirror state. | Session save/load no longer owns combined-sheet slicing |
| `S2-R6` | `UQ-006` | `web/workbench.html`, `web/workbench.js` source panel | The source panel is manifest-first, with sidecar status and per-region target assignment, while preserving the current direct slicer feel. | Browser slicing edits one manifest contract rather than local-only arrays |
| `S2-R7` | `UQ-006` | shared headless surface | Shared mark/materialize/validate/status commands exist over the same manifest contract for agents and CLI. | Agent and browser paths hit the same source-authoring contract |
| `S2-R8` | `UQ-007` | bundle/runtime contract helper, backend register/compile/export surfaces, ID-bearing test fixtures | One live pipeline-v3 runtime identity layer exists for `skin_definition_id`, `presentation_kind_id`, and `layer_definition_id`, keyed off normalized registry/blueprint truth rather than string-only scope. | Runtime identity is no longer explanatory-doc-only; bundle helper, backend outputs, and proof surfaces share one ID layer |
| `S2-R9` | `UQ-008` | mounted authoring/runtime proof | Mounted presentation-target surfaces and builders exist for `wolfie` and `wolack`. The mounted authoring aids are explicit sub-slices: `U2` = browser overlay-calibration panel on top of the existing backend/MCP calibration artifact flow; `U4` frontend = browser semantic cell review panel on top of the existing backend/MCP exact-cell proposal flow. Both aids remain proposal-first and human-confirmed, stay sibling surfaces to the existing jitter owner, and write artifacts rather than XP mutations. | Mounted rows are authorable on the live contract, mounted semantic/alignment authoring no longer depends on opaque manual notes or destructive jitter edits, and final parity remains proof-blocked on `mounted_authoring_e2e` runtime evidence |
| `S2-R10` | `UQ-010` | shared CLI/API surface + clients | Implement one shared request-artifact/headless contract for `phase0-status`, `phase0-build`, `validate-skin-intake`, `convert-skin-request`, `register-skin-request`, `compile-skin-request`, `validate-xp`, and `status`. | Browser, MCP, Y9-2 launcher/wizard, and manual CLI become thin clients over one owner |

#### 2.5.4.1 Resolved Design Policy For The Remaining Open Section-2 Rows

These decisions were still implicit in earlier Section 2 text. They are now
fixed so `UQ-004` and `UQ-005` can execute without reopening design.

1. Legacy session migration is in-place:
   - read old `family`
   - resolve normalized identity through registry truth
   - write back normalized `filename_prefix` / `skin_family` on the next
     successful save or rewrite
   - keep `family` only as compatibility/mirror data during the migration
2. Classic/runtime range truth is not a second owner:
   - `ahsw_range` in the normalized registry is the authority
   - any `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` style compatibility map must be
     temporary scaffolding only; all four such maps were deleted in
     `a58eda6`..`e23fd3f` and must not be reintroduced
3. Export-time `G9` uses populated visual-layer cell count:
   - do **not** use dense `cols * rows` array length at export time
   - use populated non-space cells from the authoritative visual layer for the
     current materialized XP
4. Current `G8` threshold policy is split by workflow class:
   - `<5%` populated ratio is a `FAIL` for autonomous convert/register/compile
     flows in the bundle-authoring request path
   - the same low ratio is a `WARN` for generic hand-edited root-document XP
     export unless a stricter blueprint/presentation contract explicitly marks
     the target as required-nonempty
5. Deferred item/wearable rows remain visible but non-blocking:
   - `world_item` and `inventory_grid` stay explicit blocker rows in helpers
     and docs
   - they do not define the current `UQ-007` deliverable

#### 2.5.4.2 Mounted Authoring Aids Baseline, Frontend Sub-Slices, And Invariants

`UQ-008` / `S2-R9` is not allowed to hide the mounted authoring aids behind
generic phrases like "semantic review later" or "overlay calibration mode." The
cross-repo baseline and the remaining browser gap are now fixed.

1. Y9-2 audit baseline for mounted artifact shape (updated 2026-04-29 after
   cross-repo audit against FL-2345 through FL-2500):
   - `scripts/pipeline/mounted_wrapper_mask_selector.py` (v2, 1535 lines) is a
     wrapper mask authoring tool keyed by exact sprite/layer/angle/anim/frame/
     proj/wrapper-role tuples. v2 capabilities: WASD cursor, X toggle, box
     select, flood fill, flood-by-glyph, select-all-glyph, select-non-
     transparent, invert, paint mode, undo ring (20-item), 5 comparison modes
     (single, front+rear, angle-mirror, diff, mount+rider), queue mode for
     multi-angle batch authoring, semantic overlay, glyph panel. The canonical
     artifact-coordinate example is:
     `python3 scripts/pipeline/mounted_wrapper_mask_selector.py --sprite wolfie-body.xp --layer 2 --angle 1 --anim 0 --frame 0 --proj 0 --wrapper-role mount_rear`
   - `scripts/pipeline/xp_semantic_atlas_reviewer.py` uses explicit mounted
     wrapper-role vocabulary (`mount_rear`, `mount_front`) and semantic owner
     vocabulary (`rider`, `mount`, `empty`, `mixed`, `unclear`) with explicit
     review/promotion arguments rather than silent heuristics.
   - `scripts/pipeline/mounted_semantic_proposals.py` builds evidence-tagged
     exact-cell proposals from residual compare. Cell buckets:
     `mount_rear_surface`, `mount_front_surface`, `rider_visible_match`,
     `unresolved_shared_exact`, `unresolved_mount_delta`. Evidence tags:
     `sibling_cooccurrence_confirmed/absent`, `angle_persistent_N`,
     `ahsw_stable/variant_only`, `rider_offset_solved`, `translated_overlap`.
   - Full Y9-2 mounted pipeline script inventory:
     - `mounted_wrapper_mask_selector.py` - interactive wrapper role authoring
     - `xp_semantic_atlas_reviewer.py` - TTY semantic atlas review
     - `mounted_semantic_proposals.py` - evidence-tagged cell proposals
     - `generate_mounted_wrapper_assets.py` - wrapper XP generation from masks
     - `promote_mounted_wrapper_offsets.py` - offset promotion to sidecar
     - `promote_mounted_wrapper_reviews.py` - review promotion to sidecar
     - `mounted_wrapper_unresolved.py` - fail-closed unresolved reporter
     - `mounted_rider_offset.py` - core offset computation (shared with PV3)
     - `mounted_rider_residual_compare.py` - residual subtraction (shared)
   - Pipeline-v3 does not need to copy the Y9-2 TTY UI, but it must inherit the
     same artifact law: exact artifact coordinates, explicit wrapper-role
     naming (`mount_front` / `mount_rear`), explicit semantic owner vocabulary
     (`rider` / `mount` / `empty` / `mixed` / `unclear`), and explicit
     review/confirmation before promotion.
2. Current live pipeline-v3 split:
   - backend + MCP foundations for mounted aids are already present:
     calibration compute route/tool, exact-cell proposal route/tool, and session
     persistence for `mounted_rider_calibration` plus
     `mounted_semantic_review`
   - the browser/workbench frontend is not present yet: `web/workbench.html`
     still exposes only the old `Frame Jitter` section, and `web/workbench.js`
     still routes all mounted-position editing through destructive
     `shiftFrameContents()` / `commitWholeSheetDocumentMutation()` jitter paths
3. `U2` frontend is a required `S2-R9` sub-slice, not optional polish:
   - a dedicated workbench panel exists for non-destructive rider/mount overlay
     calibration
   - the panel renders to its own canvas and writes a calibration artifact only
     on explicit accept
   - the panel consumes the shared mounted-calibration backend/MCP artifact
     shape rather than inventing a browser-only offset format
4. `U4` frontend is a required `S2-R9` sub-slice, not optional polish:
   - a dedicated workbench panel exists for exact-cell semantic review
   - proposals come from the shared backend/MCP exact-cell route and are
     displayed as review data, not auto-applied document mutations
   - browser writes to `mounted_semantic_review` only happen through an
     explicit Confirm path after the user marks the proposals reviewed
5. These invariants are locked until full `UQ-008` runtime-proof closure:
   - `config/template_registry.json` entries for `wolfie` and `wolack` are
     `authorable: true` only because UQ-007 identity, mounted native builders,
     and mounted template actions landed together; backend/MCP/browser artifact
     aids alone are not a legal reason to flip authorability
   - the current jitter panel and its destructive owner functions stay intact;
     mounted calibration is additive and must not repurpose or silently rewrite
     `nudgeSelectedFrames()` / `autoAlignFrameJitter()`
   - browser semantic confirmation remains an explicit reviewed-then-confirm
     path, while headless acceptance requires explicit
     `reviewer_action: "accept"`
   - session load/save must continue to round-trip
     `mounted_rider_calibration` and `mounted_semantic_review` exactly; these
     artifacts are durable prerequisites, not transient UI-only guesses
6. U2/U4 placement clarification (2026-06-13):
   - U2/U4 are required mounted-authoring surfaces, not optional debug controls.
   - They may move out of the mobile first screen, but only into a named
     `Mounted Authoring` drawer/panel with the required artifact and explicit
     confirmation semantics intact.
   - They must not be hidden in a generic Advanced bucket that makes required
     S2-R9 work look like diagnostic clutter.

#### 2.5.5 Queue Crosswalk

Literal execution order, row state, and stop conditions live only in Unified
Sequence Of Actions. This subsection records the Section 2 contract-to-queue
mapping only.

| Queue row | Section 2 slice coverage |
|-----------|--------------------------|
| `UQ-004` | `S2-R1`, `S2-R2` |
| `UQ-005` | `S2-R3`, `S2-R4` |
| `UQ-006` | `S2-R5`, `S2-R6`, `S2-R7` |
| `UQ-007` | `S2-R8` |
| `UQ-008` | `S2-R9` |
| `UQ-009` | Section 3 support/proof follow-through for landed Section 2 surfaces |
| `UQ-010` | `S2-R10` |
| `UQ-014` | `S2-PRINT-01` / `FL-PRINT-01` printable authoring grid paper side feature |

`world_item` / `inventory_grid` remain explicit deferred follow-through under
`S2-FAM-04`; they are visible in the contract but are not promoted into the
current blocking Section 2 row set by this crosswalk.

### 2.6 Section-2 Scope Boundary

Section 2 must respect the following boundary:

1. The game engine selects sprites by filename and family/state rules.
2. The workbench wrapper may help author and inject those files.
3. The wrapper must not pretend its template model is the engine truth.
4. The wrapper must not pretend its action/bundle flow is the editor truth.
5. Family expansion and runtime parity are wrapper responsibilities only after Section 1 ownership is correct.

This means:

- bundle blueprints and presentation targets are authoring constraints, not engine law
- bundle/session/presentation state is workbench state management, not runtime truth
- runtime proof is wrapper proof, not proof that the root editor architecture is correct

### 2.6.1 Printable Authoring Grid Paper Side Feature (`S2-PRINT-01` / `FL-PRINT-01`)

This is a Section 2 side feature because it is an authoring aid for wrapper /
Y9-2 sprite production. It must not become a second editor owner and must not
override template registry, semantic map, or source-manifest truth.

User seed (2026-06-11): an earlier `sprite-sheet-full.html` concept opened in
Chrome and attempted to put a full sheet on one letter page with a grayscale
underdrawing, cell grid, thicker frame boundaries, angle labels, frame numbers,
fiducials, calibration strip, footer, and OMR bubbles. That artifact is not
authoritative: the stated `126x72` sheet, `7.5in x 4.3in` image, `1.5mm` cells,
`6`-column / `9`-row frame cadence, and `0..20` frame labels are layout guesses.
The idea is valid; the geometry is not.

Correct target contract:

1. The generator derives sheet size, frame grid, angle labels, frame labels,
   cell dimensions, and action rows from the same registry/template/source
   authority used by Section 2 authoring. It must not hardcode `126x72`, `6x9`,
   or `21` frames unless the selected template proves those values.
2. Output is a printable HTML/PDF artifact for human sketch/review, not a
   runtime artifact and not proof of Y9-2 integration.
3. The page includes:
   - grayscale underdrawing from the selected XP/template layer
   - per-cell grid lines plus thicker semantic frame/action boundaries
   - angle/action/frame labels derived from the selected template
   - fiducials and a calibration strip suitable for scan/camera correction
   - optional review bubbles / notes only if the corresponding import/review
     path consumes them explicitly
4. Any scan-back or camera-back import is a future explicit sub-feature. Until
   then, printable grid paper is a manual authoring worksheet only.
5. The implementation belongs after the source-manifest/template geometry owner
   is stable enough to emit the paper from one source of truth.

### 2.7 Section-2 Behavior Tree

The canonical Section 2 wrapper behavior tree is:

1. author or load an XP image through Section 1
2. optionally use source-wrapper tools to mark/import sheet content
3. map authored XP into bundle blueprint / presentation-target wrappers
4. run structural gates for engine-safe export
5. export single XP or compile a bundle contribution
6. inject/test via:
   - web Skin Dock/runtime iframe
   - native TERM++ sandbox launcher
7. observe runtime/failure results
8. return to Section 1 editor ownership for correction

**AUDITOR FOUND (2026-04-15, updated 2026-04-27):** Step 2 of the behavior tree is designed but still not implemented as one shared owner. The authoritative future path is manifest-driven: UI slicer edits and MCP/HTTP/CLI edits must all write the same sidecar manifest and then materialize the result into the root editor. Until `UQ-006` lands and the remaining `UQ-010` front doors are wired, agent automation is still operationally blocked on missing tools, and the blocking issue is ownership plus implementation rather than undefined design.

**Y9-2 dual-path note:** There are now two partial client paths, but they do not yet converge on one truthful backend owner:
- **Human TUI path today:** Y9-2 launcher-adjacent/local CLI wizard → Y9-2 bundle-wizard code → local request artifact / bundle compile flow.
- **Workbench path today:** browser or MCP → pipeline-v3 `/api/workbench/*` surfaces.
The required end state is different: both human and agent clients must share the same manifest/materialize/validate/register/compile commands. Step 2 (source region marking) remains the human-only bottleneck until the Step 5 design contract in Section 2.3.1-2.3.4 is implemented and a shared headless mark/materialize surface is added under `UQ-006` / `UQ-010`. Before that synchrony work, `UQ-004` had to delete the surviving local hardcoded `ahsw_range` owners so the future thin clients are not wired onto split local override truth. The four `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`; `UQ-010` is now unblocked by `UQ-004`.

### 2.8 Section-2 Rebuild Update (2026-04-15)

The current Section 2 rebuild on top of the root-editor owner graph now has
these explicit contracts:

1. **Root-session save contract**
   - the whole-sheet/root-editor save path must persist `grid_cols`,
     `grid_rows`, `cell_w`, `cell_h`, full layers/cells, and canonical source
     manifest authority (`source_manifest_path`, `source_manifest`)
   - Section 2 wrapper state must not keep a stale geometry owner or any legacy
     source-overlay owner after the root editor changes the document
2. **Single-session runtime proof scope**
   - Skin Dock/web runtime proof must declare one explicit `runtime_scope`
   - `player_only` = safest single-session smoke for player filenames only
   - `mounted_default` = existing wrapper inventory / preview scope (`player`,
     `wolfie`, `wolack`); it is not mounted authoring proof
   - `mounted_authoring_e2e` = required UQ-008 proof lane for newly authored
     mounted output generated by pipeline-v3 and selected by Y9-2 runtime rows
   - `full_parity` = debug-only five-family override scope
3. **Bundle/runtime flow**
   - bundle payloads do not use the single-session scope selector
   - bundle payload generation remains per-action/per-family
   - G10-G12 structural gates must pass before bundle runtime injection
4. **Proof separation**
   - built-in local XP sanity is structural proof only
   - Skin Dock and TERM++ command/native launch are runtime proof paths
   - neither structural proof nor runtime proof establishes Section 1
     ownership

### 2.9 Research Requirements And Decisions

This subsection folds the Section 2 research requirement into the wrapper spec.
The relevant research area is local Asciicker engine truth:

1. mounted family authoring requirements
2. runtime filename coverage vs active workbench family coverage
3. proof harness requirements for unambiguous skin application

#### 2.9.1 Mounted-Family / Runtime Scope Decision

Evidence:

- Runtime naming and override logic already cover `player`, `attack`,
  `plydie`, `wolfie`, and `wolack`:
  `src/pipeline_v2/service.py`, `runtime/termpp-skin-lab-static/termpp_skin_lab.js`,
  and `web/workbench.js`.
- (updated 2026-05-11) Active workbench phase gating now derives authority from
  the normalized registry via `is_action_authorized()` / `is_prefix_authorized()`
  (commit `e40adda`). The hardcoded `ENABLED_FAMILIES` gate no longer exists.
  wolfie/wolack are `authorable: true` only after UQ-007 runtime identity,
  native mounted builders, and mounted template actions landed together.
- `web/workbench.js` documents that mounted default preview uses
  `player + wolfie + wolack`, while `full_parity` is debug-only because the
  override path is FS-global and can bleed into NPCs.
- Current verification profiles still separate local structural sanity from
  runtime proof in `src/pipeline_v2/service.py`.
- (added 2026-04-29) Y9-2 has completed mounted wrapper baseline authoring
  toolchain: mask selector v2 landed (commit `42d7b744`), wolf idle wrapper
  assets landed (commit `d4b236d9`), baseline completion for all mount targets
  landed (commit `09ae3fc3`), ref-aligned mounted wrapper composition fixed
  (commit `ff7fb970`). The Y9-2 toolchain now covers mask authoring, semantic
  proposals, semantic review, wrapper asset generation, offset/review promotion,
  and unresolved reporting across 9 pipeline scripts.

Decision (inference from sources):

1. Do not treat mounted-family runtime coverage and workbench authoring coverage
   as already aligned. They are not - but the gap is now narrower than when this
   section was first written. Y9-2 has closed the TTY-side authoring toolchain;
   the remaining gap is pipeline-v3 native builder support and browser UI.
2. Shipping authoring scope stays narrower than raw runtime filename truth until
   create/export/apply/verify all cover the same family set.
3. Runtime proof must be two-stage:
   - stage 1: structural XP sanity/export checks
   - stage 2: explicit runtime application proof with isolated override names
   For UQ-008, stage 2 is the `mounted_authoring_e2e` lane: it starts from
   pipeline-v3 generated mounted XP, binds semantic anchors/review artifacts to
   that exact output, emits Y9-2 bundle rows with server-owned V2 IDs, passes
   runtime parser acceptance, selects those generated rows at runtime, and
   proves no legacy sprite fallback was used. Current Y9-2
   `mounted_compose_parity_check.py --smoke` style evidence is existing wrapper
   inventory proof only; it cannot replace this lane.
4. `full_parity` remains debug-only until the NPC/shared-filename contamination
   risk is removed. It is not valid as the default acceptance path.
5. The default proof path for user-facing work should prefer the smallest
   unambiguous override set possible, then expand only when mounted-family
   authoring and verification are reconciled.
6. The remaining reconciliation work for pipeline-v3 is:
   - add mounted native builder to `_build_native_layers()` (wolfie/wolack)
   - inherit Y9-2 wrapper role vocabulary (`mount_front` / `mount_rear`) and
     semantic owner vocabulary (`rider` / `mount` / `empty` / `mixed` /
     `unclear`) as codified constants
   - build browser U2 (calibration overlay) and U4 (semantic review) panels
   - add structural-contract runners for family/prefix/fallback/wearable parity
   - only then flip `authorable: true` and expand runtime acceptance claims
7. UQ-008 requires a `mounted_authoring_e2e` proof mode in addition to the
   existing wrapper-inventory smoke. The mode is incomplete until it can carry:
   - generated pipeline-v3 mounted XP for `wolfie` and `wolack`
   - semantic anchors/review artifacts tied to that generated output
   - emitted Y9-2 bundle rows with server-owned V2 IDs
   - runtime parser acceptance
   - runtime selection of those generated rows
   - explicit no-legacy-sprite-fallback evidence
8. `config/runtime_identity_registry.json` is the single UQ-007 owner for
   `skin_definition_id`, `presentation_kind_id`, and `layer_definition_id`.
   `bundle_contract.mjs`, template-owned sessions, bundle creation, bundle
   export, and runtime payloads must consume those IDs directly. String-only
   `family`, `runtime_role`, or normalized registry metadata cannot satisfy
   runtime parity without these V2 IDs.

Sources:

- `src/pipeline_v2/service.py`
- `runtime/termpp-skin-lab-static/termpp_skin_lab.js`
- `web/workbench.js`
- Y9-2 `scripts/pipeline/` mounted toolchain (9 scripts, FL-2345 through FL-2500)

### 2.10 Y9-2 Bundle-Authoring Integration Contract

The Y9-2 repo (`asciicker-Y9-2`) now has a real local bundle-authoring slice in
`scripts/pipeline/bundle_wizard/main.py`. That work is useful, but it is not
the final Section 2 owner. This subsection defines the shared headless contract
pipeline-v3 must expose so that Y9-2 launcher flows, MCP tools, CI, browser
helpers, and manual terminal usage all hit the same bundle-authoring behavior
instead of creating parallel owners.

> **STATUS: PLANNED / DEFERRED (2026-05-03).** All commands in this section
> are a design-only target contract. No code in `src/pipeline_v2/app.py` or
> `service.py` backs any of the S2-R10 command names below. The live backend
> exposes a different workbench-oriented API surface (see "Live workbench API
> surface" note at the end of this subsection). Do not treat this command table
> as current shipped API. UQ-010 is PARKED pending earlier-layer closure.

**Current boundary from live Y9-2 code:** intake may accept partially supplied
body art, but canonical registration/compile may not. In the current wizard,
`_bundle_request_ready_for_registration()` requires converted walk, attack, and
death XP before canonical registration runs. That boundary is preserved here:
walk-only intake validation may exist, but register/compile is full-coverage
only for the current skin lane.

**Integration model:** the shared owner is a versioned request-artifact flow
that authors bundle contributions rather than standalone per-action assets. Browser UI,
CLI, launcher, MCP, and CI are thin clients over that flow. Section 1 remains
the root XP editor; Section 2 adds the bundle-authoring wrapper around it.

**Refactor note (2026-06-09):** The command semantics below were written against
the old selector-driven bundle model and then partially amended for the May 12
`RenderPlanTable` transition. Latest fetched Y9-2 `origin/main` has moved again:
production rows are compiled by `scripts/compile_actor_visual_profiles.py` into
ActorVisualProfile generated-table artifacts, and that compiler explicitly does
not consume authored profile JSON. Therefore the shared command contract must be
phrased by semantic obligation, not by the obsolete output filename
`render_plans.json`. The Y9-2 launcher Bundle Mods menu labels (`New Bundle
Item`, `Import Assets`, `Draft Manifest`, `Compile Bundle`, `Preview`, `Verify`)
map to the target operations as follows:

| Old launcher label | New operation under §2.15 |
|--------------------|--------------------------|
| Import Assets | import content artifact + validate content DB entry |
| Draft Manifest | author `ActorVisualProfile` fields (skin/variation/slot assignments) |
| Compile Bundle | compile server-reachable actor visual rows into the current Y9-2 runtime table artifact |
| Preview | preview exact compiled layer stack (body/wearables/mount) |
| Verify | verify runtime accepts the compiled actor visual table and headed proof exercises the claimed content path |

These labels have not been renamed in live code. The guide and launcher label
updates must now target the ActorVisualProfile generated-table model rather than
the older selector-bundle or May 12 `render_plans.json` transition wording.

**Required shared headless surface:** the product must converge on one
authoritative CLI/API contract with at least these command semantics:

| Command | Purpose | Mutation | Status |
|---------|---------|----------|--------|
| `phase0-status` | inspect semantic-dict/reference state | no | `planned_only` - no route exists |
| `phase0-build` | refresh semantic-dict/reference state | yes | `planned_only` - no route exists |
| `validate-skin-intake` | validate source PNG geometry/coverage for the skin lane | no | `planned_only` - no route exists |
| `convert-skin-request` | convert walk/attack/death PNG inputs into staged XP and update the request artifact | yes | `planned_only` - no route exists |
| `register-skin-request` | dry-run or perform canonical registration into bundle source + sprite destinations | yes | `planned_only` - no route exists |
| `compile-skin-request` | compile canonical actor visual runtime artifacts from a registered request; exact output files may differ by Y9-2 generation model, but the result must be runtime-accepted and provenance-stable | yes | `planned_only` - no route exists |
| `validate-xp` | run XP-only G7-G12 validation without requiring bundle/session context | no | `planned_only` - no route exists |
| `status` | inspect request artifact state, blockers, next steps, and provenance | no | `planned_only` - no route exists |
| `verify-runtime-table` | invoke the Y9-2 runtime acceptance path against the emitted actor visual table artifacts and confirm headed proof for the claimed content path | no | `planned_only` - does not exist |

The API naming may differ from the CLI verb spelling, but the semantics and
validation rules must be identical. There must not be a browser-only, MCP-only,
or launcher-only safety check.

**Required request-artifact contract:**

- every mutating flow reads and writes one versioned JSON artifact
- the skin lane artifact records intake, convert, register, and compile status
- the artifact is the resumable state handoff between human and agent clients
- the artifact must be stable enough for dry-run, resume, and replay workflows

**Required skin-lane inputs:**

- `--skin-slug`
- `--skin-label`
- `--walk-png`
- `--attack-png`
- `--death-png`
- `--angles`
- `--walk-frames`
- `--request PATH`

Normalized identity remains registry-owned. No new surface may take legacy
`family` as authoritative input. `filename_prefix` / `skin_family` must come
from normalized registry truth or blueprint selection, not from caller-supplied
legacy family strings.

**Required lifecycle boundary:**

- intake validation may run with incomplete body coverage
- convert may stage partial work for human iteration
- canonical register must require full walk + attack + death coverage
- canonical compile must require a registered full-coverage request

**Required output contract:**

- stable machine-readable JSON on stdout with `--json`
- updated request artifact on disk
- explicit `status`
- explicit `next_steps`
- provenance fields for staged XP paths, checksums, diagnostics, copied sprite
  paths, bundle source path, allocated IDs, compile hashes, and generated files

**Required validation contract:**

- intake validation is callable without mutation
- XP validation is callable without bundle/session context
- attack/death get the same explicit validation surface as walk
- G7-G12 semantics and thresholds are documented and stable

**Required mutation contract:**

- register supports `--dry-run`
- no canonical sprite copy before dry-run validation passes
- rollback preserves the original error and remains atomic
- compile must not leave partial current outputs on failure

**Required source-layout contract:**

- combined-sheet flows use one canonical source-layout manifest
- session-local `source_boxes` / `source_cuts_v` / `source_cuts_h` cannot remain
  authoritative

**Required parity and honesty rules:**

- launcher, MCP, CI, browser helpers, and manual terminal usage must hit the
  same commands and the same validations
- if a backend route/tool does not exist, docs/spec/MCP must not claim it exists
- if Y9-2 local code still owns a step during migration, that temporary
  ownership must be stated explicitly

**Live workbench API surface (current truth):** The actual live backend routes
in `src/pipeline_v2/app.py` are organized around the workbench UI, not the
shared headless gateway:

- `/healthz` - health check
- `/api/run`, `/api/status/<job_id>`, `/api/upload`, `/api/analyze` - legacy
  pipeline run/status flow
- `/api/workbench/templates` - template registry
- `/api/workbench/bundle/create` - bundle creation
- `/api/workbench/action-grid/apply` - action-grid source apply
- `/api/workbench/export-bundle` - bundle export
- `/api/workbench/web-skin-bundle-payload` - bundle web-skin payload
- `/api/workbench/run-verification` - session verification
- `/api/workbench/*/browse/*` - session CRUD
- `/api/workbench/*/session/*` - session lifecycle (save, load, create-blank,
  export-xp, upload-xp, termpp-stream, mounted-calibration,
  mounted-semantic/review)

This is the live owner. The S2-R10 command set above is a planned target that
would add `phase0-status`, `phase0-build`, `validate-skin-intake`,
`convert-skin-request`, `register-skin-request`, `compile-skin-request`,
`validate-xp`, and `status` as shared commands. Do not claim the shared
headless contract is the current shipped API.

**Current state:** Y9-2 now provides a useful local request-artifact wizard for
the skin lane, but pipeline-v3 still exposes the workbench-backed routes above
rather than the shared headless bundle-authoring surface defined in this
section. Cross-tracked in Y9-2 canon spec Section 2 [5] as DESIGN
OPEN B-12 (API contract hardening), B-13 (launcher wiring), and B-14 (agent
gateway scope). This remains an ownership and contract gap, not launcher paint.

**Clarification (2026-05-03):** The statement "no shared headless API contract
exists in either repo's code" is false if applied at the repo level. Pipeline-v3
has a live backend API surface. The narrower truth is: the spec-defined shared
bundle-authoring headless contract (Section 2.10 / S2-R10) is not implemented
in either repo. The live workbench routes are not the same contract as the
future shared gateway.

---

## Section 3 - User-Reachable Action Harness Spec

This section defines the acceptance harness for the shipped workbench UI. It
exists because the product surface is a many-action editor and UI regressions
are easy to hide behind narrow scripted demos. The harness must prove that
real user-reachable actions can drive the editor from valid starting states to
valid goal artifacts. It is not an XP repaint oracle, not an inspector
replayer, and not a license to mutate browser state through hidden debug hooks
and call that acceptance.

Section 3 also defines the required relationship between acceptance runners and
backend structural-contract runners. Acceptance remains UI-only. Structural
contract runners are required for family/wearable schema parity, but they do
not count as acceptance.

### 3.1 Purpose And Terminology

The correct model is:

1. **User-Reachable Action Graph**
   - the complete action surface a real user can reach in the shipped UI,
     including controls that only appear after prior actions such as tabs,
     context menus, tool modes, drawers, modal buttons, and submenu items
2. **Goal Artifact Contract**
   - the golden artifact set that defines success for a workflow, such as an
     exact XP sheet, a bundle payload, or a mounted runtime result derived from
     a representative input set
3. **Recipe Synthesizer**
   - the planner that chooses valid action sequences from the action graph
     toward the goal artifact contract
4. **Runner**
   - the executor that performs those actions through real browser gestures and
     records checkpoints, artifacts, and failure evidence

This replaces the older "truth table -> repaint recipe" framing. The old
truth-table lane described XP cells directly and then generated layer-2-centric
repaint steps. That model is not authoritative for a modern whole-sheet-root
editor because the acceptance problem is not "can we repaint these cells?" The
acceptance problem is "can a real user, through the shipped UI, reach the
required artifact state without cheating?"

### 3.2 Authoritative Inputs

The harness has two acceptance inputs and one required supporting structural
contract input.

1. **Input A: User-Reachable Action Graph**
   - authoritative inventory of every user-reachable action
   - each action entry must declare:
     - stable `action_id`
     - user-facing label or semantic purpose
     - gesture type (`click`, `fill`, `check`, `keypress`, `canvasClick`,
       `canvasDrag`, `contextMenu`, or equivalent future additions)
     - target selector or gesture target
     - preconditions
     - postconditions / expected state deltas
     - whether the action is acceptance-eligible
     - whether the action is eligible for bounded random exploration
     - whether the action is blocked by missing design or missing runner
       support
   - actions revealed only after prior actions are still first-class members of
     the graph; they are not optional edge cases

2. **Input B: Goal Artifact Contract**
   - authoritative definition of the finished target
   - each goal case must declare:
     - starting state contract
     - required checkpoints
     - final artifact comparator
     - allowed tolerances, if any
     - required export/runtime proof stage, if any
   - for this product, goal cases must include both:
     - recreation of a known-good XP sheet from a blank XP/root session path
     - recreation of a known-good XP sheet or bundle from representative PNG
       source sheets through the Section 2 wrapper path
   - the input list must be extensible. Refactors or new template sets must be
     able to add new goal cases without rewriting the harness model.

3. **Input C: Engine/Backend Structural Contract**
   - authoritative machine-readable contract for the non-UI proof surface
   - must cover at minimum:
     - `skin_family`
     - `filename_prefix`
     - `fallback_family`
     - mounted-family inclusion/exclusion
     - wearable slot ids
     - wearable style ids
     - expected template/action metadata for every authorable prefix
   - this input may be derived from the normalized template registry plus a
     checked contract helper, but it must not be re-handwritten separately in
     each runner
   - this input is required for backend parity runners and for recipe/goal
     synthesis, but it does not by itself constitute acceptance proof

### 3.3 Recipe Synthesizer Contract

The recipe synthesizer is a state-transition planner, not a brute-force
Cartesian enumerator and not a machine-learning authority.

1. It consumes:
   - the current editor/workflow state
   - the User-Reachable Action Graph
   - one Goal Artifact Contract
   - an optional seed and search budget
2. It emits:
   - a valid user-reachable recipe
   - deterministic checkpoint boundaries
   - any bounded random-exploration windows inserted between checkpoints
3. It chooses actions by planning over state transitions:
   - actions map to reachable state deltas and prerequisite satisfaction, not
     directly to target pixels
   - a good next action is one that satisfies a missing prerequisite, advances
     to the next checkpoint, or measurably reduces distance to the goal
4. Bounded random exploration is mandatory as a first-class mode:
   - the synthesizer may inject short seeded random segments between scripted
     checkpoints
   - random segments may only choose actions whose preconditions currently hold
   - random segments must have explicit length and seed recorded in the report
   - random exploration is for reachable-surface coverage, not for replacing
     the deterministic checkpoint contract
5. Acceptable planning implementations include beam search, A*, bounded DFS,
   Monte Carlo tree search, or other explicit search/planning methods. If a
   learned ranker is ever added, it may prioritize candidates but may not
   replace the explicit action graph, checkpoint contracts, or final artifact
   comparator.

### 3.4 Runner And Acceptance Contract

1. Acceptance execution must use real browser interactions:
   - DOM clicks
   - form input
   - keyboard input
   - canvas pointer gestures
   - context-menu flows
   - drag/selection gestures
2. Direct `window.__wb_debug` calls, direct API mutation, and `page.evaluate`
   state edits are diagnostic-only. They may help develop the harness or gather
   evidence, but they are not acceptance actions.
3. JS REPL is allowed as the interactive exploration engine for harness
   development because it can keep a persistent Playwright/browser session
   alive, execute seeded search loops, and shrink failures. Acceptance proof
   still requires committed runner scripts that can replay the same recipe and
   seed outside the REPL.
4. The runner must support the full action-graph gesture surface. `click` and
   `fill` alone are insufficient. The committed support target includes at
   minimum:
   - `click`
   - `fill`
   - `check`
   - `keypress`
   - `canvasClick`
   - `canvasDrag`
   - `contextMenu`
5. Every acceptance run must emit:
   - the selected goal case
   - the recipe / action trace
   - checkpoint outcomes
   - final artifact compare result
   - screenshots or other failure artifacts when a checkpoint or final compare
     fails
   - workflow-specific action artifacts whenever the workflow depends on
     geometry-sensitive drag/drop or slot-deletion behavior
     - source-to-grid drag artifacts must include selected source IDs,
       grouping shape, target row/col, expected changed rows/cols,
       frame-signature deltas, and visible status text
     - semantic slot deletion artifacts must include selected semantic frame
       IDs, before/after geometry, left-shift signature checks, repaired
       selection state, and visible status text
6. The overall verifier program now has two runner classes:
   - **Acceptance runners**
     - real browser interactions only
     - prove user-reachable UI workflows
   - **Structural-contract runners**
     - may use backend/API/file/fixture inspection
     - prove family schema, template schema, overlay-asset coverage,
       wearable slot/style parity, and export metadata invariants
     - never labeled acceptance or PASS for UI workflow proof
7. Mounted-family and wearable coverage require both runner classes:
   - acceptance runners for any shipped UI workflow that authors/applies those
     assets
   - structural-contract runners for backend schema parity, fallback behavior,
     and overlay/item coverage that the UI alone cannot prove today

### 3.5 State Capture And Artifact Oracles

1. Intermediate checkpoints are required. Final artifact equality alone is not
   enough because many editor regressions appear before export.
2. Checkpoints may assert:
   - action enablement / visibility
   - document geometry
   - layer, tool, and selection state
   - manifest/session state
   - undo/redo availability
   - bundle/runtime gating state
   - workflow-family invariants such as grouped drag span, target origin, or
     semantic-slot repack behavior
3. Final artifact comparators must be explicit and deterministic:
   - XP compare: geometry, layers, cell content, colors, metadata rows, and any
     other declared contract fields
   - bundle compare: expected ready/error states plus exported XP contract per
     action
   - runtime compare: only when the goal case explicitly includes runtime proof
4. The authoritative agent-readable proof surface is the structured report plus
   artifact comparator output. Screenshots aid humans but are not the sole
   oracle.

### 3.6 Current File Ownership Mapping

The current repo maps onto this harness model as follows:

1. `action_registry_schema.json` (the harness action registry seed)
   - keep - this is the sole current source of the User-Reachable Action Graph
   - no live `action_registry.json` instance file exists in this checkout; the
     schema file is both the seed definition and the current authority
   - adapt by expanding conditional reachability, gesture coverage, checkpoint
     tags, and random-exploration eligibility
2. `scripts/xp_fidelity_test/run_source_to_grid_workflow_test.mjs`
   - keep
   - this is the current contract-driven source-to-grid workflow runner
   - grouped row-select and grouped column-select lanes are now first-class and
     headed-proven through shipped UI drag paths
3. `scripts/xp_fidelity_test/run_m2d_action_proof_test.mjs`
   - keep
   - this is the current grid/action proof runner
   - it must continue to prove `clear_selected_contents` and
     `delete_frame_slot` as distinct actions
4. `scripts/xp_fidelity_test/recipe_generator.mjs`
   - keep
   - this is temporary synthesizer scaffolding
   - adapt by replacing fixed recipes with goal-directed stateful synthesis
5. `scripts/xp_fidelity_test/dom_runner.mjs`
   - keep
   - this is temporary runner scaffolding
   - adapt by adding real keyboard/canvas/context-menu gesture support and
     deterministic checkpoint execution
6. `scripts/xp_fidelity_test/verifier_lib.mjs`
   - keep
   - this is shared harness infrastructure
   - it now owns headed cross-panel drag preparation, frame-signature capture,
     and visible status capture for official source/grid proofs
   - continue tightening readiness waits and reducing `_state()` dependence in
     acceptance-facing state capture
7. `scripts/workbench_bundle_manual_watchdog.mjs`
   - keep as downstream runtime smoke only
   - it is not the Section 3 acceptance oracle
8. `scripts/xp_fidelity_test/recipe_generator.py`,
   `truth_table.py`, `run.sh`, `run_fidelity_test.mjs`,
   `run_bundle.sh`, `run_bundle_split.sh`, and
   `run_bundle_fidelity_test.mjs`
   - legacy truth-table lane
   - these may remain available only for historical reproduction or diagnostic
     comparison
   - they are not the future acceptance architecture and must be marked as
     legacy wherever they remain in-tree
9. `scripts/xp_fidelity_test/bundle_contract.mjs`
   - keep, but promote into the shared contract-helper direction from
     Section 2.3.7
   - it must stop reading fields that do not exist in the live registry, or the
     registry must be normalized so this helper becomes truthful
10. New backend contract tests/runner helpers are required:
   - template registry vs engine-family parity
   - mounted-family scope parity
   - wearable slot/style parity
   - overlay asset presence/fallback expectations
   These are missing today and are now part of the Section 3 gap, not optional
   follow-up.

### 3.7 Consequence For The Task Sequence

1. The Section 3 harness contract is a required design artifact before further
   verifier/watchdog expansion.
2. Legacy truth-table entrypoints must be demoted out of the primary acceptance
   path before new coverage claims are made.
3. Future verifier work must be described in the Unified Sequence Of Actions as Section 3 harness
   implementation, not as a continuation of the old repaint-fidelity lane.
4. Family/wearable parity work must land backend/schema runners before broad UI
   acceptance claims. Do not use bundle/player-only acceptance lanes to imply
   mounted-family or wearable-schema closure.
5. The `2026-04-14` through `2026-04-17` failure timeline is part of the task
   sequence contract now:
   - do not preserve a `COMPLETE` label when live code or the failure log can
     still falsify it
   - do not promote boundary proof, structural smoke, or runtime click-only
     proof into product acceptance
   - if a later branch reintroduces a supposedly-deleted owner, reopen the step
     explicitly instead of leaving the earlier closeout text in place

---

## Unified Sequence Of Actions

This section is the literal bottom-up workflow for this repo. The ordering law
is:

1. **Section 1 first** - finish the REXPaint-parity root editor and owner graph.
2. **Section 2 second** - add wrapper/runtime/bundle behavior only on top of
   the proven Section 1 owner.
3. **Section 3 third** - build acceptance and structural-contract proof that is
   carefully decoupled and only describes behavior that actually exists.
4. **Y9-2 gateway and public replacement last** - launcher/wizard follow-through
   and `/xpedit` cutover happen only after the first three layers are current.

Already-landed foundation slices on this branch:

1. `b8df3af` - blank root image path (`New XP`)
2. `790b63f` - whole-sheet root session ownership
3. `359c508` - root image actions routed through whole-sheet
4. `8da9c16` - source panel as root overlay
5. `c0d387f` - single frame-nav owner
6. `5014671` - research-backed editor/runtime decisions captured in Section 1.9 and Section 2.9
7. `5d5af15` - explicit Section 2 runtime-proof scope and full root save shape

Legacy-step normalization for older references:

- Treat `UQ-*` row IDs and row titles below as the only execution authority.
- Historical step numbers are context only and must never override the queue row titles.
- The overloaded label "Step 11" is normalized here to exactly one live meaning:
  backend registry-authority cleanup on the normalized registry = `UQ-004`.
- The Y9-2 launcher/wizard/MCP follow-through work is not Step 11 here. It is
  `UQ-010`, on top of the shared Section 2.10 bundle-authoring contract.
- `UQ-011` remains the public replacement / cutover lane.
- `UQ-013` is promoted to mobile workbench usability follow-through when mobile
  XP upload works but the first-screen/menu UX blocks real use.
- `UQ-014` is the printable grid paper side-feature lane. It is parked until
  template/source geometry authority is stable enough to generate paper from one
  truth source.

**Queue protocol:**

1. Start at the first row whose state is `CURRENT` or `READY`.
2. Before changing files, check `PLAYWRIGHT_FAILURE_LOG.md`, isolate unrelated
   dirt, and do not stage or revert user/unrelated changes.
3. Do exactly the row's task. Do not pull future-layer work forward because it
   feels related.
4. A Section 2 row may adapt to Section 1 behavior, but it may not reopen
   Section 1 ownership or invent a second editor/root.
5. A Section 3 row may only prove current shipped behavior. It must not invent
   product behavior, bypass the UI acceptance boundary, or over-claim closure
   from structural/diagnostic paths.
6. When a row lands or its state changes materially, update this canon and
   `PLAYWRIGHT_FAILURE_LOG.md` in the same commit.
7. `PARKED` rows are backlog, not "maybe next." They do not execute until the
   earlier `CURRENT` / `READY` rows pass or the user explicitly reprioritizes
   them.
8. `CURRENT / SUPPORT` means the row runs continuously alongside other queue
   rows as maintenance. It depends on `UQ-001` and whichever Section 1/2 source
   state currently exists. Its work is triggered by each landed Section 1/2
   slice, not by its own independent milestone. It has no positive completion
   condition - its fail condition (`Any verifier lane outruns product reality`)
   is a boundary guard, not a stop signal.

| Seq | State | Robot Task | Preconditions | Do Exactly This | Pass Condition | Stop / Fail Condition | FL / Owner |
|---|---|---|---|---|---|---|---|
| UQ-001 | ALWAYS | Establish repo truth before work | none | Run the repo entry checks, check the failure log first, inspect branch/head/dirty files, and identify unrelated dirt that must be left alone | Current authority docs, branch/head, dirty files, and relevant blockers are known before edits begin | Any unknown dirty change intersects the target files and cannot be safely isolated | Repo rule / `PLAYWRIGHT_FAILURE_LOG.md` |
| UQ-002 | PASS | Close Section 1 REXPaint parity and root-owner law | UQ-001 complete | Use Section 1.6 and Section 1.8 as the exact scope. Land only root-editor work: resize, browse parity, undo/redo ownership, apply toggles, oval/text tools, pointer events, zoom/grid completeness, and layer keyboard/persistence parity. Keep `whole-sheet-init.js` the sole document owner. Within this row, cut the hot path in this order: move live history out of `workbench.js`, stop full frame-grid rebuilds on ordinary root edits, decouple save/autosave from edit completion, then offload any still-heavy secondary projection/serialization work. | Section 1 no longer has unresolved root-editor parity blockers, the shipped edit path no longer depends on wrapper-owned history or broad wrapper projection churn for ordinary edits, or any residuals are explicitly logged as open with proof state and no mixed ownership survives | Any patch reintroduces a second editor/root owner, leaves the old owner alive while adding a new authoritative path, or treats wrapper-side throttles/suppression flags as closure while wrapper-owned hot-path authority still survives | Section 1 / `FL-STEP4` family / §1.6 |
| UQ-003 | PASS | Prove the Section 1 foundation on shipped surfaces | UQ-002 pass condition met | Run UI-only headed proof for the root-hosted and prefixed `/xpedit` Section 1 surface using shipped controls only; record evidence and update the ledger honestly | Root-hosted and prefixed Section 1 flows are proven on the shipped UI with no acceptance-boundary violation | Any proof relies on `fetch()`, `page.evaluate()` mutation, hidden hooks, or diagnostic-only paths and is labeled acceptance | Section 3 acceptance law / Section 1 proof |
| UQ-004 | CLOSED | Finish normalized-registry authority closeout | UQ-002 pass condition met | The four hardcoded `FAMILY_W_RANGE` / `_FAMILY_W_RANGE` maps were deleted in `a58eda6`..`e23fd3f`. All override-name paths now derive from registry `prefix_catalog.ahsw_range`. The `preview_xp -> l0_ref` fallback was fail-closed (normalizer raises ValueError on missing `preview_xp`). Registry load/fetch errors return 503 and surface as a degraded-state warning in the browser — empty truth is not cached, errors re-surface on each call. | No live backend bundle/session/export/runtime path still takes authority from `family` or `ENABLED_FAMILIES`; browser, runtime helper, and backend all consume the same normalized contract; classic/runtime override naming derives from registry `ahsw_range` instead of hardcoded maps; registry errors are operator-visible without silent empty caching | Any fix restores browser-side fail-close logic, creates a second registry authority, reintroduces hardcoded `ahsw_range` maps as authoritative paths, reintroduces live compat-family gating, or claims `UQ-004` closure while local override truth is still split | Section 2.5 / `S2-R1` / `S2-R2` |
| UQ-005 | CLOSED | Close the Section 2 export-quality contract at the wrapper boundary | UQ-004 pass condition met | Executed `S2-R3` then `S2-R4`: export-bundle and web-skin payload both call `_run_structural_gates()` (G7-G12). Canonical `validate-xp` surface added as `/api/workbench/validate-xp` + MCP tool `validate_xp`. G8/G9 threshold policy locked in `src/pipeline_v2/gates.py` with explicit named constants and documentation. | Bundle export and web-skin payload generation reject artifacts that fail the full quality contract, not just G10-G12; validate-xp endpoint exists and uses same gate suite | Any closure claim remains contradicted by live service code, or export/web-skin paths still skip G7/G8/G9 | Section 2.4 / `S2-R3` / `S2-R4` |
| UQ-006 | BLOCKED | Finish the Section 2 source-wrapper implementation on the canonical manifest contract | UQ-004 pass condition met | Execute `S2-R5` then `S2-R6` then `S2-R7`: land sidecar read/write/materialize plumbing, demote `extractedBoxes` / `sourceCutsV` / `sourceCutsH` to derived mirror state, rebuild the source panel around canonical manifest ownership, and expose the same mark/materialize/validate/status contract to headless clients. | Source authoring is no longer JSON-first, and one canonical manifest contract still owns source layout for UI, MCP, and backend paths | Any fix creates a second source-layout model or makes session-local source state authoritative again | Section 2.3 / `S2-R5` / `S2-R6` / `S2-R7` |
| UQ-007 | CLOSED | Land the Section 2 runtime identity layer | UQ-004 pass condition met; executed deletion-first before UQ-008 authorability | `config/runtime_identity_registry.json` is the single owner for `skin_definition_id`, `presentation_kind_id`, and `layer_definition_id`. Bundle contract helper, template-owned sessions, bundle create, bundle export, and runtime payload surfaces consume those IDs directly. | Pipeline-v3 no longer relies on string-only scope when claiming runtime-identity readiness; one V2 identity layer exists across helper, backend, and emitted bundle truth | Any fix reintroduces ID derivation from `family` / `runtime_role` strings or normalized registry metadata instead of `runtime_identity_registry.json` | Section 2.3.10 / `S2-R8` |
| UQ-008 | PROOF BLOCKED | Extend Section 2 to mounted-family authoring and runtime parity | UQ-007 pass condition met | Native builder support, mounted template actions, `authorable: true` registry state, backend/browser U2 calibration artifact flow, and U4 semantic review artifact flow now exist for `wolfie` and `wolack`; `bigbee` remains deferred. Remaining closure requires running the `mounted_authoring_e2e` proof against generated mounted XP, emitted Y9-2 bundle rows with V2 IDs, runtime parser acceptance, generated-row selection, and no legacy sprite fallback. | `wolfie` and `wolack` are authorable on the live Section 2 contract, mounted semantic/alignment truth is reviewable by artifact rather than destructive jitter mutation, and the browser surface matches the backend/MCP artifact flow | Any fix pulls `bigbee` into scope without canon change, treats existing wrapper inventory as generated-mounted proof, modifies the jitter owner instead of using the sibling mounted surfaces, writes mounted semantics directly from heuristics without human confirmation, or claims UQ-008 closed without `mounted_authoring_e2e` runtime evidence | Section 2.5 / `S2-R9` |
| UQ-009 | CURRENT / SUPPORT | Keep Section 3 harness and structural-contract runners aligned to what exists | UQ-001 complete; target Section 1/2 source state exists | Update the Section 3 action graph, headed signoff lanes, and backend schema/contract runners only for the surfaces that actually exist after each landed Section 1/2 slice. Keep acceptance UI-only. Keep backend schema/runtime parity runners separate from UI acceptance. Keep legacy repaint/truth-table entrypoints demoted. | Section 3 proof describes current code honestly: no false-green acceptance lane, no stale action graph, no structural-contract runner claiming UI acceptance | Any verifier lane outruns product reality, uses debug/API mutation as acceptance, or implies mounted/item closure from player-only lanes | Section 3 / harness law |
| UQ-010 | PARKED | Finish Y9-2 gateway follow-through on the shared bundle-authoring contract | UQ-004 through UQ-009 passed, or user explicitly reprioritizes it after backend truth is stable | Execute `S2-R10`: wire launcher / bundle-wizard / MCP front doors to the shared Section 2.10 headless contract (`phase0-status`, `phase0-build`, `validate-skin-intake`, `convert-skin-request`, `register-skin-request`, `compile-skin-request`, `validate-xp`, `status`) and remove any surviving second pipeline owner or local CLI substitution from the execution path. | Y9-2 front doors use the same stable bundle-authoring contract that Section 2 and Section 3 already prove | Any fix creates a second pipeline owner, keeps local subprocess behavior alive as parallel truth, or reclassifies missing contract ownership as launcher-only wiring after Section 2.10 defined the shared owner | Section 2.10 / `S2-R10` / B-13 |
| UQ-011 | PARKED | Public replacement / cutover lane | UQ-003 through UQ-010 passed; user explicitly starts cutover | Run the direct public-parity audit against `rikiworld.com/xpedit`, freeze the exact replacement SHA and proof artifacts, validate the `/xpedit` deploy path, deploy the frozen candidate, and re-run headed proof on the live URL | Public replacement is backed by the same root-hosted, prefixed, and public evidence chain with no unresolved earlier-layer blocker | Any earlier row is still open, any public parity check fails, or cutover is claimed from code state alone | Replacement lane / public parity |
| UQ-012 | ALWAYS | Canon hygiene and anti-overclaiming | Every non-trivial source/doc/proof change | Keep `PLAYWRIGHT_FAILURE_LOG.md`, this canon spec, and any directly-adjacent proof-summary text aligned. Separate code state, proof state, and doc state explicitly. Reopen rows when live code falsifies an earlier closeout. | Authority docs and live source agree, and no stale completion claim survives a contradiction | A lower-priority note, stale sequence summary, or old "COMPLETE" wording contradicts the current failure log or source | Canon authority / process |
| UQ-013 | CURRENT | Mobile Open Workbench usability and browser persistence follow-through | UQ-001 complete; mobile XP upload helper has proven file intake but first-screen workbench UX is product-blocking; prune proposal is downstream of this row | Implement the Section 1.9.2/1.9.3 mobile contract as a clean task-rooted mode: `Open XP`, `Continue Draft`, `New From Template`, `Export/Share`, responsive landscape editor shell, portrait open/import/continue sheet with rotate hint, IDs off by default, and a clearly secondary `Advanced Workbench` escape hatch to the existing dense dashboard. Keep dense AVP/native/proof/debug controls out of the mobile first screen; keep source as a named drawer, not generic Advanced. Decide and document the draft-discovery UX before implementation. | A real iPad or headed WebKit iPad pass can open/import an XP, continue an IndexedDB draft through the chosen draft entry, and reach the editor without navigating the current multi-panel workbench menu; landscape editor shell is usable; portrait can open/import/continue and then steer to landscape; IDs are off by default; export/share remains reachable; Advanced Workbench remains reachable as fallback | Any fix treats successful upload as usability closure, makes portrait/landscape orientation a hard open gate, reopens Section 1 ownership, hides the required Advanced Workbench escape hatch, buries source or U2/U4 required surfaces in generic Advanced, or implements prune before mobile usability design is approved | Section 1.9.2 / Section 1.9.3 / FL-MOB-01 |
| UQ-014 | PARKED | Printable Y9-2 authoring grid paper side feature | UQ-006 source-manifest/template geometry authority stable, or user explicitly reprioritizes a design-only prototype | Build the correct version of the printable grid-paper method from Section 2.6.1 / `FL-PRINT-01`: generate printable HTML/PDF from selected template/XP geometry, with underdrawing, cell grid, semantic boundaries, labels, fiducials, calibration strip, and explicit non-runtime status | Generated paper matches selected template geometry and records provenance; no hardcoded dimensions from the rejected seed artifact survive as authority | Any implementation copies the incorrect `sprite-sheet-full.html` layout as truth, hardcodes stale dimensions, or claims scan/import/runtime integration without a consuming path | S2-PRINT-01 / FL-PRINT-01 |
| UQ-015 | PARKED / WAYFINDER | Text-art craft and animation authoring contract | UQ-006 source-manifest ownership remains open; UQ-013 is the current mobile product lane. Start only when the user explicitly reprioritizes this capability or the earlier rows no longer block it. | Resolve the four `UQ-015` frontiers below before implementing controls. Preserve the whole-sheet XP document as the only mutable editor owner. Treat glyph sets, material guidance, reference boards, and onion-skin views as non-destructive authoring aids. Do not make a browser preview, converter, or runtime adapter a second document owner. | A reviewed contract names the animation-data owner and persistence format, supported font/glyph range and fallback, reference-image provenance and retention policy, the first asset scope, and one temporal acceptance path. Only then may an implementation begin. | Any work adds an unversioned timing field, makes a font swap silently change stored visual meaning, treats a reference image as an automatic conversion authority, adds automatic art scoring/mutation, or begins implementation before the unresolved owner decisions are made. | Section 1 / Wayfinder map 2026-08-31 / `docs/research/ascii/2026-08-31-stone-story-ascii-tutorial-intake.txt` |

#### UQ-015 Wayfinder map — text-art craft and animation authoring

**Destination.** The workbench can help an author make coherent text-art sprite
assets and preview their motion while the whole-sheet XP document remains the
single mutable editor owner. Any runtime or Skin Dock surface consumes the
authored document and explicit metadata; it does not reconstruct the asset.

**Evidence and current mismatch.** The current root editor provides a fixed
16-by-16 CP437 picker and a loaded CP437 font. It persists row categories and
frame groups, and the existing `Animation + Metadata` drawer can categorize,
group, align, and nudge frames. It has no contract for frame order, duration or
holds, loop mode, playback, onion skin, glyph-set grammar, font provenance, or
reference-board semantics. The source panel currently holds a source image for
conversion/layout work, not a separately governed composition reference.

**Source note.** The tutorial intake at
`docs/research/ascii/2026-08-31-stone-story-ascii-tutorial-intake.txt` is a
user-provided study. Its Part 1 material is corroborated by the user-local
saved official companion page `ASCII-art Tutorial.html`, which identifies
`https://stonestoryrpg.com/ascii_tutorial.html` and has a recorded SHA-256 in
the intake. It is a design reference, not a proof that the current runtime can
consume new animation data.

**Decisions fixed now.**

1. Section 1 owns every mutable animation-authoring field that belongs to an
   XP document. A preview is observational.
2. A glyph set is a non-destructive selection and annotation aid. It cannot
   change the numeric glyph stored in a cell by implication.
3. A material label or line-art study is author guidance. It cannot score,
   rewrite, or silently normalize authored cells.
4. A reference board is visually read-only with respect to the XP document.
   It must remain distinguishable from a conversion source.
5. Onion skin, if introduced, is a view over explicit neighboring frames. It
   may not become a hidden layer or a save-time pixel mutation.

**Unspecified frontiers.**

1. **UQ-015.A — animation-data owner (research).** Decide whether ordered
   frames, integer holds, loop mode, anchors, and padding live in a versioned
   XP sidecar, a bundle manifest, or another explicitly versioned artifact.
   Name the reader, migration behavior, and export/runtime consumer. The
   current `row_categories` and `frame_groups` fields are insufficient.
2. **UQ-015.B — glyph and font contract (research).** Decide the supported
   glyph range, font identity and metrics, fallback for absent glyphs, and
   whether custom fonts are per document, per workspace, or runtime bundle
   inputs. Retain the existing numeric CP437 behavior until the contract says
   otherwise.
3. **UQ-015.C — reference and art-review boundary (research).** Decide the
   reference-board storage, provenance, retention, deletion, privacy, and
   export rules. Decide the minimal glyph-set/material-study/onion-skin UX that
   works on both desktop and the UQ-013 mobile shell without duplicating source
   image or document ownership.
4. **UQ-015.D — temporal proof (task after A-C).** Define one user-reachable
   temporal test: select an authored action, play it continuously from the
   persisted document, capture time-separated frames plus matching metadata,
   and confirm the claimed runtime consumer uses the same asset identity.

**Out of scope.** This lane does not import Stone Story assets, video, or
runtime code. It does not change game rendering, re-open the current
source-manifest or mobile ownership lanes, implement an automatic ASCII-art
grader, or claim runtime animation support before the chosen artifact has a
consumer and temporal proof.

#### UQ-013 Closure Sequence

Ratified 2026-06-15. Execute in order; each step gates the next.

1. **Mobile design approved** — UQ-013 mobile Open Workbench design (landscape
   editor shell, portrait import/continue sheet, named drawers, draft-discovery
   UX) is reviewed and approved before any UI edits begin.
   *Status 2026-06-15: implemented locally without a separate design-approval
   gate; the MVP shell (Open XP / Continue Draft / New From Template / Advanced
   Workbench) landed as an additive overlay. Formal design approval deferred to
   proof step; no incompatible lock-in.*
   *Status 2026-06-16: design direction approved by user — Option 2, a dedicated
   editor-first mobile shell (after session-load the dense dashboard collapses
   and the whole-sheet editor is the primary surface; dashboard reachable only
   via Advanced). Implemented and screenshot-proven; real iPad pass still gates
   final closure.*
2. **Additive mobile shell** — Implement `Open XP`, `Continue Draft`,
   `New From Template`, `Export/Share`, and `Advanced Workbench` escape hatch as
   the task-rooted mobile first screen. `Continue Draft` requires JS wiring to
   `persistence.mjs` async draft discovery (`listDrafts()` / `loadLatestDraft()`)
   plus empty-list and error states; this is not a pure HTML/CSS change.
   *Status 2026-06-15: implemented locally. All dismiss paths gate on session-load
   success. URL/session-restore path also clears first screen via `loadSession()`
   success hook. Proof pending.*
   *Status 2026-06-16: editor-first shell added — `body.ws-session-loaded:not(.ws-advanced)`
   hides the dense `.wrap` dashboard panels and promotes `#wholeSheetPanel`; a
   mobile top-bar `Advanced` ⇄ `Editor` toggle (`body.ws-advanced`) is the
   escape hatch. Debug ID overlay now OFF by default everywhere. Headed-WebKit
   screenshots captured (`artifacts/2026-06-16-mobile-visual/`).*
3. **Scroll chrome** — Add visible scroll affordances adjacent to the whole-sheet
   editor zoom bar (`ws-zoom-row`). Controls must be translucent and must not
   occlude canvas content. Two-finger pan remains the primary gesture per
   §1.9.1:7.
   *Status 2026-06-15: implemented locally. `ws-scroll-chrome` ◄►▲▼ buttons
   appended to `ws-zoom-row` in `whole-sheet-init.js`. Translucent via CSS;
   hidden on desktop. Proof pending.*
   *Status 2026-06-16: visibility breakpoint corrected to
   `@media (pointer: coarse), (max-width: 1024px)` (covers iPad landscape). A
   Playwright bounding-box assertion verifies the chrome sits at/above the canvas
   top edge (non-occlusion). Screenshot proof captured.*
4. **Portrait/import/continue + landscape hint** — Portrait shows compact
   open/import/continue sheet with rotate hint after file load. Landscape shows
   responsive editor shell.
   *Status 2026-06-15: implemented locally. `#mobileRotateHint` overlay appears
   in portrait after `ws-session-loaded` is set by `loadSession()`. Proof pending.*
   *Status 2026-06-16: rotate hint demoted from a full-screen blocker to a slim
   dismissable banner below the top bar, so the editor canvas is usable in
   portrait immediately; suppressed in the Advanced dashboard fallback. Landscape
   shows the editor-first shell at full width. Screenshot proof captured.*
5. **Headed Playwright mobile proof** — Run headed WebKit iPad emulation
   confirming open/import, Continue Draft flow, editor reach, IDs off, scroll
   chrome visible, Advanced Workbench reachable, and representative authoring
   workflows executable without entering Advanced.
   *Status 2026-06-15: next required step.*
   Status 2026-06-16 (see FL-MOB-01 / FL-MOB-02): headed-WebKit proof step
   is now split into explicit proof classes, not one broad "mobile parity"
   claim:
   - Probe #1, drawer reachability: PASS, smoke only. It proves named drawers
     are present and editor-first without Advanced, not action semantics.
   - Probe #2, baseline author/export: PASS. Mobile first screen -> template ->
     tools drawer -> paint/rectangle -> frame add -> save -> export -> XP glyph
     oracle.
   - Probe #3, editing parity: PASS. Select, copy, paste, cut, clear, undo,
     redo, color selection, save, export, and XP glyph/color oracle.
   - Probe #4, source/import: PASS. PNG upload -> source box -> find sprites ->
     convert -> editor population -> save -> export -> nonzero XP oracle. This
     does not prove pixel-faithful glyph/color mapping from the source PNG.
   - Probe #5, file/session persistence: PASS. URL restore plus IndexedDB
     Continue Draft restore, native export, and XP glyph/color oracle.
   - Probe #6, Skin Dock: PASS for local flat preview pipeline readiness.
     Author -> save -> export -> Test This Skin -> `webbuild.ready === true`.
     This does not prove authored-skin visual rendering in WASM and does not
     prove live Y9-2 integration.
   - Probe #7, desktop unaffected: PASS. Desktop template -> paint -> Save ->
     Export -> XP oracle with mobile chrome absent.
   Headed-WebKit screenshots across portrait+landscape × fresh/template/
   advanced/tools-drawer plus desktop-unchanged are captured at
   `artifacts/2026-06-16-mobile-visual/`. Note: all probes are WebKit
   automation/emulation, not a physical device; step 6 still required.
6. **Real iPad proof** — Confirm the same flows on a real iPad before UQ-013
   is declared satisfied.
   *Status 2026-06-16: pending. This is the only hard closure gate for
   UQ-013, but the physical-device pass must include the proof-boundary gaps
   from FL-MOB-01: first-screen Open XP with a real `.xp` file, mobile
   Export/Share behavior, representative frame operations beyond Add Frame,
   representative layer/tool drawer operations beyond the editing recipe, and
   gesture/scroll discoverability in Safari.*

Broad workbench pruning (AVP, Skin Dock cleanup, hidden button removal) is
downstream of UQ-013 proof, not merely code landing. As of 2026-06-16 the headed
proof step (step 5) is satisfied only within the explicit boundaries above
(FL-MOB-01 / FL-MOB-02). The prune proposal Implementation Order remains blocked
until the real iPad proof (step 6) and user sign-off close UQ-013.

#### 1.9.4 Wayfinder ownership correction — 2026-08-12

`asciicker-Y9-2` `FL-4257` is the sole cross-repository roadmap owner for the
canonical enhanced Section 1 editor. `UQ-013`, `FL-MOB-01`, and `FL-MOB-02`
remain historical implementation/proof records beneath that map; they do not
own the future editor architecture or authorize the legacy workbench dashboard
to remain a second document/control owner.

The current mobile shell is diagnostic input, not the accepted composition.
Reusable inputs and rejected ownership are recorded in resolved research child
`FL-4268`. The future control surface must reanchor the same commands and state
from usable canvas/control geometry. Coarse-pointer detection and orientation
may inform measurements, but cannot select a phone/tablet product architecture
by themselves. Current Chromium screenshots and recipes do not satisfy
continuous-authoring, WebKit, or physical-iPad acceptance.

Full Unicode authoring is also roadmap work, not current behavior. The active
editor still stores CP437-style 0..255 glyph indices; JavaScript string input,
the XP uint32 field, and a large glyph palette are not a canonical Unicode cell
model. `FL-4266` owns semantic cell/edit invariants, `FL-4269` owns deterministic
font resolution/rendering, and `FL-4270` owns enhanced-native persistence plus
explicit lossless/constrained/lossy compatibility projections. No source,
storage, or UI implementation may precede those decisions or silently redefine
REXPaint XP and Y9-2 runtime glyph semantics.

Current dependency route: `FL-4263` and `FL-4266` are independent research
frontiers. `FL-4269` and `FL-4270` wait on `FL-4266`; `FL-4267` waits on
`FL-4263`, resolved `FL-4265`, and all resolved Unicode contracts. The remaining
default route is `FL-4258 -> FL-4264 -> FL-4259 -> FL-4261 -> FL-4260 ->
(FL-4262 plus FL-4256)`. Resolved task child `FL-4271` is the Wayfinder planning
handoff for this route and incorporates the project `AGENTS.md` `Maintain
operational grounding` contract. It is not a tracked E2E execution runbook:
that label requires later RQ projection with named owners, machine-visible
required fields, exact commands and environments, artifact destinations,
falsifiers, rollback boundaries, and acceptance criteria.

Future after current skin-authoring closure:

1. Design the wearable authoring workflow/template surface only after UQ-002
   through UQ-011 are current.
2. Define a separate wearable verifier/signoff path instead of piggybacking on
   the skin-strip signoff lane.

---

## 2.11 Bundle Coverage Policy

**Added 2026-04-22. Based on cross-repo audit of `artifacts/bundled_xp_sprite_packs/`
in Y9-2.**

The active bundle (driven by `appearance_bundle.json` and `ids.lock.json`) currently
references approximately 74 of 441 XP sprite files in the Y9-2 `assets/sprites/`
directory - roughly 17% coverage. This is not an error; it reflects deliberate phase-2
scope. However, the spec does not currently define coverage policy, so there is no
machine-enforceable contract between the sprite library and the active bundle.

### 2.11.1 Coverage Baseline

Current phase-2 baseline intentionally includes:

- on-foot human idle/attack/death actions (player, attack, plydie families)
- standard color variant (default skin only)
- AHSW equipment encoding combinations for the three authorized families

Current phase-2 intentionally excludes:

- color-variant families (`attack-green-*`, `player-green-*`, `plydie-green-*`) -
  proof-only, not authorable; see §2.3.4 and §2.5 misalignment ledger
  (`src/pipeline_v2/service.py`, `config/template_registry.json`,
  `scripts/workbench_png_to_skin_test_playwright.mjs`, `web/workbench.js`)
- mounted families (`wolfie-*`, `wolack-*`) - authorable but proof-blocked
  pending `mounted_authoring_e2e`; see §2.9.1
- `bigbee-*` - deferred explicitly; see Step 10 scope note
- world-item and inventory-grid item families - no item authoring surface exists yet

### 2.11.2 Coverage Expansion Contract

When the scope above expands (e.g. mounted families land after `UQ-008`), the bundle
coverage contract must expand simultaneously. The rule is:

1. Every sprite in `assets/sprites/` must be either:
   - referenced in the active bundle source manifest, OR
   - listed in `config/SPRITE_COVERAGE_EXCEPTIONS.txt` with an explicit reason

2. Accepted reasons for exclusion:
   - `deprecated` - asset is historical; not in active use
   - `proof-only` - runtime/proof helpers use it but the authoring surface does not
   - `future-scope` - planned for a future phase; include target milestone if known
   - `test-fixture` - test-only asset not in production bundles

3. If a new sprite file is added to `assets/sprites/` without a corresponding bundle
   reference or SPRITE_COVERAGE_EXCEPTIONS.txt entry, that is a coverage regression,
   not a cleanup task.

4. Coverage audits must be machine-driven. A script or CI step must enumerate
   `assets/sprites/*.xp`, cross-reference the active bundle, and emit a coverage
   report before any bundle export gate is declared PASS.

**Current state (2026-05-03):** `config/SPRITE_COVERAGE_EXCEPTIONS.txt` does
not yet exist and the CI audit step is not implemented. This contract activates
when `UQ-008` expands bundle scope to mounted families. Until then, the
exceptions in §2.11.3 are tracked inline only. No queue row currently owns
the creation of this file or the audit script.

### 2.11.3 Current Exceptions (2026-04-22)

The following families are excluded from phase-2 bundle by design:

| Family pattern | Reason | Resolves in |
|----------------|--------|-------------|
| `attack-green-*`, `player-green-*`, `plydie-green-*` | proof-only (`§2.5`, `service.py`, `workbench.js`) | after `UQ-004` authoring-boundary cleanup and any later canon scope change |
| `wolfie-*`, `wolack-*` | future-scope: mounted authoring | after `UQ-008` mounted-family parity |
| `bigbee-*` | future-scope: bigbee deferred | explicitly post-mounted-family work |

This table must be updated whenever scope changes. Do not widen bundle coverage without
updating this table.

---

## 2.12 Rollback Asset Snapshot Contract

**Added 2026-04-22. Based on audit of `artifacts/bundled_xp_sprite_packs/rollbacks/`
in Y9-2.**

Current rollback snapshots (e.g. `rollback_20260422_193432/`) capture only JSON
metadata:

- `appearance_bundle.json`
- `ids.lock.json`
- `compile_report.json`

They do NOT capture XP sprite binary files. If a sprite binary changes between the
rollback snapshot and the rollback restore point, the rollback cannot reconstruct prior
asset state.

### 2.12.1 Required Rollback Snapshot Contents

A sound rollback snapshot must capture:

1. All JSON metadata (current behavior - retain as-is)
2. All XP sprite binaries referenced by the bundle at snapshot time
3. The expected SHA256 hash of each referenced sprite binary, stored in a
   `bundle_sha256_manifest.json` alongside the snapshot

Implementation:

- At snapshot creation time, copy all referenced XP files into the rollback directory
  under an `asset_binaries/` subdirectory
- At restore time: unpack `asset_binaries/` to the original sprite paths, recompile,
  and verify the resulting `compile_report.json` hashes match `bundle_sha256_manifest.json`

### 2.12.2 Rollback Validation Rule

After a rollback restore, all of the following must pass before the state is declared
sound:

1. `ids.lock.json` hashes match the snapshot
2. All sprite files named in `bundle_sha256_manifest.json` are present at their
   expected paths with matching hashes
3. A fresh bundle compile produces a `compile_report.json` that matches the snapshot

If any check fails, the rollback is partial and the operator must be notified before
any further bundle operations proceed.

### 2.12.3 Current State (2026-04-22)

This contract is not yet implemented. The existing rollback mechanism satisfies only
item 1 of §2.12.1. Items 2 and 3 are OPEN. This gap should be addressed before any
rollback is relied on in an automated or agent-driven workflow.

---

## 2.13 Y9-2 Wizard Parity Contract

**Added 2026-04-22. Expands on DESIGN OPEN B-13 from §2.10.**

Section 2.10 defines the shared headless bundle-authoring contract this server
must expose for Y9-2 integration. DESIGN OPEN B-13 documents that the Y9-2
`[3] ASSET PIPELINE` launcher node is absent rather than wired. This section
defines the parity contract that must hold between the Y9-2 launcher
`option_tree`, the current Y9-2 bundle-wizard client, and the pipeline-v3
backend.

### 2.13.1 Wizard Parity Invariants

1. Every wizard option listed in the Y9-2 launcher `option_tree.py` under the
   `[3] ASSET PIPELINE` node must have a corresponding handler that calls the
   shared Section 2.10 headless contract. A listed option with no handler, or
   with a handler that reaches only launcher-local logic instead of the shared
   owner, is a parity violation.

2. Every wizard handler must implement a full lifecycle:
   - **Precondition check**: verify the shared owner is reachable and the
     request artifact can be inspected (`status` / `phase0-status`) before the
     first mutating prompt; fail fast with a clear message if not
   - **Prompt sequence**: at least one user-facing prompt that collects required input
   - **Execution**: call the appropriate shared command/API step with the collected input
   - **Result display**: render the backend response in the terminal before returning
     to the menu

3. Tests must exercise the full lifecycle. A test that only checks for handler name
   existence (string matching on `option_tree.py`) does not satisfy this contract.

4. The `option_tree` must reflect the current backend capability. If an endpoint is
   not implemented, the corresponding launcher option must be either absent or
   explicitly labeled `[DEFERRED]` - never silently present with a broken or stub
   handler.

### 2.13.2 Priority Client Paths

Per §2.7, there are two client paths into the backend:

- **Human TUI path**: Y9-2 launcher `[3] Asset Pipeline` → bundle-wizard client
  → shared headless contract
- **Agent MCP path**: AI agent → MCP wrapper → same shared headless contract

Both paths must satisfy the same parity contract. An MCP tool that calls a wizard
action stub without reaching the backend is the same class of violation as a launcher
option with no handler.

### 2.13.3 Action Authoring Lifecycle (TUI)

When a user enters the bundle authoring wizard from the Y9-2 launcher:

1. **Status check**: wizard displays pipeline server URL and health status
2. **Bundle blueprint selection**: list available bundle blueprints / skin
   lanes and required presentation coverage; user selects the blueprint rather
   than a standalone template
3. **Source input**: prompt for source PNG paths or an existing request artifact
4. **Intake validate**: run `validate-skin-intake`; display geometry and
   coverage findings
5. **Convert**: run `convert-skin-request`; display staged XP outputs and
   artifact status
6. **Register**: run `register-skin-request --dry-run`, then real register only
   if dry-run passes and full walk/attack/death coverage exists
7. **Compile + validate**: run `compile-skin-request` and `validate-xp`;
   display gate outcomes (G7-G12), provenance, and compile results
8. **Accept or retry**: user reviews; if rejected, return to step 3 or 5

Status display rule: the wizard must always show which blueprint is active and
which presentation coverage is complete or missing (for example
`Blueprint: humanoid skin lane | coverage: walk done, attack missing, death missing`).
The user must never be in a state where it is unclear which bundle contribution
they are authoring or why registration is still blocked.

### 2.13.4 Scope Boundary

The Y9-2 wizard is a thin client. It:

- does not own the XP editor root (Section 1 owns this)
- does not own the wrapper architecture (Section 2 owns this)
- does not define the bundle blueprint / presentation schema (the backend registry owns this)
- does not define the bundle export contract (§2.4 and §2.11 own this)

The wizard is responsible only for orchestrating user input, calling the correct
backend endpoints in order, and presenting results. Any design decision about what the
pipeline does must be captured in this spec, not in wizard code.

---

## 2.14 Y9-2 Bundle System Architecture Reference

**Added 2026-04-27. Sourced from live Y9-2 code audit and annotated walkthrough.**

This section is the canonical reference for understanding the Y9-2 appearance bundle
system that Section 2 of this pipeline must author toward. Every authoring contract,
export gate, and semantic parity requirement in §2.3-§2.13 exists to produce output
compatible with this system. Source code cited below lives in the main game repo
(`asciicker-Y9-2`), not in this repo.

---

### 2.14.1 End-to-End Walkthrough - Header Block

The following 17-step sequence is the full path from a raw XP file on disk to a
pixel drawn on screen. Each step is labeled **STEP N** so that inline commentary
elsewhere in this spec and in source files can reference it by number.

```
STEP 0  - XP exists on disk
          The XP file is authored art. The game does not use it automatically.
          No callgraph. Source: appearance_bundle.py:4 (module docstring)

STEP 1  - Manifest declares what the XP is
          Source: positive.bundle.json → layer_definition entry
          Fields: slug, contract, path, presentation_kind_slug, slot_kind_slug,
                  visual_style_slug, variant_signature, owner (skin/item/mount)

STEP 2  - Compiler validates XP against SPRITE_CONTRACTS
          Callgraph:
          compile()
            └─ _inspect_sprite_asset(path, contract_key)       [py:224]
                 ├─ XPFile.load(path)
                 ├─ check_engine_invariants(xp)
                 ├─ xp.get_metadata() → {angles, projs, anims}
                 ├─ layer0 = xp.layers[0]
                 ├─ row1_refs = [decode(layer0.data[1][col]) for col in range(2)]
                 ├─ row2_refs = [decode(layer0.data[2][col]) for col in range(2)]
                 └─ validate angles/projs/anims/row1/row2 vs SPRITE_CONTRACTS[key]
          Contract table: SPRITE_CONTRACTS                      [py:72]

STEP 3  - Compiler stores geometry metadata
          _inspect_sprite_asset() returns asset record:
            {path, contract, sha256, sheet_size, frame_size,
             angles, projs, anims, row1_refs, row2_refs, layer_count}
          → written into layer_definition.asset in compiled bundle [py:304]

STEP 4  - Bundle stores owner/presentation/slot/variant binding
          Callgraph:
          compile()
            └─ _resolve_and_emit_layer_definitions()            [py:987]
                 ├─ look up presentation_kind_id from slug_maps
                 ├─ look up slot_kind_id from slug_maps
                 ├─ look up visual_style_id from slug_maps
                 ├─ _normalize_variant_signature() → {height_class, width_class,
                 │    silhouette_class}                          [py:237]
                 └─ emit row into bundle.catalog.layer_definitions

STEP 5  - Server selects authoritative appearance at player join
          Callgraph:
          SvrHandleClientJoin()                       [server_tick.cpp:4587]
            └─ SvrSelectJoinAppearanceProfile()       [server_tick.cpp:4595]
                 └─ SvrApplyProfileToAppearance(
                        appearance, cache, profile,
                        source_kind, subject_kind,
                        subject_key)                  [server_tick.cpp:2505]
                      ├─ SvrClearAppearanceEntries()
                      ├─ SvrSetAppearanceIdentity(...,
                      │    profile_id, skin_definition_id)
                      ├─ SvrUpsertAppearanceEntry() × starter_count
                      └─ SvrBumpAppearanceRevision()

STEP 6  - Server sends two packets to every client
          Callgraph:
          SvrHandleClientJoin()
            ├─ fill STRUCT_BRC_JOIN              [network.h:284]
            │    fields: life_state, mount_state, locomotion_state,
            │             combat_state, presentation_kind_id,
            │             presentation_started_tick
            └─ SvrFillAppearanceStateV2(
                   out, entity_type, entity_id,
                   appearance)                   [server_tick.cpp:4073]
                 → STRUCT_BRC_APPEARANCE_STATE_V2 [network.h:307]
                   fields: token='a',
                           appearance_profile_id,
                           skin_definition_id,
                           mount_definition_id,
                           entry_count,
                           entries[].{slot_kind_id, item_definition_id,
                                      visual_style_id, state_flags}

STEP 7  - Client stores authoritative appearance state
          Callgraph:
          BroadcastHandler.handle_packet()
            └─ case 'a':                         [game.cpp:6337]
                 ├─ cast ptr → STRUCT_BRC_APPEARANCE_STATE_V2
                 └─ copy into sn->appearance_v2
          No rendering yet. Client now has authoritative appearance truth.

STEP 8  - Render-time: selector picks presentation family
          Callgraph:
          RenderActor(sn)
            └─ FindActorBundleSelectorForRuntime(
                   presentation_kind_id,
                   presentation_mask, life_mask,
                   locomotion_mask, combat_mask,
                   mount_mask)                   [game.cpp:3435]
                 ├─ walk g_actor_appearance_bundle.selectors[]
                 └─ return ActorBundleSelectorDef* where all masks match

STEP 9  - Selector picks desired geometry signature
          Callgraph:
          ResolveActorBundleLayersForState(sn)
            └─ ResolveActorDesiredVariantSignature(selector) [game.cpp:3532]
                 └─ return selector->fallback_chain[0]
                          (usually base/full/base)

STEP 10 - Renderer looks up the body layer
          Callgraph:
          ResolveActorBundleLayersForState()
            └─ ResolveActorBundleLayerWithFallback(
                   selector,
                   ACTOR_BUNDLE_OWNER_SKIN,
                   skin_definition_id,
                   APPEARANCE_SLOT_KIND_BODY,
                   APPEARANCE_VISUAL_STYLE_DEFAULT,
                   desired_signature,
                   &fallback_mask)               [game.cpp:3606]
                 ├─ FindActorBundleLayerExact() - try exact signature
                 └─ if miss: walk fallback_chain[], try each candidate;
                             record miss in fallback_mask bit

STEP 11 - Renderer looks up gear layers in attachment order
          Callgraph:
          ResolveActorBundleLayersForState()
            ├─ ResolveActorBundleAttachmentSlotOrder(
            │      presentation_kind_id,
            │      out_slot_kind_ids[])          [game.cpp:3613]
            └─ for each slot_kind_id in order:
                 ├─ FindAppearanceStateEntryV2BySlot(
                 │      state, slot_kind_id)
                 │    → item_definition_id, visual_style_id
                 └─ ResolveActorBundleLayerWithFallback(
                        selector,
                        ACTOR_BUNDLE_OWNER_ITEM,
                        item_definition_id,
                        slot_kind_id,
                        visual_style_id,
                        desired_signature,
                        &fallback_mask)          [game.cpp:3641]

STEP 12 - Fallback substitutes a nearby geometry variant if exact is missing
          (Embedded in STEP 10 and STEP 11 via ResolveActorBundleLayerWithFallback)
          Callgraph:
          ResolveActorBundleLayerWithFallback()   [game.cpp:3503]
            ├─ FindActorBundleLayerExact() - exact pass
            ├─ if miss: mark fallback_mask bit
            └─ for i in selector->fallback_count:
                 └─ FindActorBundleLayerExact(
                        ..., fallback_chain[i])
                    - use first match found

STEP 13 - Ordered layer stack assembled
          After STEP 11, ResolveActorBundleLayersForState returns
          a struct (ActorBundleResolvedLayers) containing:
            body_layer_definition_id
            item_layers[] in attachment order
            mount_layer_definition_id (if mounted)
          FillActorBundleRenderArrays() emits flat render arrays [game.cpp:3673]

STEP 14 - Layers composited into final sprite
          Callgraph:
          LookupActorBundleComposedSprite(layers, clr)  [game.cpp:3822]
            ├─ BuildActorBundleRenderKey(layers, &key)
            ├─ scan composed_cache[] for matching key
            ├─ if miss:
            │    ├─ GetOrLoadActorBundleLayerSprite(base_layer)
            │    ├─ clone base sprite
            │    └─ composite each item layer in render order
            └─ return cached composed Sprite*

STEP 15 - Animation frame selected
          Callgraph:
          ResolvePresentationFrame(
              presentation_kind_id, tick,
              locomotion_state, combat_state)   [game.cpp:8039]
            ├─ idle → frame 0
            ├─ walk → frame cycling by tick
            ├─ attack → progression by tick since attack started
            └─ plydie → ActorBundleDeathPlaybackMetadataAllows()
                         → playback frame index

STEP 16 - Sprite drawn on screen
          DrawActorSprite(composed_sprite, frame, x, y)
          The composed sprite from STEP 14 at the frame index from STEP 15
          produces the final on-screen pixel output.
```

---

### 2.14.2 Abstraction Hierarchy

In the same way that C ⊃ R ⊃ Q ⊃ Z nests number systems, the bundle system layers
identity concepts. Each row below answers a strictly narrower question than the one
above it.

```
Subject kind
│   What category of entity is being rendered?
│   → actor / world_item / inventory_grid
│
└─ Actor appearance state                          [network.h:307]
   │   Which body owner, mount, and equipment does this actor carry?
   │
   ├─ appearance_profile_id
   │  The server-assigned starter loadout profile.
   │
   ├─ skin_definition_id           ← BODY OWNER (not a body part)
   │  Which skin family supplies the body layer?
   │  e.g. cyan_suit = 100, normal_player = 101
   │
   ├─ mount_definition_id
   │  Which mount supplies the mount layer (if any).
   │
   └─ entries[]  (per-slot equipment)
         slot_kind_id        ← WHERE the layer is attached
         item_definition_id  ← WHAT item owns the layer for that slot
         visual_style_id     ← WHICH style/color version of that layer

Current actor runtime state
│   What is the actor doing right now?
│   → life_state × locomotion_state × combat_state × mount_state
│
└─ Selector                                        [game.cpp:3435]
   │   Given runtime state, which presentation family and geometry
   │   fallback chain apply?
   │
   ├─ presentation_kind_id  ← THE ACTOR'S CURRENT RENDER VERB
   │  e.g. idle_walk = 600, attack = 601, plydie = 602
   │  (one family covers all frames within that state family)
   │
   └─ desired variant_signature  ← GEOMETRY BRANCH
      │   Which body-shape branch to try first?
      │   = the first entry in the selector's fallback_chain
      │
      └─ variant_signature = height_class × width_class × silhouette_class
            Three independent axes (not three hardcoded classes).
            base/full/base is the standard human signature.
            tall/full/base and wide/full/base also exist.
            tall+wide coexists. super_tall or super_wide would need
            new token values in compiler and bundle both.

Layer lookup                                       [game.cpp:3606, 3641]
│   Given (presentation, slot, owner, style, signature) → layer_definition_id
│
├─ Body layer   owner=skin,  slot=body,   id=skin_definition_id
├─ Item layers  owner=item,  slot=*,      id=item_definition_id  × visual_style_id
└─ Mount layer  owner=mount, slot=mount,  id=mount_definition_id

Attachment order                                   [appearance_bundle.json:1]
│   In what draw order are the matched layers painted?
│   → body, armor, shield, weapon, head  (for idle_walk and attack)

Composed sprite cache                              [game.cpp:3822]
│   Cached output for a specific (presentation × skin × variant × loadout) tuple.

Animation / frame selection                        [game.cpp:8039]
   Final frame index within the composed sprite.
```

**Reading the hierarchy:** `presentation_kind_id` is a property of runtime state, not
of appearance identity. `skin_definition_id` is a property of appearance identity, not
of runtime state. They answer orthogonal questions and are carried in separate network
packets. See §2.14.6 for model clarifications.

---

### 2.14.3 Glossary

All terms used in §2.3-§2.14 are defined here in alphabetical order.

| Term | Definition |
|------|-----------|
| `anchor_mode` | The contract's anchor interpretation rule for row1/row2 refs. Values: `character`, `mount_character`, `none`. Determines which row-ref validation rules the compiler applies. Source: `SPRITE_CONTRACTS` keys, `appearance_bundle.py:72`. |
| `angles` | Number of facing directions encoded in one XP sheet. Rows map to angles top-to-bottom. Validated against `SPRITE_CONTRACTS[contract]["angles"]`. Source: `appearance_bundle.py:72`. |
| `anims` | Animation layout descriptor. A list of frame counts per animation track, e.g. `[1, 8]` means one idle frame followed by eight walk frames. Source: `appearance_bundle.py:72`. |
| `appearance_profile_id` | Server-assigned integer identifying the profile that chose the actor's starter skin and loadout. Carried in `STRUCT_BRC_APPEARANCE_STATE_V2`. Source: `network.h:307`, `server_tick.cpp:2505`. |
| `appearance_v2` | The authoritative appearance packet/state on the client, populated from `STRUCT_BRC_APPEARANCE_STATE_V2` (token `'a'`). Contains `appearance_profile_id`, `skin_definition_id`, `mount_definition_id`, entry count, and per-slot entries. Source: `game.cpp:6337`. |
| `asset layout contract` | The rules an XP sheet must satisfy: `angles`, `projs`, `anims`, `anchor_mode`. Identified by a contract key such as `idle_walk_character` or `attack_mount`. Defined in `SPRITE_CONTRACTS`. Source: `appearance_bundle.py:72`. |
| `attachment order` | The bundle-defined slot compositing order for a given presentation family. For `idle_walk`: body → armor → shield → weapon → head. Source: `appearance_bundle.json:1`. |
| `body owner` | The skin family (identified by `skin_definition_id`) that supplies the body layer. Not a body part - the word "body" in `slot_kind_id=body` refers to the torso slot, while "body owner" refers to the whole skin identity. |
| `compiled bundle` | The output of `appearance_bundle.py compile`: `appearance_bundle.json`, `ids.lock.json`, `compile_report.json`. The runtime reads this at join. |
| `contract` | A data agreement at one layer of the system. There are five distinct contracts in this system; see §2.14.4. The word "contract" is overloaded in this codebase - always qualify which of the five you mean. |
| `fallback_chain` | The ordered list of `variant_signature` values a selector will try when the exact signature has no layer. Declared in the bundle; compiler-validated. Source: `appearance_bundle.py:533`, `game.cpp:3503`. |
| `frame_size` | Width and height in cells of one frame rectangle inside an XP sheet. Derived by the compiler as `layer0.width / (projs × sum(anims))` × `layer0.height / angles`. Source: `appearance_bundle.py:165`. |
| `height_class` | One of the three axes inside `variant_signature`. Examples: `base`, `tall`. |
| `item_definition_id` | Authoritative integer identity for an equipped or world item. Used as the render-owner key for item-owned layers. Carried per-slot in `STRUCT_BRC_APPEARANCE_STATE_V2`. Source: `network.h:307`. |
| `layer_definition` | One compiled layer row in the bundle catalog. Binds a specific XP asset to `owner_definition_kind`, `owner_definition_id`, `slot_kind_id`, `presentation_kind_id`, `visual_style_id`, and `variant_signature`. Source: `appearance_bundle.py:987`, `appearance_bundle.json:1728`. |
| `layer_definition_id` | Stable integer ID for a `layer_definition` row. Never changes after first assignment. Stored in `ids.lock.json`. |
| `locomotion_state` | One axis of runtime actor state. Drives selector mask matching. Values: idle, moving, etc. Carried in `STRUCT_BRC_JOIN`. Source: `network.h:284`. |
| `mount_definition_id` | Authoritative integer identity for the actor's current mount. Used as the render-owner key for mount layers. Carried in `STRUCT_BRC_APPEARANCE_STATE_V2`. |
| `owner_definition_id` | The numeric ID within a specific owner namespace that a layer belongs to. For skin layers: equals `skin_definition_id`. For item layers: equals `item_definition_id`. For mount layers: equals `mount_definition_id`. |
| `owner_definition_kind` | Which namespace a layer belongs to: `skin`, `item`, or `mount`. Determines which ID field is the lookup key. Source: `appearance_bundle.json:1728`. |
| `presentation family` | A named rendering state family such as `idle_walk`, `attack`, or `plydie`. All layers, selectors, and attachment orders for one family share the same `presentation_kind_id`. |
| `presentation_kind_id` | Authoritative integer ID for the actor's **current render verb/state family**. This is a runtime state token, not an outfit or wearable combination. `idle_walk = 600`, `attack = 601`, `plydie = 602`. Carried in `STRUCT_BRC_JOIN` (current state) and used as a lookup key for selectors, layers, and attachment orders. The name is historical: "kind" refers to the category of presentation state. It does **not** imply a skin or wearable combination. See §2.14.6 for full model clarification. Source: `network.h:284`, `game.cpp:3435`. |
| `projs` | Projection count per angle in the sheet contract. Most character sheets use `projs=2` (two projections per facing direction). Source: `SPRITE_CONTRACTS`, `appearance_bundle.py:72`. |
| `row1_refs` | Primary anchor/projection reference metadata. Read from `layer0.data[1]` (the second row of XP layer 0). For character contracts these are Y offsets within the frame used as anchor points. Source: `appearance_bundle.py:167`. |
| `row2_refs` | Depth/secondary reference metadata. Read from `layer0.data[2]` (the third row of XP layer 0). For character contracts these are depth values bounded by `CHARACTER_ROW2_MAX_DEPTH=15`. Source: `appearance_bundle.py:168`. |
| `selector` | A runtime rule mapping actor state masks (presentation, life, locomotion, combat, mount) to an active presentation family plus fallback chain. Source: `game.cpp:3435`, `appearance_bundle.py:272`. |
| `selector input contract` | The allowed runtime-state combinations for a selector, including `life_states`, `locomotion_states`, `combat_states`, `mount_states`, and the `fallback_chain` of variant signatures. Source: `appearance_bundle.py:272`. |
| `sheet-layout family` | Alternative name for `asset layout contract`, e.g. `idle_walk_character`. |
| `silhouette_class` | One of the three axes inside `variant_signature`. Examples: `full`. Describes the silhouette category, not width or height alone. `variant_signature` is the whole tuple; `silhouette_class` is one coordinate within it. |
| `skin_definition_id` | Authoritative integer ID for the **body-owner family** - which skin family supplies the body layer. This is an appearance identity token, not a body part. `cyan_suit = 100`, `normal_player = 101`. Does **not** mean head/body/arm section; the section is `slot_kind_id`. See §2.14.6. Source: `network.h:307`, `appearance_bundle.json:1728`. |
| `slot_kind_id` | The attachment channel ID. Values: `body=300`, `head=301`, `shield=302`, `weapon=303`, `consumable=304`, `loot=305`, `armor=306`, `mount=307`. Determines where in the attachment order a layer is painted. Source: `appearance_bundle.json:1`. |
| `subject_kind` | What kind of entity a selector or appearance applies to: `actor`, `world_item`, or `inventory_grid`. World items and inventory items use different selector/input contracts from actors. |
| `variant_signature` | The full geometry tuple `{height_class, width_class, silhouette_class}` used for exact and fallback layer lookup. **This is geometry class, not style/color.** Style/color is `visual_style_id`. The three axes are independent; `tall+wide` is a valid combination. The count of usable combinations is not hardcoded - it is bounded by the token sets declared in the compiler and bundle. Source: `VARIANT_SIGNATURE_KEYS`, `appearance_bundle.py:59`, `appearance_bundle.py:237`. |
| `visual_style_id` | Style/color lane ID. Values: `default=500`, `gold`, `dark`. This is **not** geometry. Wide/tall geometry lives in `variant_signature`, not here. Source: `appearance_bundle.json:1728`. |
| `width_class` | One of the three axes inside `variant_signature`. Examples: `base`, `wide`. |
| `xp asset` | A raw `.xp` sprite sheet file. The game does not use it automatically; it must be declared in the bundle source manifest and pass contract validation. |

---

### 2.14.4 The Five Contracts

There is no single "bundle contract." There are five distinct contracts at different
layers of the system. Each is enforced by a different part of the toolchain.

**CONTRACT 1 - Asset Layout Contract**
> "The XP sheet must match the declared layout family."

- Defines allowed sheet shape: `angles`, `projs`, `anims`, `anchor_mode`
- Applied at compile time by `_inspect_sprite_asset()`
- Contract table: `appearance_bundle.py:72` (`SPRITE_CONTRACTS`)
- Validation code: `appearance_bundle.py:224`
- Violation → compile rejects the XP; it cannot enter the bundle
- Named families: `idle_walk_character`, `attack_character`, `idle_walk_mount`,
  `attack_mount`, `plydie_character`, `world_item`, `inventory_grid`

**CONTRACT 2 - Selector Input Contract**
> "Given this runtime state combination, use this presentation family and this fallback chain."

- Defines which `life_state × locomotion_state × combat_state × mount_state` masks
  activate which `presentation_kind_id`
- Also defines the `fallback_chain` of variant signatures to try
- Compiler-validated: `appearance_bundle.py:272`
- Runtime lookup: `FindActorBundleSelectorForRuntime()` `game.cpp:3435`
- Bundle storage: `appearance_bundle.json:4305` (idle_walk selector tables)
- Violation → wrong presentation family selected for current gameplay state

**CONTRACT 3 - Layer Ownership Contract**
> "This layer belongs to this owner, slot, presentation family, style, and geometry variant."

- Each `layer_definition` row in the compiled bundle is a unique binding of:
  `owner_definition_kind × owner_definition_id × slot_kind_id × presentation_kind_id
  × visual_style_id × variant_signature → layer_definition_id`
- Compiler emits this at `appearance_bundle.py:987`
- Runtime lookup: `FindActorBundleLayerExact()` and
  `ResolveActorBundleLayerWithFallback()` `game.cpp:3503/3606/3641`
- Bundle storage: `appearance_bundle.json:1728` (cyan_suit_body_idle example)
- Violation → wrong or missing layer found at render time

**CONTRACT 4 - Attachment Order Contract**
> "For this presentation family, paint layers in this slot order."

- Per-presentation slot compositing order: body → armor → shield → weapon → head
- Stored in `attack_attachment_metadata` and analogous tables at top of bundle
- Runtime lookup: `ResolveActorBundleAttachmentSlotOrder()` `game.cpp:3613`
- Bundle storage: `appearance_bundle.json:1`
- Violation → layers painted in wrong Z-order (e.g. hat under body)

**CONTRACT 5 - Network Appearance Contract**
> "Server and client agree on bundle identity and authoritative appearance state."

- Server and client both load the same compiled bundle (hashes verified at join)
- `STRUCT_BRC_JOIN` carries current `presentation_kind_id` + runtime state
- `STRUCT_BRC_APPEARANCE_STATE_V2` carries identity: `appearance_profile_id`,
  `skin_definition_id`, `mount_definition_id`, equipped slots
- Contract version gating: `STRUCT_REQ_JOIN_V2` carries `appearance_contract_version`,
  `bundle_hash`, `ids_lock_hash`; server rejects mismatches
- Server-side: `server_tick.cpp:2762`, `network.h:257`
- Client-side: `game.cpp:6337` (token `'a'` handler)
- Violation → client looks up layers from a different bundle than the server expects

---

### 2.14.5 Concrete Walkthrough: CYAN_SUIT_BODY_4TEST.xp

This walkthrough uses one specific asset to trace all 17 steps. Step markers
(`→ STEP N`) and contract markers (`→ CONTRACT N`) connect each paragraph to the
header block in §2.14.1 and the contract list in §2.14.4.

**Setup:**
- Asset file: `assets/sprites/CYAN_SUIT_BODY_4TEST.xp`
- Role: player body, idle/walk presentation
- Skin owner: `cyan_suit` (skin_definition_id = 100)
- Slot: `body` (slot_kind_id = 300)
- Presentation: `idle_walk` (presentation_kind_id = 600)
- Variant: `base/full/base` (height=base, width=base, silhouette=full)
- Actor: unmounted, carrying `gold_hat` (item 400) and `weapon_sword` (item 403)

---

**→ STEP 0** - You create `CYAN_SUIT_BODY_4TEST.xp`. At this point it is just art.
The game ignores it entirely.
*(Rule stated in `appearance_bundle.py:4` module docstring.)*

---

**→ STEP 1, CONTRACT 3** - In the bundle source manifest (`positive.bundle.json`),
a `layer_definition` entry declares:

```json
{
  "slug": "cyan_suit_body_idle",
  "contract": "idle_walk_character",
  "path": "assets/sprites/CYAN_SUIT_BODY_4TEST.xp",
  "presentation_kind_slug": "idle_walk",
  "slot_kind_slug": "body",
  "variant_signature": {
    "height_class": "base", "width_class": "base", "silhouette_class": "full"
  },
  "owner": { "kind": "skin", "slug": "cyan_suit" }
}
```

This is the ownership declaration layer of **CONTRACT 3**. The XP is claimed but not
yet validated.

Note: `CYAN_SUIT_BODY_4TEST.xp` gives you **one slice** of the skin family - idle body,
base variant. To fully support `cyan_suit` in gameplay you need attack and plydie sheets,
and typically tall/wide variant sheets. Each is its own STEP 1 entry. `idle_walk_character`
is one of the seven available contract families (→ CONTRACT 1 table).

---

**→ STEP 2, CONTRACT 1** - The compiler calls
`_inspect_sprite_asset("assets/sprites/CYAN_SUIT_BODY_4TEST.xp", "idle_walk_character")`
(`appearance_bundle.py:224`).

`idle_walk_character` requires (`appearance_bundle.py:72`):

```python
SPRITE_CONTRACTS["idle_walk_character"] = {
    "angles": 8,      # 8 facing directions
    "projs": 2,       # 2 projections per angle
    "anims": [1, 8],  # 1 idle frame + 8 walk frames
    "anchor_mode": "character",
}
```

The compiler opens `layer0 = xp.layers[0]` and reads:
- `metadata` = `{angles, projs, anims}` from the layer-0 metadata encoding.
  *(Metadata lives in layer 0 rows. Visual art may use XP layers 1+, but contract
  metadata comes exclusively from layer 0. Layer 0 carries both art and metadata -
  the metadata encoding uses the first three rows of layer 0.)*
- `row1_refs = [decode(layer0.data[1][0]), decode(layer0.data[1][1])]`
  *(Row 1 of layer 0 - Y-anchor offsets within the frame, used for per-frame
  alignment in the compositor; see `engine/sprite.cpp:489`.)*
- `row2_refs = [decode(layer0.data[2][0]), decode(layer0.data[2][1])]`
  *(Row 2 of layer 0 - depth values, bounded 0..15 for character sheets.)*

If any value mismatches the contract, the XP is rejected and cannot enter the bundle.
This is **CONTRACT 1** enforcement.

---

**→ STEP 3** - If validation passes, `_inspect_sprite_asset()` returns
(`appearance_bundle.py:215`):

```json
{
  "contract": "idle_walk_character",
  "frame_size": {"width": 7, "height": 10},
  "angles": 8, "projs": 2, "anims": [1, 8],
  "row1_refs": [2, 2], "row2_refs": [1, 1],
  "sheet_size": {"width": 126, "height": 80},
  "layer_count": 3
}
```

This asset record is stored inside `layer_definition.asset` in the compiled bundle
(`appearance_bundle.py:304`).

**This is what makes different geometry possible:** the runtime does not hard-code one
layout. Each layer carries its own geometry metadata so the compositor handles tall,
wide, and base bodies with different frame sizes without needing a second code path.

---

**→ STEP 4, CONTRACT 3** - The compiler looks up IDs and emits the row into
`bundle.catalog.layer_definitions` (`appearance_bundle.py:987`):

```json
{
  "id": 700,
  "slug": "cyan_suit_body_idle",
  "owner_definition_kind": "skin",
  "owner_definition_id": 100,
  "skin_definition_id": 100,
  "presentation_kind_id": 600,
  "slot_kind_id": 300,
  "variant_signature": {"height_class": "base", "width_class": "base",
                         "silhouette_class": "full"},
  "visual_style_id": 500,
  "asset": { "... geometry from STEP 3 ..." }
}
```

See this exact row in the compiled bundle at `appearance_bundle.json:1728`. This is
**CONTRACT 3** fully bound. The full `cyan_suit` family across all presentations and
variants spans:
- `appearance_bundle.json:1728` - `cyan_suit_body_idle` (idle, base)
- `appearance_bundle.json:1741` - `cyan_suit_body_idle_tall` (idle, tall)
- `appearance_bundle.json:1760` - `cyan_suit_body_idle_wide` (idle, wide)
- `appearance_bundle.json:1910` - `cyan_suit_attack` (attack, base)
- `appearance_bundle.json:~2110` - `cyan_suit_plydie` (plydie, base)

`skin_definition_id = 100` does **not** point to one sheet. It points to a family of
layer definitions across presentations and variants. The presentation + variant together
pick the exact row inside that family.

---

**→ STEP 5, CONTRACT 5** - When the player joins, the server calls
`SvrSelectJoinAppearanceProfile()` (`server_tick.cpp:4587`) which calls
`SvrApplyProfileToAppearance()` (`server_tick.cpp:2505`). The authoritative appearance
state is populated with:
- `appearance_profile_id` (the chosen starter profile)
- `skin_definition_id = 100` (cyan_suit body owner)
- `entries[]` - starter loadout entries (e.g. gold_hat in head slot)

**CONTRACT 5 boundary:** the server owns appearance identity. The client does not
invent skins or gear.

---

**→ STEP 6, CONTRACT 5** - The server sends two packets.

`STRUCT_BRC_JOIN` (`network.h:284`) carries current runtime state:
```c
uint16_t presentation_kind_id;  // e.g. 600 = idle_walk
uint8_t  life_state;
uint8_t  locomotion_state;
uint8_t  combat_state;
uint8_t  mount_state;
```

`STRUCT_BRC_APPEARANCE_STATE_V2` (`network.h:307`) carries appearance identity:
```c
uint16_t appearance_profile_id;   // which starter profile
uint16_t skin_definition_id;      // = 100 (cyan_suit body owner)
uint16_t mount_definition_id;     // = 0 (unmounted)
// entries[]:
//   {slot_kind_id=301, item_definition_id=400, visual_style_id=500} ← gold_hat in head
//   {slot_kind_id=303, item_definition_id=403, visual_style_id=500} ← sword in weapon
```

The two packets carry orthogonal information. `presentation_kind_id` is runtime state
(what the actor is doing). `skin_definition_id` is appearance identity (which body
owner). They are in separate structs deliberately. *(→ Abstraction Hierarchy §2.14.2,
Glossary: presentation_kind_id, skin_definition_id)*

---

**→ STEP 7** - The client receives token `'a'` and copies the V2 packet into
`sn->appearance_v2` (`game.cpp:6337`). No rendering happens yet. The client now holds
authoritative appearance truth.

---

**→ STEP 8, CONTRACT 2** - At render time the engine calls
`FindActorBundleSelectorForRuntime()` (`game.cpp:3435`) with current state masks.
For an idle on-foot player:
- `presentation_kind_id = 600`
- `locomotion_mask` matches idle
- `life_mask` matches alive
- `combat_mask` matches unarmed

The selector table for `idle_walk` is at `appearance_bundle.json:4305`. This is
**CONTRACT 2** - the selector input contract. The matching selector also carries the
variant fallback chain.

---

**→ STEP 9** - `ResolveActorDesiredVariantSignature(selector)` (`game.cpp:3532`)
returns `selector->fallback_chain[0]` = `base/full/base` for a standard-size actor.
The fallback chain is declared in the bundle and compiler-validated
(`appearance_bundle.py:533`).

---

**→ STEP 10, CONTRACT 3** - `ResolveActorBundleLayerWithFallback()` looks up the
body layer (`game.cpp:3606`):

```
owner_kind = SKIN
owner_id   = 100  (skin_definition_id = cyan_suit)
slot       = body (300)
style      = default (500)
signature  = base/full/base
```

→ finds `layer_definition_id = 700` (`cyan_suit_body_idle`, `appearance_bundle.json:1728`).

If the actor were wide: signature = `wide/full/base` → finds `cyan_suit_body_idle_wide`.
If the wide variant were absent: `ResolveActorBundleLayerWithFallback()` walks the
fallback chain and may land on `base/full/base` (base hat on wide body - fallback
selection, not stretching). This is **CONTRACT 3** lookup plus fallback behavior from
**CONTRACT 2**'s fallback chain.

---

**→ STEP 11, CONTRACT 3, CONTRACT 4** - The attachment order for `idle_walk`
(`appearance_bundle.json:1`, CONTRACT 4) is:

```
body → armor → shield → weapon → head
```

For each slot in this order, `ResolveActorBundleLayerWithFallback()` is called
(`game.cpp:3641`):

- **head slot (301):** `item_definition_id = 400` (gold_hat)
  → finds `gold_hat_idle_base` (`appearance_bundle.json:2445`)
  *(Why is there a separate `gold_hat_idle_base` rather than one generic hat entry?
  Because the hat needs different per-frame pixel placement and geometry compatibility
  in idle vs attack. `gold_hat_idle_*` and `gold_hat_attack*` are separate layer
  entries: `appearance_bundle.json:2445` vs `appearance_bundle.json:3608`.)*

- **weapon slot (303):** `item_definition_id = 403` (weapon_sword)
  → finds `weapon_sword_idle` (`appearance_bundle.json:3560`)

`item_definition_id` is both the gameplay identity and the render-owner key. The body
layer is NOT "player with hat baked in." It is the `cyan_suit` body layer, with
independent item-owned layers attached on top.

---

**→ STEP 12** - (Embedded in STEP 10-11.) If gold_hat has no wide variant and the
actor is wide, `ResolveActorBundleLayerWithFallback()` (`game.cpp:3503`) walks the
fallback chain until it finds any matching layer. This may produce a base-variant hat
on a wide body, which is visually approximate but mechanically valid. The fallback
chain order is declared in **CONTRACT 2**.

---

**→ STEP 13, CONTRACT 4** - After all slots are processed, the render array contains:

```
body:   cyan_suit_body_idle   (layer_definition_id = 700)
weapon: weapon_sword_idle     (layer_definition_id ≈ 736)
head:   gold_hat_idle_base    (layer_definition_id = 717)
```

`FillActorBundleRenderArrays()` (`game.cpp:3673`) flattens these into parallel arrays.
Slot order follows **CONTRACT 4**.

---

**→ STEP 14** - `LookupActorBundleComposedSprite()` (`game.cpp:3822`) builds a
cache key from the render array. On cache miss it:
1. Loads/clones the base (body) layer sprite
2. Composites each additional layer in render order onto the clone
3. Caches the result

What gets cached is the composed sprite for this specific
`presentation × skin × variant × loadout` tuple. Subsequent frames for the same
combination skip composition and hit the cache directly.

---

**→ STEP 15** - `ResolvePresentationFrame()` (`game.cpp:8039`) picks the animation
frame index:
- Standing idle → frame 0
- Walking → frame cycling by tick
- Attacking → progression from `presentation_started_tick`
- Dying → `ActorBundleDeathPlaybackMetadataAllows()` playback sequence

---

**→ STEP 16** - The composed sprite from STEP 14 at the frame from STEP 15 produces
the final on-screen pixels.

---

### 2.14.6 Model Clarifications

These are the terms most commonly misread. Read these before touching the bundle
system.

**`presentation_kind_id` is the actor's current render verb, not its outfit.**

The `_id` suffix suggests it is a lookup key (it is), but `presentation_kind` is a
property of runtime state, not appearance identity. It is closer to "what animation
family is the actor in right now" than to "what does the actor look like to other
players." It does not encode which skin the actor wears, which wearables they carry,
or which camera angle is used. The name is partly historical (the pre-bundle sprite
system used presentation kind as a broader state identifier) and partly accurate:
it identifies the *kind* of presentation state - idle/walk, attack, plydie. If you
see `presentation_kind_id = 600` that tells you "this actor is in the idle_walk
presentation family right now" and nothing about their skin or equipment.

**`skin_definition_id` is the body-owner family identity, not a body part.**

`cyan_suit` (skin_definition_id = 100) does not point to the character's torso section.
It points to the whole body-owner family: the collection of body layer definitions
that `cyan_suit` supplies across all presentations and variants. The actual torso slot
is `slot_kind_id = body (300)`. Saying `skin_definition_id = 100` means "use the
`cyan_suit` body-owner family to look up the body layer." The head, weapon, and shield
layers are owned by items (via `item_definition_id`), not by the skin.

**`variant_signature` is geometry class, not style/color.**

`base/full/base` means `height_class=base, silhouette_class=full, width_class=base`.
Style and color are `visual_style_id` (`default=500`, `gold`, `dark`). Wide and tall
actors are geometry variants, not style variants. The three axes of `variant_signature`
are independent - `tall+wide` is a valid combination. The count of usable combinations
is not hardcoded - it is bounded by the token sets declared in the compiler and bundle.
Adding a `super_tall` height class would require extending both.

**`silhouette_class` is one coordinate inside `variant_signature`, not the whole tuple.**

`variant_signature` = the three-axis tuple `{height_class, width_class, silhouette_class}`.
`silhouette_class` = one field within that tuple. Confusing the two leads to incorrect
fallback chain reasoning.

**Item-owned layers are looked up independently per slot, not baked into the skin sheet.**

`skin_definition_id = 100` does not mean "the body sheet that also has the hat drawn
on it." The hat layer is looked up separately from `item_definition_id = 400` (gold_hat)
in the head slot. The runtime compositor stacks independent layers at render time.
Pre-baked combo sheets (the legacy AHSW path, §2.1) exist in the engine for backward
compatibility, but the bundle system looks up and composes layers individually.

**`gold_hat_idle_base` and `gold_hat_attack` are separate layer definitions for a reason.**

The hat requires different per-frame art and pixel placement in attack versus idle.
Attack frames have different silhouettes and frame geometry. The bundle does not
auto-warp one hat sheet across all body actions; each presentation family gets its
own layer entry.

**If a wide actor equips an item that only has a base variant, the system uses fallback,
not stretching.**

`ResolveActorBundleLayerWithFallback()` walks the selector's `fallback_chain`. The
first matching variant in that chain is used. The result may be a visually approximate
"base hat on wide body," but the mechanism is chain lookup, not pixel scaling.

**Metadata comes from layer 0 of the XP, not from XP layers 1+.**

`row1_refs` and `row2_refs` are decoded from `layer0.data[1]` and `layer0.data[2]`
(rows 1 and 2 of XP layer 0). XP layers 1+ are visual layers preserved as part of
the sprite asset, but the compiler's contract metadata (angles, projs, anims, row refs)
comes exclusively from layer 0.

---

### 2.14.7 Pipeline-V3 Authoring Implication

The walkthrough above shows what the pipeline-v3 workbench must produce for STEP 1
(manifest declaration) and STEP 2 (contract validation). The pipeline does not own the
runtime (STEP 5 onward - those belong to the game server and engine). The pipeline's
job is:

1. Help an author produce an XP that passes STEP 2 (→ `asset layout contract`,
   `SPRITE_CONTRACTS`, structural gates G10-G12)
2. Help declare the manifest entry for STEP 1 (→ `layer_definition` rows in
   `positive.bundle.json`)
3. Produce a validated compiled bundle for STEP 3/4 (→ `appearance_bundle.json`)
4. Inject the compiled bundle into the runtime for smoke test (→ Section 2.4)

Pipeline-v3 does not yet produce `layer_definition` entries in the Y9-2 bundle format
(`appearance_bundle.py` sense). The current pipeline produces action-tab XP files
named by the AHSW legacy convention (§2.1). The transition from the legacy AHSW
authoring surface to the generalized bundle identity model is the core open work in
`UQ-004` through `UQ-007`.

---

## Section 2.15 — Y9-2 Runtime System Deletion And Replacement Contract

**Added 2026-05-12. Source: FL-3912 architectural diagnosis.**

> **HISTORICAL / SUPERSEDED TARGET (2026-06-11):** This section was inserted
> after Section 3 during the May 12 Y9-2 RenderPlanTable transition and remains
> here as a historical appendix. The active 2026-06-09 status correction at the
> start of Section 2 overrides any `render_plans.json` or `RenderPlanTable`
> output obligation below. Latest fetched Y9-2 `origin/main` has moved to
> ActorVisualProfile generated-table artifacts
> (`scripts/compile_actor_visual_profiles.py`,
> `engine/actor_visual_profile_table.generated.h`,
> `engine/actor_visual_profile_runtime.h`), and that production compiler does
> not consume authored pipeline-v3 profile JSON. Use this section only as the
> deleted-transition-owner record unless a later canon update reactivates it.

This section originally established what had to be deleted from the Y9-2 game
runtime, what the May 12 RenderPlanTable transition expected to replace it, and
how pipeline-v3 compiler output obligations would have changed for that target.
After the 2026-06-09 correction above, it is retained as lineage and deletion
context only. Active compile/runtime obligations are governed by the current
Section 2 status correction, §2.5 misalignment ledger, §2.10 shared contract,
and Unified Queue rows.

### 2.15.0 Governing Law

The Y9-2 runtime may not resolve visual meaning. It may only:

1. load a compiler-emitted `RenderPlanTable`
2. perform an exact `ServerVisualKey` lookup
3. load sprite assets for the returned ordered layer list
4. compose layers bottom-up
5. cache the composed sprite keyed by `hash(ServerVisualKey + bundle_hash)`

Any missing `ServerVisualKey` is a hard compile-time rejection. The runtime
must not search selectors, walk fallback chains, infer attachment order,
special-case mounted compose, insert default body/head layers, validate
admission tables, resolve conditional layer searches, or perform slot-order
inference at runtime. If the compiler did not emit a plan for a given key, the
runtime produces no output for that key and reports a missing-plan error.

The governing equation is:

```
server-owned AppearanceStateV2  →  ServerVisualKey  →  exact RenderPlanTable lookup  →  ordered layer composition
```

Nothing else is permitted in the gameplay render path.

### 2.15.0.1 Rig Seam Definition

**Added 2026-05-12. Source: Y9-2 multiplayer-canonical-spec update.**

A `rig_definition_id` integer is **not** a complete 2D rig seam. A
conventional, addable rig seam means authored, stable attachment contracts
that future sprite assets can plug into without C++ branches:

- Named sockets/anchors/semantic regions: `rider_pelvis`, `mount_saddle`,
  `weapon_grip`, `mount_rear_occlusion`, `mount_front_occlusion`
- Angle-aware x/y transforms and visibility/flip rules per attachment point
- Explicit layer-order relationships for rear mount, rider body, wearables,
  weapon, and front occluder
- Compiler owns this math and emits final RenderPlan rows; runtime only
  presents the ordered layers

`rig_definition_id` is a **selector dimension** — a routing hook that lets
the compiler pick between authored rig contracts. It is the minimum required
ID field, not the contract itself.

**Current state (2026-05-12):** `rig_definition_id` is an authored selector
dimension in the Y9-2 spec, but: (a) it is absent from all engine code and
pipeline-v3 surfaces (FL-3867); (b) no authored socket/anchor/layer-order
contract data exists in any bundle schema; (c) mounted wolf + crossbow
alignment has not passed live human visual proof. The rig seam cannot be
called complete until (a)–(c) are satisfied.

### 2.15.1 Deletion List — Y9-2 Runtime Visual-Resolution System

The following components must be deleted from the Y9-2 runtime gameplay path.
This is a **deletion list, not a migration list**. Patching or wrapping these
components is not acceptable; they are the architectural bug.

| Component | File / Symbol | Why it must be deleted |
|-----------|--------------|------------------------|
| Runtime layer resolver | `engine/bundle_layer_resolver.cpp` | Resolves conditional body layers, conditional item layers, conditional mounted admissions, fallback bits, attachment order, default head behavior, and mount-specific admission/body/item lookup at runtime. Compiler and runtime can disagree on any axis. |
| Runtime admission validator | `engine/bundle_runtime_admission_validator.cpp` | Performs admission/index validation for mounted rows, body rows, item rows, duplicate detection, satisfiable contract records, and mount-index lookup at runtime. Runtime validation compensating for the compiler not emitting a sealed render plan. |
| Mounted compose runtime | `engine/mounted_compose_runtime.h` and all special mounted admission logic | Runs mounted-specific composition, front/rear selection, parity records, and rider-overlay gap decisions at runtime. Mounted is not a special case; it is layer order `[mount_rear, body, wearables, mount_front]` emitted by the compiler. |
| Resolved-layer cache | `engine/ActorAppearanceBundleCache` entries for selectors, layers, slot kinds, items, mounted admissions, admitted mount body layers, admitted mount item layers, attachment orders, death playback, mounted contract records, mount indexes, composed cache entries | This cache is a runtime database plus resolver, not a flat compiled render table. The replacement is `composed_sprite_cache.cpp` keyed by `hash(ServerVisualKey + bundle_hash)` only. |
| Selector mask interpretation | All code converting presentation/life/locomotion/combat/mount masks into render decisions | Mask-to-selector conversion is compiler work. The runtime receives an already-resolved ordered list; it does not interpret masks. |
| Runtime fallback chains | All `LookupPresentationSprite()` fallback walks and family-fallback-chain resolution for gameplay render | Fallback is a compile-time error surface, not a runtime recovery strategy. Missing compile-time coverage is a compiler rejection, not a silent fallback. |
| Body-slot skip logic | Any runtime code that inserts or skips default body/head/item layers based on runtime slot state | Layer insertion is compiler work. The compiler emits every layer; the runtime pastes them in order. |
| Mounted special compose path | `FillActorBundleRenderArrays` pre-step runtime search that produces the `[rear, body, item layers, front]` stack dynamically | The final stack shape is correct. The runtime search that produces it is not. The compiler must emit the stack directly. |
| Watchdog/analyzer visual compatibility truth | Any watchdog or analyzer shim that serves as a render authority or fallback source during gameplay | Watchdog is observational only (Law 4). It may not be a runtime visual owner or fallback source. |

Components listed above may temporarily remain behind a **test-only comparison
harness** during migration. They must not be in the gameplay render path after
the `RenderPlanTable` path passes proof.

### 2.15.2 Replacement List — New Y9-2 Runtime Modules

The replacement runtime is four modules only:

| Module | Purpose |
|--------|---------|
| `compiled_bundle_loader.cpp` | Parse compact JSON or binary `render_plans` block into `RenderPlanTable` in memory |
| `render_plan_lookup.cpp` | Hash `ServerVisualKey`, return pointer to `RenderPlan` or null (never infer) |
| `sprite_compositor.cpp` | Paste ordered layers bottom-up per `RenderPlan.layers[]` |
| `composed_sprite_cache.cpp` | Cache composed sprites keyed by `hash(ServerVisualKey + bundle_hash)` |

The runtime lookup call must be:

```cpp
RenderPlan* plan = bundle.lookup(server_visual_key);
if (!plan) fail_hard_no_plan(server_visual_key);
Sprite* sprite = compose(plan->layers);
```

No other runtime visual-resolution code may exist in the gameplay path.

### 2.15.3 Historical Compiler Output Obligation — `render_plans.json`

The May 12 transition target required the Y9-2 appearance bundle compiler
(`scripts/pipeline/appearance_bundle.py`) to emit `render_plans.json` as the
primary compiled artifact. That is no longer the active target in this canon.
Latest fetched Y9-2 `origin/main` deleted the old transition owners and now
emits ActorVisualProfile generated-table artifacts from server reachability and
upstream sprite resolver/load semantics. The current obligation is semantic:
the emitted runtime artifact, whatever its filename, must be provenance-stable,
runtime-accepted, and headed-proofed for the claimed content path. Pipeline-v3
profile JSON remains draft-only until Y9-2 consumes authored profile data.

**Historical `render_plans.json` schema retained for context only:**

```json
{
  "bundle_hash": "<hash>",
  "schema_version": 1,
  "asset_table": {},
  "slot_table": {},
  "presentation_table": {},
  "render_plans": [
    {
      "key": {
        "entity_kind": "character",
        "skin": "<skin_id>",
        "presentation": "<presentation_kind>",
        "variation": "<variation or null>",
        "mount": "<mount_id or null>",
        "equipped": {
          "<slot_name>": "<item_id or null>"
        }
      },
      "layers": [
        {
          "role": "<mount_rear|body|wearable|mount_front|effect>",
          "asset": "<relative asset path>",
          "slot": "<slot name>",
          "z": 0,
          "offset": [0, 0]
        }
      ],
      "frame_contract": {
        "angles": 8,
        "projs": 2,
        "anims": [8],
        "frame_size": [168, 108]
      },
      "rig_contract": null
    }
  ]
}
```

**Compiler completeness law:** The compiler must enumerate every
server-authorable visual key combination:

- `skin` × `presentation_kind` × `variation` × `equipped slot combinations` × `mount_state`

For each combination, the compiler must either emit exactly one `RenderPlan`
with a fully ordered layer list, or reject the bundle with an explicit
missing-plan error that names the missing key and the layers needed to satisfy
it. No combination may be silently absent.

**Layer ordering law:** Every emitted plan must order layers as:

1. `mount_rear` (if mounted)
2. `body`
3. wearable slots in compiled slot order
4. `mount_front` (if mounted)
5. effects (future)

No runtime-side ordering, insertion, or conditional pruning is permitted.

**Crossbow and mounted are not exceptions:** `crossbow_attack` is a `variation`
key. `wolf_mount` is a `mount` key. They produce normal `RenderPlan` rows.
There is no C++ special case, no mounted-compose branch, and no weapon
exception in the replacement architecture.

### 2.15.4 Current Pipeline-V3 Authoring Implication

Pipeline-v3 does not own the Y9-2 runtime replacement. That work lives in the
Y9-2 game repo. Pipeline-v3 must therefore avoid claiming that its current
workbench output compiles into live Y9-2 runtime rows.

Current obligations:

1. **XP authoring obligation:** help an author produce XP files that pass the
   live structural gates for the selected template/family.
2. **Draft profile obligation:** if the workbench emits ActorVisualProfile JSON,
   label it as a draft artifact until latest Y9-2 production compilation consumes
   authored profile JSON.
3. **Semantic completeness obligation:** any future shared compile path must
   prove the complete server-authorable visual key space for the selected content
   path, regardless of whether Y9-2 names the emitted artifact
   `render_plans.json`, a generated header, or another runtime table format.
4. **Runtime proof obligation:** no pipeline-v3 proof may claim Y9-2 integration
   from Skin Dock preview alone. Runtime acceptance plus headed proof of the
   claimed Y9-2 path remains mandatory.

The pipeline-v3 authoring surface does not need to change its XP editing
workflow to satisfy this historical section. The needed product change is honest
labeling and a future shared authoring seam, not a revived `render_plans.json`
target.

### 2.15.5 Impact On Queue And Gates

| Item | Change |
|------|--------|
| `UQ-R15` | Historical May 12 transition row. Do not use it as the active pipeline-v3 blocker unless a later Y9-2 canon update reactivates a RenderPlanTable target. Current Y9-2 origin uses ActorVisualProfile generated-table artifacts. |
| `UQ-008` mounted parity | Still proof-blocked, but not on `UQ-R15`. `mounted_authoring_e2e` must prove generated mounted output, latest Y9-2 runtime acceptance, headed visual correctness, and no legacy fallback in the claimed path. Authored socket/anchor contracts and mounted wolf + crossbow alignment remain proof obligations. |
| Historical blocking gate (§2.15) | `render_plans.json` emitted by compiler — SUPERSEDED by latest Y9-2 ActorVisualProfile generated-table artifacts. |
| Historical blocking gate (§2.15) | Mounted crossbow attack through `RenderPlanTable` — SUPERSEDED as a named artifact target; the remaining active obligation is runtime acceptance and headed proof through the latest Y9-2 generated-table path. |
| Deletion progress (2026-05-12) | Historical FL-3912 transition evidence. Keep for lineage only; do not treat local-stale FL-3861..FL-3868 numbering as the active latest-origin bundle target. |

The existing blocking gates for `UQ-008` and generalized bundle-port readiness
remain open, but they are no longer gated on `UQ-R15` completion. They are gated
on the latest Y9-2 ActorVisualProfile runtime path accepting the claimed content
and on headed proof showing the content is selected without legacy fallback.

## 2.16 Operator-Directed V3 Product Audit — Browse-First Editor, Adaptive Stroke Brush, And Refrog Skin

**Observed 2026-10-12 on `fl4306-evidence-sidebar` at `6b77032` plus the
documentation-only rejection log commit `c84d395`. Audit only: no product code,
deployment, or acceptance proof changed in this checkpoint.**

The operator rejected the hosted `/xpedit` page as a sufficient identification
of the V3 product and reaffirmed the existing product frame: a first-class
whole-sheet editor in Browse, recognizable as a REXPaint clone, with the custom
stroke-aware glyph brush and `Test This Skin` as its defining extensions. The
current interface and capability surface do not yet satisfy that frame.

### 2.16.1 Directly Observed State

| Area | Evidence inspected | Audit result |
|------|--------------------|--------------|
| Whole-sheet ownership | `web/whole-sheet-init.js`; §§1.1, 1.8, and the XP editor acceptance contract | The root editor already owns whole-sheet document state, and Paint/Browse are peer modes. The implementation has a Browse document list, but the surrounding workbench still presents the editor as one dense panel among pipeline/debug surfaces rather than a first-class Browse app. |
| Adaptive brush | §1 REXPaint draw-mode contract; `docs/WORKBENCH_DOCS_ARCHIVE.md`; `web/rexpaint-editor/tools/`; `web/whole-sheet-init.js`; all five remote branch tips and repository history | **Longstanding plan, missing implementation.** The canonical spec has required Cell alternate mode `Auto-wall/auto-box drawing` since commit `4abfd5a7` (2026-04-17). Archived plans call it context-sensitive wall-glyph selection and track it as Feature 35/37. Current `CellTool` and line/shape adapters still receive one selected glyph and apply that fixed glyph. The 2026-10-12 audit initially missed the established `auto-wall`/`auto-box` name and incorrectly described the requirement as newly planned; this row corrects that error. The operator also reports a later implementation, whose exact source still must be recovered rather than replaced with generic line-tool code. |
| Visual language | `web/styles.css`; `web/workbench.html` | The shipped shell uses a dark navy palette (including `#182131`, `#0f1420`, `#173860`, and related blues). The static HTML alone defines 122 buttons and 264 IDs before additional whole-sheet controls are built in JavaScript. This is the dense dark-blue surface the operator rejected. |
| Refrog source | live GitHub read of `rikiyanai/refrog-app`, default branch `master`, observed 2026-10-12 | Refrog's canonical theme is `terminal`: white backgrounds, black text/borders, square zero-radius controls, 2 px DOS-style borders, and bundled `XanhMono-Regular.ttf` / `XanhMono-Italic.ttf`. `Xanh_Mono/OFL.txt` is present and the repository README declares MIT for the app. V3's current `DepartureMono-Regular` reference is not evidence of the Refrog font and must not be relabeled. |
| Action coverage | `config/template_registry.json`; §§2.3.8–2.3.10, 2.9.1, 2.11, and the normalized XP inspector's read-only family topology contracts | The live authoring registry is already broader than three tabs: on-foot `player`, `attack`, `plydie`, plus authorable mounted `wolfie` and `wolack`; `bigbee` remains deferred and green variants remain proof-only. The normalized inspector is useful evidence but explicitly not runtime authority. The current product must derive enabled actions from the V3 registry and Y9-2 runtime identity contract, not hard-code idle/attack/death as the whole product. |
| Repository readiness | `python3 scripts/conductor_tools.py status --auto-setup`; `python3 scripts/self_containment_audit.py`; `docs/INDEX.md` | Conductor reports READY, but self-containment fails with 47 blocking findings and 354 warnings. The index also cites missing `docs/AGENT_PROTOCOL.md` and root `CLAUDE.md`; the existing protocol is at `docs/agents/AGENT_PROTOCOL.md`. These defects block a truthful build/runtime/push-ready claim but do not invalidate the source-level product audit. |

### 2.16.2 Product Boundary And Information Architecture Decision

The supported product is one editor application, not a pipeline dashboard with
an editor embedded inside it:

1. **Browse is the front door.** It lists XP documents and keeps the selected
   document's whole sheet visible. Open, rename, duplicate, delete, and new-file
   operations act on root editor documents.
2. **Edit is the document workspace.** It preserves REXPaint's whole-sheet,
   layers, glyph, color, selection, and drawing model. Browse and Edit are modes
   of the same document owner; neither may create a second state owner.
3. **Auto-wall/auto-box Adaptive Stroke is a first-class drawing tool.** This is
   the already-planned alternate Cell mode, not a new 2026-10-12 invention. A
   pointer stroke chooses context-sensitive wall glyphs from stroke
   direction/continuity rather than stamping one glyph at every visited cell.
   The later operator-referenced implementation should be recovered so its
   exact glyph vocabulary and junction/corner behavior are preserved.
4. **Test This Skin is the singular runtime handoff.** It tests the current
   whole-sheet/bundle state in Skin Dock. Alternate preview, launch, stream, and
   verifier controls are implementation/support surfaces, not equal primary
   calls to action.
5. **Action navigation is registry-driven.** Present every currently authorable
   family/action required by `template_registry.json`, including mounted idle
   and mounted attack when their registry gates permit them. Deferred and
   proof-only families must stay visibly classified instead of disappearing or
   masquerading as completed authoring support.

### 2.16.3 Control Reduction Decision

The default shell keeps only the controls needed for the product loop:

- **Persistent app controls:** Browse/Edit, New, Open, Save, Export, Test This
  Skin, and Report Bug.
- **Edit controls:** Adaptive Stroke, Cell, Line, Rectangle, Oval, Fill, Text,
  Select, Pick, Erase, glyph, foreground/background color, layers, undo/redo,
  zoom, and grid.
- **Browse controls:** document list, open, rename, duplicate, delete, refresh,
  and New.
- **Contextual action controls:** registry-derived family/action navigation and
  readiness state; not a permanently hard-coded idle/attack/death trio.

The following controls leave the default product chrome. They may survive in a
clearly labeled Advanced/Diagnostics surface only when still required by a
verified workflow: PNG conversion and slicing controls, recorder controls,
manual verification and dry-run controls, TERM++ launch/stream controls,
separate preview/reload/apply variants, mounted calibration/review internals,
legacy frame-inspector duplicates, and duplicate Save/Open/Export entrypoints.
Removing a button from default chrome does not authorize deleting its capability
until route and test ownership are traced.

### 2.16.4 Refrog Presentation Pin

The presentation target is pinned to the observed Refrog terminal theme, not to
a vague "less blue" interpretation:

- Xanh Mono regular as the UI typeface, vendored self-contained with its OFL;
- white primary canvas/shell and light-gray secondary surfaces;
- black text, focus, controls, and two-pixel square borders;
- zero border radius; no navy gradients, glowing cards, or generic blue primary
  buttons;
- compact spacing and hierarchy through typography/borders, not card volume.

Port the tokens and font assets; do not import Refrog's React Native component
system or add a runtime dependency on another checkout.

### 2.16.5 Required Implementation Order And Gates

1. **Restore the planned brush.** Start from the canonical REXPaint Cell
   alternate-mode contract and archived context-sensitive auto-wall/auto-box
   plan. Locate the operator-referenced later implementation and record its
   source commit, input/output behavior, CP437 vocabulary, and tests. A generic
   fixed Bresenham line is a falsifier, not an acceptable substitute.
2. **Add a failing brush contract test first.** It must cover horizontal,
   vertical, both diagonal directions, direction changes/corners, revisiting a
   cell, bounds, one undo transaction per stroke, apply-mode interaction, and
   pointer cancel.
3. **Make Browse the first-class shell without changing document ownership.**
   Preserve `whole-sheet-init.js` as sole root owner and prove Browse→Open→Edit→
   Save round trips the same document.
4. **Collapse default controls before reskinning.** Route duplicates to their
   surviving owner; do not leave hidden competing state paths.
5. **Apply the Refrog token/font pin as a presentation slice.** Vendor the font
   and license inside V3, then verify contrast, overflow, desktop, and mobile.
6. **Expand action navigation from registry truth.** Prove on-foot and mounted
   authorable rows are represented honestly; keep deferred/proof-only status.
7. **Run the real product loop:** Browse → Open/New → adaptive stroke edit →
   Save → Export → Test This Skin. Only UI-reachable controls count. Root-hosted
   and prefixed deployments both require proof before any `PASS`, `parity`, or
   `fixed` claim.

### 2.16.6 Current Verdict

**SUPERSEDED BY THE 2026-10-12 LOCAL IMPLEMENTATION CHECKPOINT BELOW AND THE
2026-10-13 LANE-D EVIDENCE CHECKPOINT AT THE END OF THIS FILE.** At the time
of this audit, the Browse-first shell, slope brush, Refrog presentation,
control reduction, registry action selector, and mobile keyboard bridge were
not implemented. They now exist locally at `5554f32`, extended at `993bec7`
(normalized-contract `Test This Skin` handoff, Browse selected-sheet preview,
Open-stays-in-Edit, Layers-Edit-only, raw-XP primary path, CP437 shade
ladder, slope hardening contracts). Stage of each slice: Implemented and
Connected; headed verification, operator acceptance, and deployment are still
open. The end-to-end mobile authoring and PNG-conversion flow is incomplete;
`Test This Skin` is not yet proven on the normalized-contract CP437 runtime
handoff against the current document; exact later-brush provenance is
unrecovered; and self-containment still fails (38 stored CE-review JSON refs
under `.context/`, disposition recorded in the failure log). No deployment or
acceptance claim follows from the local checkpoint.

---



**Added 2026-04-22. Tracks what must be true before a V3 migration is declared ready.**

This section lists the open gaps identified by the 2026-04-22 cross-repo audit. It is
not a task plan - it is a gate list. Migration is ready when all blocking gates PASS.

### Blocking Gates

| Gate | Section | Status |
|------|---------|--------|
| UQ-002 Section 1 REXPaint-parity foundation passes | §Unified Queue `UQ-002` | PASS - root-editor parity blockers closed in current worktree; whole-sheet ownership, resize, and hot-path proof are logged with same-day evidence |
| UQ-003 root-hosted + prefixed Section 1 proof passes | §Unified Queue `UQ-003` | PASS - headed shipped-UI proof exists for root-hosted and prefixed `/xpedit` whole-sheet flows |
| UQ-004 backend authority cleanup passes | §Unified Queue `UQ-004` | CLOSED - `ENABLED_FAMILIES` and `FAMILY_W_RANGE` hardcoded maps deleted (`a58eda6`..`e23fd3f`); all override-name paths derive from registry `prefix_catalog.ahsw_range`. `preview_xp -> l0_ref` fallback fail-closed. Registry load/fetch errors return 503 and surface as browser warnings — empty truth not cached. |
| UQ-005 export/web-skin quality contract fully enforced | §Unified Queue `UQ-005` | CLOSED — export/web-skin paths share live G7-G12 enforcement. Canonical `/api/workbench/validate-xp` route + MCP `validate_xp` tool added. G8/G9 threshold policy locked in `gates.py` with named policy constants. |
| UQ-006 manifest-backed source authoring no longer JSON-first | §Unified Queue `UQ-006` | OPEN |
| UQ-007 runtime identity layer landed | §Unified Queue `UQ-007` | CLOSED - `config/runtime_identity_registry.json` owns live `skin_definition_id` / `presentation_kind_id` / `layer_definition_id` values and backend/helper/export/payload surfaces emit them |
| UQ-008 mounted-family parity for `wolfie` / `wolack` proven | §Unified Queue `UQ-008` | PROOF BLOCKED - native builders, authorable registry state, and browser/backend artifact surfaces exist; `mounted_authoring_e2e` runtime proof still must prove generated mounted output, latest Y9-2 ActorVisualProfile runtime acceptance, headed visual correctness, and no legacy fallback in the claimed path. Authored socket/anchor contracts and mounted wolf + crossbow alignment remain unproven via human visual proof. Old resolver proving mounted rows is not acceptable evidence. |
| UQ-009 current-scope Section 3 signoff + contract runners current | §Unified Queue `UQ-009` | PARTIAL |
| UQ-010 Y9-2 wizard / launcher gateway wired to shared bundle-authoring contract | §Unified Queue `UQ-010` | GATED OPEN OBLIGATION — converges launcher, wizard, MCP, browser, CLI on one shared headless bundle-authoring contract only after its technical prerequisites pass or the operator separately reprioritizes that gateway |
| UQ-011 cutover support gates ready (`§2.11`, `§2.12`) | §Unified Queue `UQ-011` | PARKED — frozen-SHA public cutover, rollback, credential, deploy-path, live headed proof; starts only on explicit operator cutover authorization |
| UQ-R15 Y9-2 runtime visual-resolution system deleted and replaced by `RenderPlanTable` | §2.15 | OPEN — §2.15.1 deletion list components still present in gameplay path; `render_plans.json` not yet emitted by compiler; no proof that one mounted crossbow attack `ServerVisualKey` renders through replacement path with no call into deleted components. FL-3861. |
| FL-3862 Runtime Parser Gate — `verify-current` and `build-web.sh` must invoke C++ parser | §2.10 / §2.15 | OPEN — build-web.sh line 129 runs Python-only validation; C++ runtime parser never called; mandatory before any `RenderPlanTable` proof claim. |
| FL-3863 `ActorVisualProfile` authored object — pipeline-v3 missing data structure | §2.5 | OPEN — no structure captures skin_id, variation, body/wearable/mount layer assignments; `runtime_identity_registry.json` covers IDs only. |
| FL-3864 Bundle System Guide rewrite — must explain Content DB → RenderPlanTable | §2.10 / §2.15 | OPEN — launcher guide at `_show_bundle_system_guide()` documents old selector architecture; content authors will learn wrong model. |
| ActorVisualProfile authored-object gap | §2.5 | OPEN — pipeline-v3 has a schema/route/button, but generated profiles are scaffolding and latest Y9-2 production compilation does not consume authored profile JSON. Use `FL-BA-05` / `FL-BA-06` for current tracking rather than local-stale FL-3863 numbering. |
| Historical FL-3865 / FL-3866 RenderPlanTable blockers | §2.15.1 / §2.15.3 | SUPERSEDED AS ACTIVE PIPELINE-V3 GATES — retain only as May 12 lineage. Current active gate is latest Y9-2 runtime acceptance plus headed proof for generated ActorVisualProfile table artifacts, with no legacy fallback in the claimed path. |
| Rig/socket/anchor contract gap | §2.5 / §2.15 | OPEN — authored socket/anchor/layer-order contracts and mounted wolf + crossbow alignment remain unproven. Do not tie this to `render_plan_table.py` or `render_plans.json` as the active artifact target. |
| pipeline-v3 `workbench_create_actor_visual_profile()` not wired to Y9-2 production workflow | §2.5 / §2.10 | OPEN — route exists, but emitted profile JSON is draft/scaffolding and no shared cross-repo authoring seam feeds latest Y9-2 production compilation. Tracked by `FL-BA-05` / `FL-BA-06`. |

### Non-Blocking Gaps (required for full parity, not migration gate)

| Gap | Section | Status |
|-----|---------|--------|
| Wearable/item authoring surface | §2.3.6 / §2.3.7 | EXPLICITLY DEFERRED post skin-authoring signoff |
| Proof-only color-variant family authoring surface | §2.5 misalignment ledger | PROOF-ONLY by policy (`service.py`, `workbench.js`) |
| M2 E2E proof run (PNG→WS→export, committed headed run) | §Milestone 2 | PARTIAL |
| UQ-013 small-screen layout and persistence | §Unified Queue `UQ-013` | ACTIVE BY OPERATOR REPRIORITIZATION — small-screen/touch layout and three-tier persistence; native OS keyboard appearance still needs real-device acceptance |
| UQ-014 printable Y9-2 authoring grid paper side feature | §2.6.1 / §Unified Queue `UQ-014` / `FL-PRINT-01` | PARKED - idea captured; prior `sprite-sheet-full.html` layout is non-authoritative and must be regenerated from template/source geometry before implementation |
| UQ-015 text-art craft and animation authoring contract | §Unified Queue `UQ-015` | PARKED / WAYFINDER - user-provided text-art tutorial intake identifies a real authoring gap, but data ownership, font/glyph semantics, reference retention, first asset scope, and temporal runtime proof remain unspecified. It does not block the current UQ-006 or UQ-013 lanes. |
| Whole-sheet browse-model split implementation | §1.8 / §2 boundary | DECISION FIXED - browse opens XP/root-editor documents first, layer 0 is editable in principle, and template metadata compatibility is a later wrapper concern; implementation remains intentionally sequenced after grid contrast, expanded grid presets, grid-scoped replace semantics, and their proof updates |
| Historical FL-3861 `render_plans.json` compiler output | §2.15 | SUPERSEDED — non-blocking lineage only; latest Y9-2 origin uses ActorVisualProfile generated-table artifacts rather than the May 12 `render_plans.json` target |
| Runtime-artifact preview surface (historical Step 11 of content authoring flow) — FL-3919 lineage | §2.10 | OPEN — no surface exists to inspect the exact compiled layer stack/runtime artifact before activation. The active target must follow latest Y9-2 ActorVisualProfile generated-table truth, not a hardcoded RenderPlanTable surface. |
| Structured authoring artifact completeness (Step 7 of content authoring flow) | §2.5 | OPEN — export-bundle missing semantic map refs, variation field, slot/layer assignments, mount rear/front separation |
| Bundle Mods E2E smoke automation (FL-3602) | §2.10 | PARTIAL — menu items exist in launcher, no tmux-driven automation of full Status→Package→Rollback sequence |
| Promote-to-current runtime-artifact identity check (Step 16) | §2.10 | OPEN — current target must compare the emitted runtime artifact/provenance used by latest Y9-2, not specifically `render_plans.json` hash parity |

### Gate Maintenance Rule

A gate moves to IMPLEMENTED when the corresponding code is committed and the
spec section above reflects current state accurately. A gate moves to PASS only
when a verified test run or headed proof is committed with a dated evidence ref.
Do not remove rows when gates PASS - update Status in-place with the evidence ref.

**Ship gate:** Do not surface the `[3] ASSET PIPELINE` launcher node until the blocking queue rows required for a supported front door are PASS. At minimum that means honest Section 1 proof (`UQ-003`), stable Section 2 backend/wrapper truth (`UQ-004` through `UQ-009`), Y9-2 gateway wiring (`UQ-010`), and the Y9-2 Step 7.12 VERIFY gate. FL-813 is now blocked by end-to-end support truth, not by a missing Section 2.10 backend API implementation.

## 2026-10-12 REXPaint Web Implementation Checkpoint

**Stage: Verified locally, not accepted or deployed.** The product shell and
PWA are now named **REXPaint Web**. Browse remains the front door and the same
root whole-sheet owner supplies Edit. Registry action coverage is presented in
one grouped selector rather than six permanent buttons; it still includes the
authorable mounted and on-foot actions and labels deferred/proof-only families.

The editor now exposes two distinct stroke-aware tools rather than conflating
them:

- **Slope brush** quantizes each pointer segment to ASCII `-`, `|`, `/`, or
  `\\` from its slope and changes glyph when direction changes.
- **Auto-wall** retains the planned REXPaint Cell alternate behavior using
  CP437 connectivity masks for walls, corners, tees, and junctions.

Cell, Slope brush, Select, and Text remain visible; Auto-wall and the secondary
drawing/selection operations are under one `More tools` disclosure. Refrog's
vendored Xanh Mono and monochrome square-border presentation remain pinned.

Mobile has a 390 px verified no-horizontal-overflow layout. `Keyboard` switches
to Text, focuses the `inputmode=text` bridge, and calls the Virtual Keyboard API
when the browser provides it. Desktop Chrome device emulation verifies focus
and mode changes but cannot prove that Android/iOS displayed its native OS
keyboard; that last observation remains a real-device acceptance check.

Focused evidence on 2026-10-12: 11 adaptive/slope brush contracts, 18 shell and
whole-sheet contracts, 38 template-gating contracts, 7 action-navigation
contracts, and the 38-test npm suite passed. Headed Chrome proved the desktop
Slope brush control active and the mobile keyboard bridge focused. A stale
service-worker module was caught during proof; the cache namespace and brush
module URL are now versioned. Repository-wide self-containment remains an
independent failing gate, so this checkpoint does not claim overall ship
readiness.

## 2026-10-12 Parallel Product-Correction Priority

The operator has explicitly reprioritized four co-equal top-level lanes. They
may execute in parallel only with non-overlapping file/state ownership:

1. normalized XP/Y9 contract correctness inside Workbench and `Test This Skin`;
2. Browse-first desktop/mobile authoring, including first-class PNG/XP import;
3. slope/adaptive brush provenance, behavioral reconciliation, and acceptance;
4. closure of the active regressions and gates in the consolidated register at
   `docs/PLAYWRIGHT_FAILURE_LOG.md`.

This explicit operator reprioritization activates product work that older queue
text labels `PARKED`, especially `UQ-013`. It does not waive runtime/compiler
dependencies such as `UQ-R15` -> `UQ-008`, and it does not authorize competing
owners. Lane 4 is the tracking, proof, documentation, and independent-regression
lane supporting lanes 1-3; it does not duplicate their file ownership.
`UQ-010` remains gated by the shared-contract/runtime prerequisites in its row.
`UQ-011` remains parked until the operator explicitly starts public cutover;
this priority decision alone is not that cutover authorization.

The required integrated acceptance path is:

`Browse -> select/preview whole sheet -> New/Open/PNG-or-XP import -> convert or
slice when needed -> Edit on desktop/mobile -> adaptive/slope stroke -> Save ->
Export -> Test This Skin through the normalized CP437 runtime contract`.

Browse must not present a layer browser. Layers remain an Edit concern. Test
This Skin must consume the current Workbench document/bundle and must not fall
back to an ambient/default Y9-2 bundle. The normalized viewer is evidence and
inspection infrastructure; runtime authority continues to come from the
reviewed V3 registry and Y9-2 identity/runtime contract rather than a second
viewer-owned model.

## 2026-10-13 Lane-D Evidence Checkpoint (Tracking/Proof Lane)

**Stage: Executed locally, not accepted or deployed.** Lane D owns only
`tests/*`, `scripts/*` verifier/harness, and the two canon docs; it makes no
production claims for lanes A/B/C. Status vocabulary below is one of
Implemented / Connected / Executed / Verified / Accepted / Deployed — no row
is collapsed to done, and UI acceptance is recorded separately from
backend/grep/evaluate/diagnostic-only proof.

1. **Register:** the consolidated register at
   `docs/PLAYWRIGHT_FAILURE_LOG.md` stays the execution-handoff authority;
   queue truth is `UQ-006` open/blocked, `UQ-008` proof-blocked, `UQ-009`
   partial/support, `UQ-010` gated, `UQ-011` parked, `UQ-013` active,
   `UQ-R15`/`FL-3861` through `FL-3864` open. Non-blocking gaps (wearable,
   color variants, `bigbee`, M2 headed PNG-export, RenderPlan preview, export
   artifact, Bundle Mods E2E, hash parity) stay tracked, not closed. `DR-*`
   and `XR-*` identifiers are preserved; there is no misc-cleanup bucket.
2. **Self-containment:** the 9 live-script absolute paths across five scripts
   are fixed with `--final-json`/`--png-root`/`--knight-dir`/`--state-final`/`--final`
   flags plus `$ASCIICKER_FINAL_JSON`/`$ASCIICKER_PNG_ROOT`/`$ASCIICKER_KNIGHT_DIR`/`$ASCIICKER_STATE_FINAL`
   fallbacks and fail-closed actionable errors; missing operator-local corpus
   exits non-zero instead of silently degrading. Audit blocking count moves
   47 → 38. The remaining 38 are stored CE-review JSON under `.context/`
   (historical evidence, disposition recorded in the failure log, not edited
   and not presented as fixed).
3. **URL proof (local only, no public deploy):** root-hosted `/healthz` 200,
   `/workbench` 200 with `__WB_BASE_PATH = ""`; prefixed `/xpedit/healthz`
   200, `/xpedit/workbench` 200 with `__WB_BASE_PATH = "/xpedit"` and
   `/xpedit`-prefixed asset URLs. `rikiworld.com/xpedit` remains out of scope
   and untouched.
4. **Focused suites (all executed, none accepted as product proof):** npm
   green end to end — template-gating 38/38, action-navigation 7/7, node
   --test batch 22/22, adaptive-stroke 16/16 — plus XP-preview-playback 3/3
   and pytest 71/71 (`test_base_path`, provenance-manifest, ledger). No
   service-worker freshness automation exists yet — recorded as an open gap,
   not claimed.
