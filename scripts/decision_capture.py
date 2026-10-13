#!/usr/bin/env python3
"""FL-4162 step 8 — reviewed source-layer decision capture (write path).

A THIRD owner, deliberately separate from the two that precede it:

  1. state_FINAL_*.json        immutable hand-corpus      (authored, sha-pinned)
  2. layer_evidence_cards.jsonl source-backed evidence    (authority:false)
  3. source_layer_review_decisions.jsonl  <-- THIS FILE   reviewed human verdict

This module owns ONLY #3. It writes a human's reviewed decision about a single
(source_xp_path + raw_layer_index) layer, captured while looking at that layer's
evidence card through the XP Body Viewer microscope.

AUTHORITY DISCIPLINE (do not regress):
  - A decision is a PROPOSAL, never semantic-map authority. Every record carries
    `authority: false`. No compiler / ActorVisualProfile path consumes this file
    yet — that is step 10, behind its own fail-closed gate.
  - Fail closed (canon Law 6): a decision pins `source_card_fingerprint`, the hash
    of the evidence card it was made against. If the card the reviewer is looking
    at no longer matches the fingerprint they began the decision with, the write
    is BLOCKED — a stale decision must never silently apply to changed evidence.
  - This module never mutates state_FINAL or the evidence cards. It only appends
    reviewed verdicts to its own file, atomically (temp + os.replace), upserting
    by source_key so the current verdict per layer reloads beside its card.

The interactive trigger (a viewer keybind + typed prompt) lives in
xp_uv_body_viewer.py. The write/read/fingerprint logic lives here so it is pure
and unit-testable without a TTY.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "source_layer_review_decision/v1"
DECISIONS_FILENAME = "source_layer_review_decisions.jsonl"

# The evidence subset a role decision is actually made against. Deliberately
# EXCLUDES `review` (rejects-first ordering is navigation, not role evidence) and
# the constant proposal flags, so a corpus re-emit that only reshuffles ranks
# does NOT invalidate prior decisions — but any change to the source row, engine
# facts, cells, glyph evidence, or provenance DOES (fail closed).
_FINGERPRINT_FIELDS = (
    "card_id",
    "source_key",
    "source_xp_path",
    "source_final_sha256",
    "raw_layer_index",
    "ahsw",
    "hand",
    "engine",
    "cells",
    "glyph_similarity",
)


class DecisionFingerprintMismatch(Exception):
    """Raised when a decision write is attempted against a card whose fingerprint
    no longer matches the one the reviewer began the decision with. Fail closed:
    no write happens."""


class DecisionLoadError(Exception):
    """Raised when an EXISTING decisions file cannot be loaded faithfully — it is
    present but unreadable, or it contains a malformed JSON line or a row missing
    its source_key. Fail closed per canon Law 6 (FL-4162): a reviewed human-verdict
    owner must never silently drop a decision. A genuinely-ABSENT file is not an
    error (returns {})."""


def card_fingerprint(card: dict) -> str:
    """Stable sha256 over the evidence subset a role decision pins against."""
    subset = {k: card.get(k) for k in _FINGERPRINT_FIELDS}
    blob = json.dumps(subset, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _source_key(card: dict) -> str:
    key = card.get("source_key") or card.get("card_id")
    if not key:
        raise ValueError("evidence card has no source_key / card_id to key the decision on")
    return str(key)


def build_decision_record(
    card: dict,
    *,
    approved_role: str,
    provenance: dict,
    composite_roles: list[str] | None = None,
    topology_note: str = "",
    contradictions: list[str] | None = None,
    reviewer_note: str = "",
) -> dict[str, Any]:
    """Build (but do not write) a reviewed-decision record for one evidence card.

    `composite_roles` defaults to the ';'-split of `approved_role` so a reviewer
    can record a multi-role layer from one typed field; topology_note and
    contradictions stay empty here (step 9 / the contradiction report fill them).
    """
    approved_role = (approved_role or "").strip()
    if not approved_role:
        raise ValueError("approved_role is required and must be non-empty")
    if composite_roles is None:
        composite_roles = [p.strip() for p in approved_role.split(";") if p.strip()]
    return {
        "schema": SCHEMA,
        "authority": False,     # PROPOSAL only — never semantic-map authority (step 10 gate)
        "is_proposal": True,
        "source_key": _source_key(card),
        "card_id": card.get("card_id"),
        "source_xp_path": card.get("source_xp_path"),
        "family": card.get("family"),
        "raw_layer_index": card.get("raw_layer_index"),
        "approved_role": approved_role,
        "composite_roles": composite_roles,
        "topology_note": topology_note,
        "contradictions": list(contradictions or []),
        "reviewer_note": reviewer_note,
        "source_card_fingerprint": card_fingerprint(card),
        "source_final_sha256": card.get("source_final_sha256"),
        "review_provenance": dict(provenance),
    }


def load_decisions(path: Path | str) -> dict[str, dict]:
    """Read the decisions file, upserting by source_key (later lines win).

    Returns {source_key: record}. A genuinely-MISSING file returns {} — there is
    nothing to lose. But an EXISTING file that is unreadable, or that contains a
    malformed JSON line or a row missing its source_key, raises DecisionLoadError
    rather than silently dropping rows (fail closed, canon Law 6 / FL-4162). Silent
    row loss would let a reviewer's recorded decision vanish with no signal.
    """
    p = Path(path)
    if not p.is_file():
        return {}
    try:
        raw = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise DecisionLoadError(f"decisions file present but unreadable: {p} ({exc})") from exc
    out: dict[str, dict] = {}
    for lineno, line in enumerate(raw.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError as exc:
            raise DecisionLoadError(f"malformed JSON on line {lineno} of {p}: {exc}") from exc
        if not isinstance(rec, dict) or not rec.get("source_key"):
            raise DecisionLoadError(
                f"line {lineno} of {p} is not a decision record (missing source_key)"
            )
        out[str(rec["source_key"])] = rec
    return out


def latest_decision_for(path: Path | str, source_key: str) -> dict | None:
    return load_decisions(path).get(str(source_key))


def _atomic_write_jsonl(path: Path, records: Iterable[dict]) -> None:
    """Write all records to `path` atomically: serialize to a temp file in the
    same dir, fsync, then os.replace. On any failure the original file is left
    untouched and the temp file is removed (no partial/corrupt output)."""
    path = Path(path)
    fd_tmp, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp", prefix=path.stem)
    try:
        with os.fdopen(fd_tmp, "w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True))
                fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def record_decision(
    path: Path | str,
    card: dict,
    *,
    approved_role: str,
    provenance: dict,
    composite_roles: list[str] | None = None,
    topology_note: str = "",
    contradictions: list[str] | None = None,
    reviewer_note: str = "",
    expected_fingerprint: str | None = None,
) -> dict:
    """Record one reviewed decision for `card` into the decisions file.

    Fail-closed guard: if `expected_fingerprint` is given (the fingerprint the
    reviewer began the decision with) and the card's current fingerprint differs,
    raise DecisionFingerprintMismatch and write NOTHING. Otherwise upsert the
    record by source_key and rewrite the file atomically. Returns the record.
    """
    fp = card_fingerprint(card)
    if expected_fingerprint is not None and expected_fingerprint != fp:
        raise DecisionFingerprintMismatch(
            f"card fingerprint changed since decision began "
            f"(expected {expected_fingerprint[:12]}…, now {fp[:12]}…) — write blocked"
        )
    rec = build_decision_record(
        card,
        approved_role=approved_role,
        provenance=provenance,
        composite_roles=composite_roles,
        topology_note=topology_note,
        contradictions=contradictions,
        reviewer_note=reviewer_note,
    )
    decisions = load_decisions(path)
    decisions[rec["source_key"]] = rec
    ordered = [decisions[k] for k in sorted(decisions)]
    _atomic_write_jsonl(Path(path), ordered)
    return rec
