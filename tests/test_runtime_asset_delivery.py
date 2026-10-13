from __future__ import annotations

import gzip
import re


def _runtime_version(client, prefix: str = "") -> str:
    response = client.get(f"{prefix}/termpp-web-flat/index.html")
    assert response.status_code == 200
    assert response.headers["Cache-Control"].startswith("no-store")
    html = response.data.decode("utf-8")
    match = re.search(r"index\.js\?v=([0-9a-f]{16})", html)
    assert match
    assert f"legacy_skin_preview_bootstrap.js?v={match.group(1)}" in html
    assert f"flat_map_bootstrap.js?v={match.group(1)}" in html
    assert "Module.locateFile" in html
    return match.group(1)


def test_runtime_assets_are_content_versioned_and_immutable(client):
    version = _runtime_version(client)

    versioned = client.get(f"/termpp-web-flat/index.js?v={version}")
    assert versioned.status_code == 200
    assert versioned.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    unversioned = client.get("/termpp-web-flat/index.js")
    assert unversioned.status_code == 200
    assert unversioned.headers["Cache-Control"] == "public, max-age=0, must-revalidate"


def test_runtime_data_is_gzipped_for_supported_clients(client):
    version = _runtime_version(client)
    response = client.get(
        f"/termpp-web-flat/index.data?v={version}",
        headers={"Accept-Encoding": "gzip"},
    )
    assert response.status_code == 200
    assert response.headers["Content-Encoding"] == "gzip"
    assert response.headers["Vary"] == "Accept-Encoding"
    assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    decoded = gzip.decompress(response.data)
    assert len(decoded) == 25_406_532
    assert len(response.data) < len(decoded) // 3


def test_runtime_asset_delivery_works_under_configured_prefix(hosted_client):
    client, prefix = hosted_client
    version = _runtime_version(client, prefix)
    response = client.get(f"{prefix}/termpp-web-flat/index.wasm?v={version}")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
