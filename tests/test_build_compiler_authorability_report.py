"""FL-4162 step 10a — authorability report decides every layer fail-closed."""
import sys
from pathlib import Path

import pytest

PIPELINE_V3 = Path(__file__).resolve().parents[1]
if str(PIPELINE_V3 / "scripts") not in sys.path:
    sys.path.insert(0, str(PIPELINE_V3 / "scripts"))

import build_compiler_authorability_report as ar  # noqa: E402


def _contracts(per_card, family="player"):
    return {"contracts": {family: {"card_count": len(per_card), "per_card": per_card}}}


def _reqs(rows):
    return {"requirements": rows}


def test_owned_no_blockers_is_content_clean():
    contracts = _contracts([{"card_id": "player-0100-L3", "classification": "owned"}])
    reqs = _reqs([{"source_key": "player-0100-L3", "promotion_blockers": list(ar.PHASE_GATES)}])
    report = ar.build_report(contracts, reqs)
    assert report["summary"]["content_clean"] == 1
    assert report["layers"][0]["content_status"] == "content_clean"
    # Phase gates still apply — content_clean is not closure.
    assert report["layers"][0]["phase_gated"] is True
    assert report["authority"] is False


def test_role_name_conflict_blocks_with_plan_class_3():
    contracts = _contracts([{"card_id": "player-0100-L3", "classification": "owned"}])
    reqs = _reqs([{"source_key": "player-0100-L3",
                   "promotion_blockers": [*ar.PHASE_GATES, "role_name_conflict_unresolved"]}])
    report = ar.build_report(contracts, reqs)
    assert report["summary"]["content_clean"] == 0
    assert report["summary"]["blocked_by_plan_rejection_class"]["3_role_name_conflict"] == 1


def test_composite_blocks_with_plan_class_4():
    contracts = _contracts([{"card_id": "p-L4", "classification": "composite"}])
    reqs = _reqs([{"source_key": "p-L4",
                   "promotion_blockers": [*ar.PHASE_GATES, "composite_layer_requires_family_contract"]}])
    report = ar.build_report(contracts, reqs)
    assert report["summary"]["blocked_by_plan_rejection_class"]["4_topology_mismatch"] == 1
    assert report["layers"][0]["content_status"] == "content_blocked"


def test_unresolved_and_rejected_map_to_unowned_class_2():
    contracts = _contracts([
        {"card_id": "p-L3", "classification": "unresolved"},
        {"card_id": "p-L4", "classification": "rejected"},
    ])
    report = ar.build_report(contracts, _reqs([]))  # no requirements for these
    assert report["summary"]["blocked_by_plan_rejection_class"]["2_unowned_visible_layer"] == 2
    assert report["summary"]["content_clean"] == 0


def test_non_accept_status_blocks_but_has_no_hard_plan_class():
    contracts = _contracts([{"card_id": "p-L3", "classification": "owned"}])
    reqs = _reqs([{"source_key": "p-L3",
                   "promotion_blockers": [*ar.PHASE_GATES, "decision_from_non_accept_hand_status"]}])
    report = ar.build_report(contracts, reqs)
    assert report["summary"]["content_clean"] == 0
    assert report["summary"]["content_blocked_by_reason"][
        "proposal_from_non_accept_hand_status"] == 1
    # It is a content-confidence block, not one of the hard rejection classes.
    assert "proposal_from_non_accept_hand_status" not in report["summary"][
        "blocked_by_plan_rejection_class"]


def test_unknown_classification_fails_closed():
    contracts = _contracts([{"card_id": "p-L3", "classification": "mystery"}])
    with pytest.raises(ar.AuthorabilityReportError, match="unknown classification"):
        ar.build_report(contracts, _reqs([]))


def test_coverage_mismatch_fails_closed():
    contracts = {"contracts": {"player": {
        "card_count": 5,  # lies: only one per_card entry
        "per_card": [{"card_id": "p-L3", "classification": "owned"}],
    }}}
    with pytest.raises(ar.AuthorabilityReportError, match="covered 1 layers but contract declares 5"):
        ar.build_report(contracts, _reqs([{"source_key": "p-L3", "promotion_blockers": []}]))


