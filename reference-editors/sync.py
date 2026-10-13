#!/usr/bin/env python3
"""Refresh the locally runnable behavioral-reference editors."""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
USER_AGENT = "asciicker-reference-editor-sync/1.0"


class RuntimeAssetParser(HTMLParser):
    """Collect browser-loaded assets from the small PatorJK entry page."""

    def __init__(self) -> None:
        super().__init__()
        self.paths: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in {"script", "img"} and values.get("src"):
            self.paths.add(values["src"] or "")
        if tag == "link" and values.get("href"):
            rel = (values.get("rel") or "").lower()
            if "stylesheet" in rel or "icon" in rel:
                self.paths.add(values["href"] or "")


def fetch(url: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), {key.lower(): value for key, value in response.headers.items()}


def write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def localize_pator_entry(payload: bytes) -> bytes:
    text = payload.decode("utf-8")
    # Analytics is unrelated to editor behavior and would make startup network-dependent.
    text, removed = re.subn(
        r"\s*<script>\s*window\.dataLayer.*?</script>\s*",
        "\n",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if removed != 1:
        raise RuntimeError("PatorJK analytics block changed; inspect before refreshing")
    # Some responses inject a Cloudflare performance beacon after the application HTML.
    # It is not part of editor behavior and must not become a local runtime dependency.
    text = re.sub(
        r"\s*<script\b[^>]*\bsrc=[\"']https?://[^>]+>\s*</script>\s*",
        "\n",
        text,
        flags=re.IGNORECASE,
    )
    return text.encode("utf-8")


def sync_pator(manifest: dict[str, object]) -> None:
    base_url = "https://patorjk.com/ascii-art-sketchpad/"
    raw_entry, headers = fetch(base_url)
    entry = localize_pator_entry(raw_entry)
    parser = RuntimeAssetParser()
    parser.feed(entry.decode("utf-8"))

    destination = ROOT / "patorjk-ascii-art-sketchpad"
    write_bytes(destination / "index.html", entry)

    files: list[dict[str, str | int]] = [
        {
            "path": "patorjk-ascii-art-sketchpad/index.html",
            "bytes": len(entry),
            "sha256": digest(entry),
        }
    ]
    base_path = urllib.parse.urlparse(base_url).path
    pending = [urllib.parse.urljoin(base_url, relative) for relative in sorted(parser.paths)]
    seen: set[str] = set()
    while pending:
        asset_url = pending.pop(0)
        if asset_url in seen:
            continue
        seen.add(asset_url)
        parsed = urllib.parse.urlparse(asset_url)
        if parsed.netloc != "patorjk.com":
            raise RuntimeError(f"Unexpected PatorJK runtime host: {asset_url}")
        if not parsed.path.startswith(base_path):
            raise RuntimeError(f"Unexpected PatorJK runtime path: {asset_url}")
        asset, _ = fetch(asset_url)
        if asset_url.endswith(".js"):
            # Keep the Home action inside this local reference collection.
            asset = asset.replace(b"https://patorjk.com/", b"../")
        if asset_url.endswith(".css"):
            for match in re.findall(rb"url\(\s*([^)]+?)\s*\)", asset):
                reference = match.decode("utf-8").strip("\"'")
                if reference.startswith(("data:", "#")):
                    continue
                pending.append(urllib.parse.urljoin(asset_url, reference))
        local_relative = urllib.parse.unquote(parsed.path[len(base_path) :])
        local_path = destination / local_relative
        write_bytes(local_path, asset)
        files.append(
            {
                "path": str(local_path.relative_to(ROOT)),
                "bytes": len(asset),
                "sha256": digest(asset),
            }
        )

    manifest["editors"].append(
        {
            "id": "patorjk-ascii-art-sketchpad",
            "source": base_url,
            "source_last_modified": headers.get("last-modified", ""),
            "entry": "patorjk-ascii-art-sketchpad/index.html",
            "files": files,
        }
    )


def sync_single_file(
    manifest: dict[str, object],
    editor_id: str,
    source: str,
    local_support_files: dict[str, bytes] | None = None,
) -> None:
    payload, headers = fetch(source)
    text = payload.decode("utf-8")
    active_remote = re.findall(
        r"<(?:script|img)[^>]+src=[\"']https?://|<link[^>]+href=[\"']https?://",
        text,
        flags=re.IGNORECASE,
    )
    if active_remote:
        raise RuntimeError(f"{editor_id} gained remote runtime assets")

    path = ROOT / editor_id / "index.html"
    write_bytes(path, payload)
    files: list[dict[str, str | int]] = [
        {
            "path": str(path.relative_to(ROOT)),
            "bytes": len(payload),
            "sha256": digest(payload),
        }
    ]
    for name, support_payload in (local_support_files or {}).items():
        support_path = path.parent / name
        write_bytes(support_path, support_payload)
        files.append(
            {
                "path": str(support_path.relative_to(ROOT)),
                "bytes": len(support_payload),
                "sha256": digest(support_payload),
            }
        )
    manifest["editors"].append(
        {
            "id": editor_id,
            "source": source,
            "source_last_modified": headers.get("last-modified", ""),
            "entry": f"{editor_id}/index.html",
            "files": files,
        }
    )


def main() -> None:
    manifest: dict[str, object] = {
        "schema": 1,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "editors": [],
    }
    sync_pator(manifest)
    sync_single_file(
        manifest,
        "codexvault-glyphlab",
        "https://fromariel.github.io/CODEXVault_GODOT/tools/glyph.html",
    )
    sync_single_file(
        manifest,
        "codexvault-grid-studio",
        "https://fromariel.github.io/CODEXVault_GODOT/tools/ascii.html",
        # The application optionally requests this file on startup. An empty object
        # preserves its built-in defaults while keeping the local run request-clean.
        local_support_files={"ascii_settings.json": b"{}\n"},
    )
    manifest_payload = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    write_bytes(ROOT / "manifest.json", manifest_payload)
    print(f"Synced {len(manifest['editors'])} reference editors into {ROOT}")


if __name__ == "__main__":
    main()
