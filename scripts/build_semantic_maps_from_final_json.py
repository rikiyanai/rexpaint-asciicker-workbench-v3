"""Build pipeline-v3/docs/research/ascii/semantic_maps/{family}-roles.json
from the May-21 FINAL JSON layer-verification ledger.

End-to-end pipeline:
  1. parse FINAL JSON layer rows
  2. canonicalize labels/notes to controlled vocabulary (CANONICAL_REGIONS)
  3. for each accepted/partial layer, run the existing CP437 matcher on the
     per-layer PNG with NO bias, count which glyphs the matcher picks
  4. aggregate counts per (family, canonical_region)
  5. emit one {family}-roles.json per family

Run:
  BUNDLE_LAYER_AUDIT_DIR=/path/to/bundle_layer_audit_20260520 \
    python3 pipeline-v3/scripts/build_semantic_maps_from_final_json.py [--limit N]
  # or explicitly:
  python3 pipeline-v3/scripts/build_semantic_maps_from_final_json.py \
    --final-json <STATE_FINAL_JSON> --png-root <PNG_LAYERS_DIR> [--limit N]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

from glyph_assignment import GlyphAssignmentConfig
from glyph_assignment.final_json_ingest import (
    build_canonical_vocabulary,
    build_layer_regions_index,
    extract_glyph_frequencies,
    write_semantic_maps,
)
from glyph_assignment.matcher import default_font_path


# Operator-local inputs (absent on CI / other machines by design).
# Pass --final-json/--png-root (or $ASCIICKER_FINAL_JSON/$ASCIICKER_PNG_ROOT).
SEMANTIC_MAPS_DIR = ROOT / "docs" / "research" / "ascii" / "semantic_maps"
WORK_DIR = Path("/tmp/glyph_e1e3")

# Layout inside the May-20 bundle layer audit directory.
FINAL_JSON_RELPATH = Path("verifier_state_backups") / "state_FINAL_20260521-163326.json"
PNG_ROOT_RELPATH = Path("png_layers")


def _resolve_audit_inputs(args: argparse.Namespace) -> tuple[Path, Path]:
    """FINAL JSON ledger + per-layer PNG root.

    Precedence per path: explicit --final-json / --png-root, then
    --audit-dir / $BUNDLE_LAYER_AUDIT_DIR joined with the known relative
    layout. The audit bundle lives outside this repo, so there is no
    repo-relative default; fail fast rather than emit wrong semantic maps.
    """
    audit_raw = args.audit_dir or os.environ.get("BUNDLE_LAYER_AUDIT_DIR")
    audit_dir = Path(audit_raw).expanduser() if audit_raw else None

    def pick(explicit: str | None, relpath: Path, flag: str, legacy_env: str) -> Path:
        if explicit:
            return Path(explicit).expanduser()
        if audit_dir is not None:
            return audit_dir / relpath
        legacy = os.environ.get(legacy_env)
        if legacy:
            return Path(legacy).expanduser()
        raise SystemExit(
            "Bundle layer audit inputs not configured. Set "
            "BUNDLE_LAYER_AUDIT_DIR (or pass --audit-dir) to the "
            "bundle_layer_audit_20260520 directory containing "
            f"{FINAL_JSON_RELPATH.parent}/ and {PNG_ROOT_RELPATH}/, "
            f"pass {flag} explicitly, or set ${legacy_env}."
        )

    final_json = pick(args.final_json, FINAL_JSON_RELPATH, "--final-json", "ASCIICKER_FINAL_JSON")
    png_root = pick(args.png_root, PNG_ROOT_RELPATH, "--png-root", "ASCIICKER_PNG_ROOT")
    if not final_json.is_file():
        raise SystemExit(f"FINAL JSON ledger not found: {final_json}")
    if not png_root.is_dir():
        raise SystemExit(f"PNG layer root not found: {png_root}")
    return final_json, png_root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit", type=int, default=None,
        help="process only the first N families (mainly for debugging)",
    )
    parser.add_argument(
        "--weight-floor", type=float, default=0.15,
        help="drop glyphs whose normalized weight is below this threshold",
    )
    parser.add_argument(
        "--no-emit", action="store_true",
        help="run extraction but do not write semantic_maps/ JSONs",
    )
    parser.add_argument(
        "--audit-dir", default=None,
        help="bundle_layer_audit_20260520 directory (defaults to "
             "$BUNDLE_LAYER_AUDIT_DIR)",
    )
    parser.add_argument(
        "--final-json", default=None,
        help="explicit path to the FINAL JSON ledger (overrides --audit-dir)",
    )
    parser.add_argument(
        "--png-root", default=None,
        help="explicit path to the per-layer PNG root (overrides --audit-dir)",
    )
    args = parser.parse_args()
    # Audit inputs come from --final-json/--png-root, --audit-dir /
    # $BUNDLE_LAYER_AUDIT_DIR, or legacy $ASCIICKER_FINAL_JSON /
    # $ASCIICKER_PNG_ROOT (see _resolve_audit_inputs).
    final_json, png_root = _resolve_audit_inputs(args)

    WORK_DIR.mkdir(parents=True, exist_ok=True)

    print(f"FINAL_JSON: {final_json}")
    print(f"PNG_ROOT:   {png_root}")
    print(f"OUT_DIR:    {SEMANTIC_MAPS_DIR}")
    print()

    # Step 1+2: canonical vocabulary report
    vocab = build_canonical_vocabulary(final_json)
    (WORK_DIR / "canonical_vocabulary.json").write_text(
        json.dumps(vocab, indent=2) + "\n"
    )
    print("CANONICAL VOCAB:")
    print(f"  total rows:            {vocab['stats']['total_rows']}")
    print(f"  accept+partial+ambig:  {vocab['stats']['accept_partial_ambig']}")
    print(f"  unmapped:              {vocab['stats']['unmapped_count']}")
    print(f"  composite rows:        {vocab['stats']['composite_count']}")
    if vocab["unmapped"]:
        print(f"  WARNING — {len(vocab['unmapped'])} unmapped (first 5):")
        for row_key, label, note in vocab["unmapped"][:5]:
            print(f"    {row_key:32s} label={label!r:32s} note={note[:40]!r}")
    print()

    # Step 3+4: layer index + glyph frequency extraction
    layer_index = build_layer_regions_index(final_json)
    (WORK_DIR / "layer_regions.json").write_text(
        json.dumps(
            {
                family: {f"{ahsw}-L{idx}": entry for (ahsw, idx), entry in fam.items()}
                for family, fam in layer_index.items()
            },
            indent=2,
        )
        + "\n"
    )
    print("LAYER INDEX:")
    for family, fam_map in layer_index.items():
        regions = {}
        for entry in fam_map.values():
            regions[entry["region"]] = regions.get(entry["region"], 0) + 1
        print(f"  {family:8s} {len(fam_map):4d} layers  regions={regions}")
    print()

    if args.limit is not None:
        keys = list(layer_index.keys())[: args.limit]
        layer_index = {k: layer_index[k] for k in keys}
        print(f"--limit applied: keeping {keys}")

    # Matcher config — matches `convert_24px_mini_template_2x.py` defaults
    font_path = default_font_path(ROOT)
    config = GlyphAssignmentConfig(
        font_path=font_path,
        font_cell_size=(6, 6),
        target_cell_size=(6, 6),
        candidate_limit=5,
        score_delta_threshold=0.15,
    )

    print("Running matcher across verified layers (this may take a minute)...")
    glyph_freqs = extract_glyph_frequencies(
        layer_index,
        png_root=png_root,
        config=config,
    )
    (WORK_DIR / "glyph_frequencies.json").write_text(
        json.dumps(
            {
                family: {
                    region: {str(g): c for g, c in counts.items()}
                    for region, counts in regions.items()
                }
                for family, regions in glyph_freqs.items()
            },
            indent=2,
        )
        + "\n"
    )
    print()
    print("GLYPH FREQUENCIES (top 5 glyphs per region):")
    for family, regions in glyph_freqs.items():
        for region, counts in regions.items():
            top = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
            top_str = ", ".join(f"{g}:{c:.0f}" for g, c in top)
            print(f"  {family:8s} {region:32s} → {top_str}")
    print()

    if args.no_emit:
        print("--no-emit specified; semantic_maps/ NOT written")
        return 0

    # Step 5: emit semantic_maps JSONs
    SEMANTIC_MAPS_DIR.mkdir(parents=True, exist_ok=True)
    paths = write_semantic_maps(
        glyph_freqs, SEMANTIC_MAPS_DIR, weight_floor=args.weight_floor
    )
    print(f"EMITTED {len(paths)} semantic_maps:")
    for path in paths:
        size = path.stat().st_size
        print(f"  {path}  ({size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
