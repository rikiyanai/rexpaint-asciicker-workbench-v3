"""Canonical path constants for the failure log.

Single source of truth for all tools that locate docs/FAILURE_LOG.md and its
overlay sidecar. Import these instead of hard-coding the path string in each
tool.
"""
from __future__ import annotations

from pathlib import Path

CANONICAL_FAILURE_LOG_REL = Path("docs/FAILURE_LOG.md")
LEGACY_FAILURE_LOG_REL = Path("docs/research/ascii/verification/FAILURE_LOG.md")
CANONICAL_FAILURE_LOG_CANDIDATES = (
    CANONICAL_FAILURE_LOG_REL,
    LEGACY_FAILURE_LOG_REL,
)

# Overlay storage (FL-4582 machinery split, 2026-07-12; sharded v2 2026-07-12).
# Machine-generated overlay rows live in a sibling directory of sharded parts
# (part-NNNN.jsonl, each < 10 MB), NOT inlined in the .md. docs/FAILURE_LOG.md
# keeps prose only; this directory is the single overlay owner.
CANONICAL_FAILURE_LOG_OVERLAY_REL = Path("docs/FAILURE_LOG.overlay")

# Alias used by maintainer/lib/failure_log.py (which predates the _REL suffix convention)
CANONICAL_FAILURE_LOG = CANONICAL_FAILURE_LOG_REL
CANONICAL_FAILURE_LOG_OVERLAY = CANONICAL_FAILURE_LOG_OVERLAY_REL
