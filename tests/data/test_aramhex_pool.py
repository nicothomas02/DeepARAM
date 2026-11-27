"""Pooling earlier AramHex patches (data/aramhex/common.py pool, Nico 2026-11-23): a row keeps its earlier patches while
its lead holds, drops them once it changes, and the champion's builds carry the pooled numbers."""
import json
import os

from deeparam_data_helpers import load_module

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ah = load_module("data/aramhex/common.py", "aramhex_common")


def test_pool_keeps_steady_rows_and_drops_changed_ones():
    base = {"x": [100000, 50000]}
    now = {"a": [200, 120], "b": [200, 120], **base}  # both lead by ~10 pts on 200 games
    before = {"a": [20000, 12000], "b": [20000, 8000], **base}  # a still leads; b trailed (changed)
    p = ah.pool([now, before])
    assert p["a"][2] == 2 and p["a"][1] > 10000  # pooled: worth thousands of games
    assert p["b"][2] == 1 and p["b"][1] == 200  # dropped: this patch alone
    assert abs(p["a"][0] - 0.6) < 0.02


def test_pool_needs_an_unbroken_chain():
    now = {"a": [500, 260], "z": [50000, 25000]}
    gap = {"z": [50000, 25000]}
    old = {"a": [50000, 26000], "z": [50000, 25000]}
    assert ah.pool([now, gap, old])["a"][2] == 1


def test_builds_carry_pooled_augments():
    with open(os.path.join(ROOT, "data", "cn", "builds", "202.json")) as f:
        b = json.load(f)
    rows = b["augments"]["all"]
    pooled = [r for r in rows if "pooled" in r]
    assert pooled, "no pooled augment rows on Jhin"
    for r in pooled:
        assert 2 <= r["pooled"]["patches"] <= ah.POOL_DEPTH + 1
        assert r["pooled"]["games"] >= r["games"]
        assert 0 < r["pooled"]["win_rate"] < 1


def test_drift_weights_keep_the_live_patch_in_charge():
    """Drift weights (Nico 2026-11-27): a huge earlier sample counts as a bounded prior, and an augment the Mayhem notes
    changed fades faster than one they didn't."""
    now = {"a": [2000, 1100], "z": [100000, 50000]}  # +5 pts on 2,000 live games
    before = {"a": [200000, 104000], "z": [100000, 50000]}  # +2 pts on 200,000 earlier games
    fixed = ah.pool([now, before])["a"][0]
    drift = ah.pool([now, before], drift=ah.POOL_DRIFT)["a"][0]
    changed = ah.pool([now, before], drift=ah.POOL_DRIFT, changed=[set(), {"a"}])["a"][0]
    assert fixed < drift < changed < 0.55  # the live +5 counts for more with drift, more again when changed
    assert ah.pool([now, before], drift=ah.POOL_DRIFT)["a"][2] == 2


def test_notes_name_changed_augments():
    names = json.load(open(os.path.join(ROOT, "web", "src", "data", "augment-names.json")))
    got = {names[i] for i in ah.notes_changed_augments("16.23")}
    assert {"Bouncing Bees", "Salvation", "The Boom and the Bass"} <= got
    by_age = ah.changed_by_age("16.23")
    assert by_age[0] == set() and by_age[1] == ah.notes_changed_augments("16.23")
