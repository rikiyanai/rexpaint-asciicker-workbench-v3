"""FL-4162 — provenance manifest binds cards to the immutable hand corpus."""
import hashlib
import json
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import build_review_provenance_manifest as m  # noqa: E402


def _write_cards(path: Path, final_shas):
    lines = []
    for i, sha in enumerate(final_shas):
        lines.append(json.dumps({"source_key": f"c-{i}-L2", "source_final_sha256": sha}))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fixture(tmp_path, final_shas, *, make_final=None):
    cards = tmp_path / "cards.jsonl"; _write_cards(cards, final_shas)
    decisions = tmp_path / "decisions.jsonl"; decisions.write_text("{}\n", encoding="utf-8")
    requirements = tmp_path / "req.json"; requirements.write_text("{}\n", encoding="utf-8")
    packet = tmp_path / "packet.json"; packet.write_text("{}\n", encoding="utf-8")
    final = tmp_path / "state_FINAL.json"
    if make_final is not None:
        final.write_text(make_final, encoding="utf-8")
    return dict(cards=cards, decisions=decisions, requirements=requirements,
                packet=packet, final_corpus=final)


def test_single_distinct_card_final_is_the_corpus_identity(tmp_path):
    sha = "a" * 64
    man = m.build_manifest(**_fixture(tmp_path, [sha, sha, sha]))
    assert man["state_FINAL"]["expected_sha256"] == sha
    assert man["state_FINAL"]["file_present_on_this_machine"] is False
    assert man["state_FINAL"]["file_matches_card_binding"] is None
    assert man["fail_closed"]["split_corpus"] is False


def test_split_corpus_fails_closed(tmp_path):
    with pytest.raises(m.ManifestError, match="split hand corpus"):
        m.build_manifest(**_fixture(tmp_path, ["a" * 64, "b" * 64]))


def test_missing_required_artifact_fails_closed(tmp_path):
    fx = _fixture(tmp_path, ["a" * 64])
    fx["requirements"].unlink()
    with pytest.raises(m.ManifestError, match="required requirements artifact missing"):
        m.build_manifest(**fx)


def test_present_final_file_matching_binding(tmp_path):
    body = '{"hand": "corpus"}\n'
    sha = hashlib.sha256(body.encode()).hexdigest()
    man = m.build_manifest(**_fixture(tmp_path, [sha], make_final=body))
    assert man["state_FINAL"]["file_present_on_this_machine"] is True
    assert man["state_FINAL"]["file_matches_card_binding"] is True
    assert man["fail_closed"]["final_file_sha_mismatch"] is False


def test_present_final_file_mismatch_is_flagged(tmp_path):
    man = m.build_manifest(**_fixture(tmp_path, ["a" * 64], make_final="DIFFERENT\n"))
    assert man["state_FINAL"]["file_present_on_this_machine"] is True
    assert man["state_FINAL"]["file_matches_card_binding"] is False
    assert man["fail_closed"]["final_file_sha_mismatch"] is True


def test_cli_exits_nonzero_on_final_mismatch(tmp_path):
    fx = _fixture(tmp_path, ["a" * 64], make_final="DIFFERENT\n")
    out = tmp_path / "manifest.json"
    code = m.main([
        "--cards", str(fx["cards"]), "--decisions", str(fx["decisions"]),
        "--requirements", str(fx["requirements"]), "--packet", str(fx["packet"]),
        "--final", str(fx["final_corpus"]), "--out", str(out), "--write",
    ])
    assert code == 3
    assert out.is_file()  # manifest still written so the mismatch is recorded
