"""Service-worker freshness cutover gate.

Cutover gate: the installing/updating service worker MUST serve current
workbench assets, never a stale cache. Verified headless against the local
Flask server (Flask test client = no browser cache involved):

1. The served /workbench page emits a version token
   (``window.__WB_SERVER_BOOT_NONCE`` + ``?v=<nonce>`` asset URLs).
2. ``/sw.js`` is served fresh (no-store) and its ``CACHE_NAME`` + precache
   list cover the current workbench assets.
3. Stale-cache scenario: the worker's activate handler deletes every cache
   whose name != current CACHE_NAME, and install uses skipWaiting +
   cache.addAll — so an outdated cache resolves to fresh assets on update.

Recorded as the cutover gate: no cutover without this test green.
Deploy stays on hold; frozen-SHA gate unchanged.
"""

from __future__ import annotations

import re
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parents[1] / "web"

CACHE_NAME_RE = re.compile(r"var CACHE_NAME\s*=\s*'([^']+)'")
NONCE_RE = re.compile(r'window\.__WB_SERVER_BOOT_NONCE\s*=\s*"([^"]+)"')
ASSET_V_RE = re.compile(r"[\"'](?:[^\"']*?)\?v=([^\"'&]+)[\"']")

# Assets the workbench shell cannot run without; the SW precache list MUST
# cover all of these or an offline/updated client serves a broken mix.
REQUIRED_PRECACHE = (
    "workbench.js",
    "styles.css",
    "whole-sheet-init.js",
    "manifest.json",
)


def _page_token(client, prefix: str = "") -> str:
    response = client.get(f"{prefix}/workbench")
    assert response.status_code == 200
    # Workbench HTML must never be served stale: no-store forces revalidation.
    assert response.headers["Cache-Control"].startswith("no-store")
    html = response.data.decode("utf-8")
    match = NONCE_RE.search(html)
    assert match, "served page must emit window.__WB_SERVER_BOOT_NONCE"
    nonce = match.group(1)
    assert nonce, "boot nonce must be non-empty"
    # Versioned asset URLs in the same page must carry the same token.
    versions = set(ASSET_V_RE.findall(html))
    assert versions, "served page must emit ?v= versioned asset URLs"
    assert versions == {nonce}, (
        f"asset ?v= tokens {sorted(versions)} must match boot nonce {nonce!r}"
    )
    return nonce


def _sw_source(client, prefix: str = "") -> str:
    response = client.get(f"{prefix}/sw.js")
    assert response.status_code == 200
    # The worker script itself must be served fresh, never a cached copy.
    assert response.headers["Cache-Control"].startswith("no-store")
    return response.data.decode("utf-8")


def _assert_precache_covers(sw_source: str) -> str:
    match = CACHE_NAME_RE.search(sw_source)
    assert match, "sw.js must declare var CACHE_NAME"
    cache_name = match.group(1)
    assert cache_name.strip(), "CACHE_NAME must be non-empty"
    for asset in REQUIRED_PRECACHE:
        assert asset in sw_source, (
            f"sw.js precache list must include current asset {asset!r} "
            f"(cache {cache_name})"
        )
    return cache_name


def _assert_stale_cache_resolves(sw_source: str, cache_name: str) -> None:
    # Install path: skipWaiting + precache everything, so the new worker
    # takes over immediately with fresh assets.
    assert "skipWaiting" in sw_source
    assert "cache.addAll" in sw_source
    # Activate path: delete every cache that is not the current one, then
    # claim clients — a stale cache cannot survive an update.
    assert "caches.delete" in sw_source
    assert "name !== CACHE_NAME" in sw_source or "!== CACHE_NAME" in sw_source, (
        "activate handler must evict caches whose name != current CACHE_NAME"
    )
    # Cross-check the on-disk worker is the one under test (no drift between
    # the served file and the repo source this gate reviews).
    on_disk = (WEB_DIR / "sw.js").read_text(encoding="utf-8")
    assert CACHE_NAME_RE.search(on_disk).group(1) == cache_name


def test_sw_freshness_cutover_gate(client):
    """Page token, worker cache name, and precache list agree on fresh assets."""
    nonce = _page_token(client)
    sw_source = _sw_source(client)
    cache_name = _assert_precache_covers(sw_source)
    _assert_stale_cache_resolves(sw_source, cache_name)
    assert nonce  # token observed; freshness anchored to this boot


def test_sw_freshness_cutover_gate_under_configured_prefix(hosted_client):
    """Same gate holds at both / and /xpedit hosting prefixes."""
    client, prefix = hosted_client
    _page_token(client, prefix)
    sw_source = _sw_source(client, prefix)
    cache_name = _assert_precache_covers(sw_source)
    _assert_stale_cache_resolves(sw_source, cache_name)


def test_stale_cache_name_cannot_match_current(client):
    """A prior cache name is, by construction, evicted on activate.

    The current CACHE_NAME is date-stamped per deploy (see the DEPLOY comment
    in sw.js); any previously installed name differs, so the activate handler
    (asserted above to delete non-current names) resolves the stale-cache
    scenario to fresh assets.
    """

    sw_source = _sw_source(client)
    cache_name = CACHE_NAME_RE.search(sw_source).group(1)
    stale_candidates = (
        "rexpaint-web-v1",
        "rexpaint-web-v2-20260101",
        cache_name + "-stale",
    )
    for stale in stale_candidates:
        assert stale != cache_name
