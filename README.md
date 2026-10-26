# Asciicker XPEdit

A browser based editor for REXPaint `.xp` artwork and Asciicker sprites.
Convert PNG sprite sheets, edit character cells and layers, preview animations,
and test character skins in the game. This project is under active development;
please report bugs through GitHub Issues.

## Demo

Upload PNG sprite sheet → Convert/slice → XP Preview animation → Test This Skin running in the game world:

![Knight skin full workflow: upload, slice, preview, world run](docs/demo-skin-run.gif)


## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
PYTHONPATH=src python3 -m pipeline_v2.app
```

Open:

- Live: `https://rikiworld.com/xpedit`
- Local (default): `http://127.0.0.1:5071/` (redirects to `/workbench`)
- Local (direct): `http://127.0.0.1:5071/workbench`

## Browse and edit sprites

In **Browse**, choose **Asciicker-Y9-2 sprites** and search by XP filename.
The library includes all 287 tracked XPs from upstream commit `52d008f`.
**Open editable copy** preserves the upstream file and opens a raw XP document
in **Edit**. **My documents** lists your saved copies and new documents.

On phones, choose **Browse sprites & documents** on the opening screen. Use
**Tools** for glyphs/colors/brushes and **Layers** for layer controls. Desktop
users can switch to those controls with **Mobile view** in the document toolbar.

**Skin / action** and **Convert JSON** start collapsed. Raw documents select
**Raw XP / no template**. Selecting a template warns about layer 0 metadata;
**Apply selected template** creates a new template document, rather than
silently rewriting the original raw XP or transferring its artwork.

## Saving your work

Export your `.xp` documents before leaving the editor. Server uploads and
editor sessions are temporary and can be lost when the service restarts.

## Required Inputs

- `image_file` (`.png`)
- `name` (string)
- `angles` (int >= 1)
- `frames` (CSV like `8,8,8,8`)
- `source_projs` (`1|2`, default `1`)
- `render_resolution` (int, default `24`)
- `bg_mode` (`key_color|alpha|none`, default `key_color`)
- `bg_tolerance` (int, default `8`)

## Outputs

Export edited artwork as `.xp` files and generate PNG previews.

## API

- `POST /api/upload`
- `POST /api/analyze`
- `POST /api/run`
- `GET /api/status/<job_id>`
- `POST /api/workbench/load-from-job`
- `POST /api/workbench/export-xp`

All failures return:

```json
{
  "error": "human readable",
  "code": "machine_code",
  "stage": "upload|analyze|run|workbench",
  "request_id": "uuid"
}
```

## Tests

```bash
PYTHONPATH=src python3 -m pytest
```

## Notes

- The XP codec implemented here writes/reads classic REXPaint-style layers.
- This MVP uses deterministic grayscale glyph mapping; it is not final art-quality conversion.

## Documentation

See [the documentation index](docs/INDEX.md) for editor controls and file formats.
