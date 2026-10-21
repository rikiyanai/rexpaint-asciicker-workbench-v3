"""Catalog/API regression tests with isolated storage (no repository-data cleanup).

Run locally with unittest, not pytest's legacy destructive data fixture:
PYTHONPATH=src python3 -m unittest discover -s tests -p test_upstream_sprite_catalog.py
"""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pipeline_v2 import app as app_module, config, service
from pipeline_v2.xp_codec import read_xp


class UpstreamCatalogTests(unittest.TestCase):
    def setUp(self):
        self.storage = tempfile.TemporaryDirectory(prefix="xpedit-catalog-test-")
        self.addCleanup(self.storage.cleanup)
        self.patches = []
        for name in ("DATA_DIR", "UPLOAD_DIR", "JOBS_DIR", "SESSIONS_DIR", "EXPORT_DIR",
                     "PREVIEWS_DIR", "GATES_DIR", "TRACES_DIR", "BUNDLES_DIR", "BUG_REPORTS_DIR"):
            path = Path(self.storage.name) / name.lower()
            for module in (config, service, app_module):
                if hasattr(module, name):
                    p = patch.object(module, name, path)
                    p.start()
                    self.addCleanup(p.stop)
        self.app = app_module.create_app()
        self.client = self.app.test_client()
        self.prefix = config.BASE_PATH

    def test_catalog_is_complete_and_all_vendored_hashes_match(self):
        catalog = json.loads((config.CONFIG_DIR / "upstream_sprite_catalog.json").read_text())
        directory = config.SPRITES_DIR / "upstream-y9-2"
        self.assertEqual(len(catalog["commit"]), 40)
        self.assertEqual(len(catalog["assets"]), 287)
        self.assertEqual({p.relative_to(directory).as_posix() for p in directory.rglob("*.xp")},
                         {a["asset_id"] for a in catalog["assets"]})
        for asset in catalog["assets"]:
            self.assertEqual(hashlib.sha256((directory / asset["asset_id"]).read_bytes()).hexdigest(), asset["sha256"])
        listed = self.client.get(self.prefix + "/api/workbench/browse/list")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json["upstream_count"], 287)
        self.assertEqual(listed.json["saved_count"], 0)

    def test_preview_is_read_only_and_open_creates_lossless_copy(self):
        asset = "item-armor.xp"
        original = (config.SPRITES_DIR / "upstream-y9-2" / asset).read_bytes()
        preview = self.client.get(self.prefix + "/api/workbench/sprites/preview", query_string={"asset_id": asset})
        self.assertEqual(preview.status_code, 200)
        self.assertFalse(list(service.SESSIONS_DIR.glob("*.json")))
        opened = self.client.post(self.prefix + "/api/workbench/sprites/open", json={"asset_id": asset})
        self.assertEqual(opened.status_code, 201)
        self.assertEqual(opened.json["session_kind"], "raw_xp")
        self.assertEqual(opened.json["template_set_key"], "")
        self.assertEqual(opened.json["name"], asset)
        exported = self.client.post(self.prefix + "/api/workbench/export-xp", json={"session_id": opened.json["session_id"]})
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(read_xp(Path(exported.json["xp_path"])), read_xp(original))
        self.assertEqual((config.SPRITES_DIR / "upstream-y9-2" / asset).read_bytes(), original)

    def test_catalog_rejects_traversal_and_unknown_ids(self):
        for asset in ("../../README.md", "/etc/passwd", "not-present.xp"):
            self.assertEqual(self.client.get(self.prefix + "/api/workbench/sprites/preview", query_string={"asset_id": asset}).status_code, 404)
            self.assertEqual(self.client.post(self.prefix + "/api/workbench/sprites/open", json={"asset_id": asset}).status_code, 404)

    def test_new_document_selects_visible_art_layer_without_removing_metadata(self):
        opened = self.client.post(self.prefix + "/api/workbench/create-blank-session", json={})
        self.assertEqual(opened.status_code, 201)
        self.assertEqual(opened.json["active_layer"], 2)
        self.assertEqual(opened.json["visible_layers"], [2])
        self.assertEqual(opened.json["layer_count"], 4)
        self.assertEqual(opened.json["layers"][0][0]["glyph"], ord("8"))
