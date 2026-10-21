#!/usr/bin/env python3
"""Vendor tracked XP blobs from a pinned Y9-2 commit, never its dirty worktree.

Outputs: sprites/upstream-y9-2/ and config/upstream_sprite_catalog.json.
No private upstream credentials or checkout are needed in the deployed image.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sync(repository: Path, ref: str) -> dict:
    def git(*args: str) -> bytes:
        return subprocess.check_output(["git", "-C", str(repository), *args])

    commit = git("rev-parse", "--verify", ref + "^{commit}").decode().strip()
    entries = []
    destination = ROOT / "sprites" / "upstream-y9-2"
    for row in git("ls-tree", "-rz", commit, "assets/sprites/").split(b"\0"):
        if not row:
            continue
        meta, raw_path = row.split(b"\t", 1)
        mode, kind, oid = meta.decode().split()
        source_path = raw_path.decode()
        if not source_path.lower().endswith(".xp"):
            continue
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"XP source must be an ordinary tracked blob: {source_path}")
        relative = PurePosixPath(source_path).relative_to("assets/sprites")
        data = git("cat-file", "blob", oid)
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            version, layers, width, height = struct.unpack("<iiii", stream.read(16))
        if min(layers, width, height) <= 0:
            raise ValueError(f"Invalid XP header: {source_path}")
        target = destination.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        entries.append({
            "asset_id": str(relative), "source_path": source_path,
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "grid_cols": width, "grid_rows": height, "layer_count": layers,
        })
    if not entries:
        raise ValueError("Pinned source contains no XP assets")
    catalog = {
        "repository": "rikiyanai/asciicker-Y9-2", "commit": commit,
        "source_directory": "assets/sprites", "assets": entries,
    }
    (ROOT / "config" / "upstream_sprite_catalog.json").write_text(
        json.dumps(catalog, indent=2) + "\n", encoding="utf-8"
    )
    return {"commit": commit, "count": len(entries), "bytes": sum(e["bytes"] for e in entries)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", type=Path)
    parser.add_argument("--ref", required=True)
    args = parser.parse_args()
    print(json.dumps(sync(args.repository, args.ref)))
