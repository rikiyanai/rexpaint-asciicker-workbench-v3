import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "multiplayer_canon_guard.py"
SPEC = importlib.util.spec_from_file_location("multiplayer_canon_guard", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


def test_pipeline_layout_skips_unowned_multiplayer_canon(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "PLAYWRIGHT_FAILURE_LOG.md").write_text("# failures\n")

    ok, violations, notes, applicable = GUARD.check(tmp_path)

    assert ok is True
    assert applicable is False
    assert violations == []
    assert "multiplayer canon not applicable to pipeline root" in notes


def test_unknown_layout_fails_closed(tmp_path):
    ok, violations, notes, applicable = GUARD.check(tmp_path)

    assert ok is False
    assert applicable is True
    assert notes == []
    assert "canonical multiplayer guard unavailable" in violations[0]
