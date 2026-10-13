#!/usr/bin/env python3
"""FL-4162 step 9b — provenance manifest beside the requirements proposal.

This manifest binds the three review owners and the Step 9 requirements output to
exact source SHAs so a later reader can prove which immutable hand corpus, which
evidence cards, and which reviewed decisions produced a given requirements packet.

It is provenance only. It is NOT authority, NOT a compiler input, and NOT a
runtime visual claim (Canon Law 16: a recorded SHA is not closure).

Binding model (KNOWN, verified 2026-06-18):
  Every evidence card carries source_final_sha256. Across the live corpus there is
  exactly ONE distinct value, and it equals sha256(state_FINAL_*.json). So the
  in-repo cards cryptographically bind to the immutable hand corpus even on a
  machine where the operator-local Desktop FINAL file is absent. The manifest
  records the card-embedded binding as the authoritative tie and records the
  Desktop file SHA only as a presence-confirmation when the file exists.

Fail-closed (Canon Law 6):
  - a missing required in-repo artifact raises (never a silent empty manifest);
  - more than one distinct card source_final_sha256 raises (a split corpus must be
    visible, not averaged away);
  - if the Desktop FINAL file is present but its SHA does not match the
    card-embedded binding, the manifest records mismatch=True and the CLI exits
    non-zero.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SM = REPO_ROOT / "docs/research/ascii/semantic_maps"
DEFAULT_CARDS = SM / "layer_evidence_cards.jsonl"
DEFAULT_DECISIONS = SM / "source_layer_review_decisions.jsonl"
DEFAULT_REQUIREMENTS = SM / "actor_visual_profile_requirements.json"
DEFAULT_PACKET = SM / "manual_candidate_review.json"
DEFAULT_OUT = SM / "review_provenance_manifest.json"
# Operator-local immutable hand corpus (absent on CI / other machines by design).
# Pass --final <path> (or $ASCIICKER_STATE_FINAL) for presence-confirmation;
# without it the manifest records file_present_on_this_machine=False.
DEFAULT_FINAL: Path | None = None
SCHEMA = "review_provenance_manifest/v1"


class ManifestError(Exception):
    """FL-4162: provenance manifest could not be built fail-closed."""


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _require(path: Path, label: str) -> str:
    if not path.is_file():
        raise ManifestError(f"required {label} artifact missing: {path}")
    return _sha256_file(path)


def _distinct_card_final_sha(cards_path: Path) -> list[str]:
    seen: set[str] = set()
    with cards_path.open("r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                card = json.loads(line)
            except ValueError as exc:
                raise ManifestError(f"{cards_path}:{lineno}: malformed card JSON: {exc}") from exc
            sha = card.get("source_final_sha256")
            if not sha:
                raise ManifestError(f"{cards_path}:{lineno}: card missing source_final_sha256")
            seen.add(str(sha))
    if not seen:
        raise ManifestError(f"{cards_path}: no cards found")
    return sorted(seen)


def _git_commit(repo: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo), capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        return None


def build_manifest(
    *,
    cards: Path = DEFAULT_CARDS,
    decisions: Path = DEFAULT_DECISIONS,
    requirements: Path = DEFAULT_REQUIREMENTS,
    packet: Path = DEFAULT_PACKET,
    final_corpus: Path | None = DEFAULT_FINAL,
) -> dict[str, Any]:
    distinct = _distinct_card_final_sha(cards)
    if len(distinct) != 1:
        raise ManifestError(
            "split hand corpus: cards reference more than one source_final_sha256: "
            + ", ".join(distinct)
        )
    card_bound_final_sha = distinct[0]

    final_present = bool(final_corpus is not None and final_corpus.is_file())
    final_file_sha = (
        _sha256_file(final_corpus)
        if (final_present and final_corpus is not None)
        else None
    )
    final_mismatch = bool(final_present and final_file_sha != card_bound_final_sha)

    manifest = {
        "schema": SCHEMA,
        "authority": False,
        "is_proposal": False,
        "surface_kind": "review_provenance_manifest",
        "recorded_at": "2026-06-18",
        "non_authority_boundary": [
            "This manifest is provenance only.",
            "A recorded SHA is not closure (Canon Law 16).",
            "It does not author ActorVisualProfile rows or feed a compiler.",
        ],
        "state_FINAL": {
            "role": "immutable human hand corpus (operator-local)",
            "expected_sha256": card_bound_final_sha,
            "bound_by": "every evidence card's source_final_sha256",
            "operator_local_path": (str(final_corpus) if final_corpus else None),
            "file_present_on_this_machine": final_present,
            "file_sha256": final_file_sha,
            "file_matches_card_binding": (None if not final_present else not final_mismatch),
        },
        "artifacts": {
            "layer_evidence_cards.jsonl": _require(cards, "evidence cards"),
            "source_layer_review_decisions.jsonl": _require(decisions, "decisions"),
            "actor_visual_profile_requirements.json": _require(requirements, "requirements"),
            "manual_candidate_review.json": _require(packet, "review packet"),
        },
        "generator_commit": {
            "pipeline_v3_submodule": _git_commit(REPO_ROOT / "pipeline-v3"),
            "parent_repo": _git_commit(REPO_ROOT),
            "generator": "pipeline-v3/scripts/build_review_provenance_manifest.py",
        },
        "fail_closed": {
            "split_corpus": False,
            "final_file_sha_mismatch": final_mismatch,
        },
    }
    return manifest


def dump_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=True, sort_keys=True) + "\n"


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd_tmp, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp", prefix=path.stem)
    try:
        with os.fdopen(fd_tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=DEFAULT_CARDS)
    parser.add_argument("--decisions", type=Path, default=DEFAULT_DECISIONS)
    parser.add_argument("--requirements", type=Path, default=DEFAULT_REQUIREMENTS)
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument(
        "--final", type=Path,
        default=(Path(os.environ["ASCIICKER_STATE_FINAL"])
                 if os.environ.get("ASCIICKER_STATE_FINAL") else DEFAULT_FINAL),
        help="operator-local state_FINAL corpus for presence-confirmation "
             "(or $ASCIICKER_STATE_FINAL); omit when absent by design",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        manifest = build_manifest(
            cards=args.cards, decisions=args.decisions, requirements=args.requirements,
            packet=args.packet, final_corpus=args.final,
        )
    except ManifestError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    text = dump_json(manifest)
    if args.write:
        atomic_write_text(args.out, text)
        print(f"wrote {args.out}")
    else:
        print(text, end="")
    # Fail closed at the CLI if the present Desktop corpus contradicts the binding.
    if manifest["fail_closed"]["final_file_sha_mismatch"]:
        print("FAIL: state_FINAL file SHA does not match card-embedded binding", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
