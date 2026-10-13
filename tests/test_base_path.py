"""Tests for base-path support: config helper, Blueprint routing, HTML injection."""
from __future__ import annotations

import importlib
import os

import pytest

from pipeline_v2.config import normalize_base_path


class TestNormalizeBasePath:
    def test_empty(self):
        assert normalize_base_path("") == ""

    def test_whitespace_only(self):
        assert normalize_base_path("   ") == ""

    def test_slash_only(self):
        assert normalize_base_path("/") == ""

    def test_bare_name(self):
        assert normalize_base_path("xpedit") == "/xpedit"

    def test_leading_slash(self):
        assert normalize_base_path("/xpedit") == "/xpedit"

    def test_trailing_slash(self):
        assert normalize_base_path("/xpedit/") == "/xpedit"

    def test_both_slashes(self):
        assert normalize_base_path("/asciicker-XPEdit/") == "/asciicker-XPEdit"

    def test_whitespace_and_slashes(self):
        assert normalize_base_path("  /xpedit/  ") == "/xpedit"

    def test_multi_segment(self):
        assert normalize_base_path("/a/b/c") == "/a/b/c"


class TestRoutesRootHosted:
    """Routes under default BASE_PATH="" (root-hosted, current behavior)."""

    @pytest.fixture(autouse=True)
    def _setup(self, client):
        self.client = client

    def test_healthz(self, client):
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.data == b"ok"

    def test_root_redirects_to_workbench(self, client):
        r = client.get("/")
        assert r.status_code == 302
        assert r.headers["Location"].endswith("/workbench")

    def test_api_templates_reachable(self, client):
        r = client.get("/api/workbench/templates")
        assert r.status_code == 200


class TestRoutesPrefixed:
    """Routes under BASE_PATH="/xpedit" (subpath-hosted)."""

    @pytest.fixture(autouse=True)
    def _app_with_prefix(self, monkeypatch, clean_data_dir):
        monkeypatch.setenv("PIPELINE_BASE_PATH", "/xpedit")
        import pipeline_v2.config as cfg_mod
        import pipeline_v2.app as app_mod
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)
        app = app_mod.create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()
        yield
        # Restore original config
        monkeypatch.delenv("PIPELINE_BASE_PATH", raising=False)
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)

    def test_prefixed_healthz(self):
        r = self.client.get("/xpedit/healthz")
        assert r.status_code == 200
        assert r.data == b"ok"

    def test_bare_healthz_404(self):
        r = self.client.get("/healthz")
        assert r.status_code == 404

    def test_prefixed_root_redirects(self):
        r = self.client.get("/xpedit/")
        assert r.status_code == 302
        assert r.headers["Location"].endswith("/xpedit/workbench")

    def test_bare_root_404(self):
        r = self.client.get("/")
        assert r.status_code == 404

    def test_prefixed_templates_reachable(self):
        r = self.client.get("/xpedit/api/workbench/templates")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Phase 2: HTML asset injection and __WB_BASE_PATH
# ---------------------------------------------------------------------------