def test_missing_input_fails_closed(tmp_path):
    with pytest.raises(ar.AuthorabilityReportError, match="required topology contracts missing"):
        ar._load_json(tmp_path / "nope.json", "topology contracts")


# --- FL-4162 Surface B: contract-bound hand-status reconciliation (fingerprint-bound) ---
def _hs_recon(sk, fp, orig="partial"):
    return {"source_key": sk, "whole_atlas_fingerprint": fp,
            "asserted_original_status": orig, "reconciled_status": "accept"}


def test_hand_status_reconciliation_clears_non_accept_blocker():
    contracts = _contracts([{"card_id": "wolack-0001-L2", "classification": "owned",
                             "whole_atlas_fingerprint": "WFP", "hand_status": "partial"}],
                           family="wolack")
    reqs = _reqs([{"source_key": "wolack-0001-L2",
                   "promotion_blockers": [*ar.PHASE_GATES, "decision_from_non_accept_hand_status"]}])
    recon = {"wolack-0001-L2": _hs_recon("wolack-0001-L2", "WFP", "partial")}
    report = ar.build_report(contracts, reqs, recon)
    assert report["summary"]["content_clean"] == 1            # blocker cleared
    layer = report["layers"][0]
    assert layer["content_status"] == "content_clean"
    assert layer["hand_status_reconciled"] is True
    assert layer["original_hand_status"] == "partial"         # provenance kept


def test_hand_status_reconciliation_fingerprint_mismatch_fails_closed():
    contracts = _contracts([{"card_id": "wolack-0001-L2", "classification": "owned",
                             "whole_atlas_fingerprint": "WFP", "hand_status": "partial"}],
                           family="wolack")
    reqs = _reqs([{"source_key": "wolack-0001-L2",
                   "promotion_blockers": ["decision_from_non_accept_hand_status"]}])
    recon = {"wolack-0001-L2": _hs_recon("wolack-0001-L2", "WRONG", "partial")}
    with pytest.raises(ar.AuthorabilityReportError, match="fingerprint mismatch"):
        ar.build_report(contracts, reqs, recon)


def test_hand_status_reconciliation_wrong_asserted_status_fails_closed():
    contracts = _contracts([{"card_id": "wolack-0001-L2", "classification": "owned",
                             "whole_atlas_fingerprint": "WFP", "hand_status": "partial"}],
                           family="wolack")
    reqs = _reqs([{"source_key": "wolack-0001-L2",
                   "promotion_blockers": ["decision_from_non_accept_hand_status"]}])
    recon = {"wolack-0001-L2": _hs_recon("wolack-0001-L2", "WFP", "accept")}  # wrong
    with pytest.raises(ar.AuthorabilityReportError, match="asserted_original_status"):
        ar.build_report(contracts, reqs, recon)


def test_unconsumed_hand_status_reconciliation_fails_closed():
    contracts = _contracts([{"card_id": "wolack-0001-L2", "classification": "owned",
                             "whole_atlas_fingerprint": "WFP", "hand_status": "partial"}],
                           family="wolack")
    reqs = _reqs([{"source_key": "wolack-0001-L2", "promotion_blockers": []}])
    recon = {"nope-L2": _hs_recon("nope-L2", "X")}
    with pytest.raises(ar.AuthorabilityReportError, match="not matched"):
        ar.build_report(contracts, reqs, recon)


def test_load_hand_status_reconciliations_requires_authority_false(tmp_path):
    import json as _json
    p = tmp_path / "hs.json"
    p.write_text(_json.dumps({"authority": True, "reconciliations": []}))
    with pytest.raises(ar.AuthorabilityReportError, match="authority:false"):
        ar.load_hand_status_reconciliations(p)
    assert ar.load_hand_status_reconciliations(tmp_path / "nope.json") == {}
