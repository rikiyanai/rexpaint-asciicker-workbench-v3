"""FL-4306 regression: _load_anchor_state must reject non-anchor schema JSON
with a ValueError (which main() turns into a readable message + exit 2),
instead of being opened and crashing deeper in the render path.
"""
import json
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import xp_uv_body_viewer as viewer  # noqa: E402


def test_rejects_role_schema_without_grid_layout(tmp_path):
    roles = tmp_path / "player-roles.json"
    roles.write_text(
        json.dumps({"frame_w": 0, "frame_h": 0, "frames": {"0": {"regions": []}}}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        viewer._load_anchor_state(roles)


def test_rejects_conventions_doc(tmp_path):
    doc = tmp_path / "upstream_sprite_layer_conventions.json"
    doc.write_text(json.dumps({"schema": "x", "authority": False}), encoding="utf-8")
    with pytest.raises(ValueError):
        viewer._load_anchor_state(doc)