class TestHtmlInjectionRootHosted:
    """HTML output under default BASE_PATH="" preserves root-relative paths."""

    @pytest.fixture(autouse=True)
    def _setup(self, client):
        self.client = client

    def test_workbench_contains_base_path_var(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert 'window.__WB_BASE_PATH = ""' in html

    def test_workbench_contains_boot_nonce(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert "window.__WB_SERVER_BOOT_NONCE" in html

    def test_workbench_styles_root_relative(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert 'href="/styles.css?' in html

    def test_workbench_rexpaint_css_root_relative(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert 'href="/rexpaint-editor/styles.css?' in html

    def test_workbench_js_root_relative(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert 'src="/workbench.js?' in html

    def test_termpp_skin_lab_contains_base_path_var(self, client):
        r = client.get("/termpp-skin-lab")
        html = r.data.decode()
        assert 'window.__WB_BASE_PATH = ""' in html

    def test_workbench_whole_sheet_init_root_relative(self, client):
        r = client.get("/workbench")
        html = r.data.decode()
        assert 'src="/whole-sheet-init.js?' in html

    def test_wizard_styles_root_relative(self, client):
        r = client.get("/wizard")
        html = r.data.decode()
        assert 'href="/styles.css?' in html

    def test_wizard_js_root_relative(self, client):
        r = client.get("/wizard")
        html = r.data.decode()
        assert 'src="/wizard.js?' in html

    def test_wizard_workbench_link_root_relative(self, client):
        r = client.get("/wizard")
        html = r.data.decode()
        assert 'href="/workbench"' in html


class TestHtmlInjectionPrefixed:
    """HTML output under BASE_PATH="/xpedit" has prefixed asset URLs."""

    @pytest.fixture(autouse=True)
    def _app_with_prefix(self, monkeypatch, clean_data_dir):
        monkeypatch.setenv("PIPELINE_BASE_PATH", "/xpedit")
        import pipeline_v2.config as cfg_mod
        import pipeline_v2.app as app_mod
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)
        app = app_mod.create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()
        yield
        monkeypatch.delenv("PIPELINE_BASE_PATH", raising=False)
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)

    def test_workbench_base_path_var(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'window.__WB_BASE_PATH = "/xpedit"' in html

    def test_workbench_styles_prefixed(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'href="/xpedit/styles.css?' in html

    def test_workbench_rexpaint_css_prefixed(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'href="/xpedit/rexpaint-editor/styles.css?' in html

    def test_workbench_js_prefixed(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'src="/xpedit/workbench.js?' in html

    def test_termpp_skin_lab_base_path_var(self):
        r = self.client.get("/xpedit/termpp-skin-lab")
        html = r.data.decode()
        assert 'window.__WB_BASE_PATH = "/xpedit"' in html

    def test_workbench_template_gating_js_prefixed(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'src="/xpedit/workbench-template-gating.js?' in html

    def test_workbench_whole_sheet_init_prefixed(self):
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        assert 'src="/xpedit/whole-sheet-init.js?' in html

    def test_wizard_styles_prefixed(self):
        r = self.client.get("/xpedit/wizard")
        html = r.data.decode()
        assert 'href="/xpedit/styles.css?' in html

    def test_wizard_js_prefixed(self):
        r = self.client.get("/xpedit/wizard")
        html = r.data.decode()
        assert 'src="/xpedit/wizard.js?' in html

    def test_wizard_workbench_link_prefixed(self):
        r = self.client.get("/xpedit/wizard")
        html = r.data.decode()
        assert 'href="/xpedit/workbench"' in html


# ---------------------------------------------------------------------------
# Phase 3: Prefix-aware workflow smoke tests
# ---------------------------------------------------------------------------


class TestPrefixedWorkflowSmoke:
    """End-to-end smoke: key workflows work under /xpedit prefix."""

    @pytest.fixture(autouse=True)
    def _app_with_prefix(self, monkeypatch, clean_data_dir):
        monkeypatch.setenv("PIPELINE_BASE_PATH", "/xpedit")
        import pipeline_v2.config as cfg_mod
        import pipeline_v2.app as app_mod
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)
        app = app_mod.create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()
        yield
        monkeypatch.delenv("PIPELINE_BASE_PATH", raising=False)
        importlib.reload(cfg_mod)
        importlib.reload(app_mod)

    # ── Page loading ──

    def test_workbench_loads_200(self):
        r = self.client.get("/xpedit/workbench")
        assert r.status_code == 200

    def test_wizard_loads_200(self):
        r = self.client.get("/xpedit/wizard")
        assert r.status_code == 200

    def test_workbench_no_bare_root_asset_refs(self):
        """No href="/styles or src="/workbench without prefix in served HTML."""
        r = self.client.get("/xpedit/workbench")
        html = r.data.decode()
        # All root-relative asset refs should start with /xpedit/
        for tag in ['href="/styles.css', 'src="/workbench.js', 'src="/whole-sheet-init.js',
                     'href="/rexpaint-editor/styles.css']:
            assert tag not in html, f"Bare root-relative ref found: {tag}"

    def test_wizard_no_bare_root_asset_refs(self):
        r = self.client.get("/xpedit/wizard")
        html = r.data.decode()
        for tag in ['href="/styles.css', 'src="/wizard.js']:
            assert tag not in html, f"Bare root-relative ref found: {tag}"

    # ── Wizard → Workbench navigation ──

    def test_wizard_links_to_prefixed_workbench(self):
        r = self.client.get("/xpedit/wizard")
        html = r.data.decode()
        assert 'href="/xpedit/workbench"' in html

    # ── Template apply (bundle create) ──

    def test_template_registry_under_prefix(self):
        r = self.client.get("/xpedit/api/workbench/templates")
        assert r.status_code == 200
        j = r.get_json()
        assert "template_sets" in j

    def test_bundle_create_under_prefix(self):
        r = self.client.post(
            "/xpedit/api/workbench/bundle/create",
            json={"template_set_key": "player_native_full"},
            content_type="application/json",
        )
        assert r.status_code == 201
        j = r.get_json()
        assert "bundle_id" in j
        assert j["bundle_id"]

    # ── Save / export round-trip ──

    def test_create_blank_session_under_prefix(self):
        r = self.client.post(
            "/xpedit/api/workbench/create-blank-session",
            json={"template_set_key": "player_native_idle_only", "action_key": "idle"},
            content_type="application/json",
        )
        assert r.status_code == 201
        j = r.get_json()
        assert "session_id" in j

    def test_create_root_blank_session_under_prefix(self):
        r = self.client.post(
            "/xpedit/api/workbench/create-blank-session",
            json={},
            content_type="application/json",
        )
        assert r.status_code == 201
        j = r.get_json()
        assert j["grid_cols"] == 126
        assert j["grid_rows"] == 80
        assert j["angles"] == 8
        assert j["anims"] == [9]

    def test_save_and_export_under_prefix(self):
        # Create session
        r = self.client.post(
            "/xpedit/api/workbench/create-blank-session",
            json={"template_set_key": "player_native_idle_only", "action_key": "idle"},
            content_type="application/json",
        )
        sid = r.get_json()["session_id"]

        # Save
        r = self.client.post(
            "/xpedit/api/workbench/save-session",
            json={"session_id": sid},
            content_type="application/json",
        )
        assert r.status_code == 200

        # Export
        r = self.client.post(
            "/xpedit/api/workbench/export-xp",
            json={"session_id": sid},
            content_type="application/json",
        )
        assert r.status_code == 200
        j = r.get_json()
        assert "xp_path" in j

    # ── Runtime preflight under prefix ──

    def test_runtime_preflight_under_prefix(self):
        r = self.client.get("/xpedit/api/workbench/runtime-preflight")
        assert r.status_code == 200
        j = r.get_json()
        assert "ok" in j

    # ── Static assets served under prefix ──

    def test_styles_css_served_under_prefix(self):
        r = self.client.get("/xpedit/styles.css")
        assert r.status_code == 200

    def test_workbench_js_served_under_prefix(self):
        r = self.client.get("/xpedit/workbench.js")
        assert r.status_code == 200

    def test_wizard_js_served_under_prefix(self):
        r = self.client.get("/xpedit/wizard.js")
        assert r.status_code == 200

    # ── Bare-root routes are 404 ──

    def test_bare_workbench_404(self):
        assert self.client.get("/workbench").status_code == 404

    def test_bare_api_templates_404(self):
        assert self.client.get("/api/workbench/templates").status_code == 404

    def test_bare_styles_404(self):
        assert self.client.get("/styles.css").status_code == 404
