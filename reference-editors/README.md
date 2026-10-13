# Local ASCII editor references

This directory contains runnable behavioral-research copies of three editor surfaces used by the canonical Section 1 workbench roadmap.

Run them with either:

```sh
python3 reference-editors/serve.py --open
```

or double-click `reference-editors/run.command` on macOS. The landing page is served at `http://127.0.0.1:8765/`. Stop the server with `Ctrl-C`.

## Included editors

- `patorjk-ascii-art-sketchpad/`: semantic ASCII, half-block, box-connectivity, shape, selection, accessible-grid, and grouped-history behavior.
- `codexvault-glyphlab/`: local TTF/OTF/TTC loading, cmap inspection, Unicode search, favorites/recents, and virtualized glyph browsing.
- `codexvault-grid-studio/`: configurable Unicode grids, paint and selection tools, Braille/Worms modes, color, background tracing, animation, and export surfaces.

The copies are research and test-oracle inputs. Canonical workbench interfaces, ownership, code, and tests remain authored through the existing Section 1 architecture.

## Refresh and verify

`python3 reference-editors/sync.py` downloads the current runtime files and records their hashes in `manifest.json`.

With the server running, verify all three applications in Chromium:

```sh
node reference-editors/smoke.mjs
```
