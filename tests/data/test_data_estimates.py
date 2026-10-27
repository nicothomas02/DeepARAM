"""Estimated stats: data/estimates/ (common.py, build.py, fitted.json, estimates.json)."""
import pytest

from deeparam_data_helpers import load_json, load_module

cm = load_module("data/estimates/common.py", "estimates_common", extra_path=["data/estimates"])


@pytest.fixture(scope="module")
def est():
    return load_json("data/estimates/estimates.json")


def test_augment_win_rate_follows_grade_and_lift():
    model = load_json("data/estimates/fitted.json")["augment_model"]
    g = model["grade"]
    assert g["S"] > g["A"] > g["B"] > g["C"]
    base = cm.augment_win_rate(0.5, 0.0, "A", model)
    assert cm.augment_win_rate(0.5, 0.02, "A", model) > base
    assert cm.augment_win_rate(0.5, 0.0, "S", model) > base


def test_sections_present(est):
    for key in ("vs_average", "profiles", "augments", "augment_pairs", "augment_stages", "augment_items",
                "rarity_odds", "items", "duos", "game_length", "side", "fun"):
        assert est[key], key
    assert est["estimated"] is True


def test_rarity_odds_sum_to_one(est):
    odds = est["rarity_odds"]
    assert sum(odds["overall"].values()) == pytest.approx(1, abs=1e-3)
    for stage in odds["by_stage"]:
        assert sum(stage.values()) == pytest.approx(1, abs=1e-3)


def test_profiles_and_damage_split(est):
    for c, p in est["profiles"].items():
        assert sum(p["damage_split"].values()) == pytest.approx(1, abs=2e-3)
        assert p["deaths"]["band"] in ("high", "average", "low")
        assert p["kills"]["value"] > 0


def test_augment_rows_consistent(est):
    for c, rows in est["augments"].items():
        for r in rows:
            assert 0.2 < r["win_rate"] < 0.8
        for r in est["augment_pairs"][c]:
            assert 0 < r["pick_rate"] <= 1


def test_duo_lift(est):
    for d in est["duos"][:50]:
        assert d["lift"] == pytest.approx(d["win_rate"] - d["expected"], abs=1e-3)


def test_power_curve():
    d = load_json("data/estimates/power_curve.json")
    assert d["simulated"] is True and len(d["champions"]) > 150
    for c in d["champions"].values():
        for s in ("early", "mid", "late"):
            assert 0 < c[s] <= 1
    late, early = d["late_game"][0], d["early_game"][0]
    assert d["champions"][str(late)]["scaling"] > 0 > d["champions"][str(early)]["scaling"]


def test_champion_upgrades():
    d = load_json("data/estimates/champion_upgrades.json")
    assert d["simulated"] is True and d["method"]["beta"] > 0
    pools = load_json("simulator/data/augment_pools.json")["pools"]
    items = {v["id"]: v for v in load_json("simulator/data/items.json")["items"].values()}
    assert len(d["champions"]) > 150
    for cid, c in d["champions"].items():
        pk = c["pentakill"]
        # Pentakill: a basic ability at the start, a different one (the ultimate allowed) at level 18.
        assert pk["start"] in "QWE" and pk["level18"] in "QWER" and pk["level18"] != pk["start"]
        wod = c["weapon_of_destiny"]
        if wod["best"]:
            assert items[wod["best"]]["slot"] == "legendary"
            assert wod["options"][0]["item"] == wod["best"]
        best = c["augments"]["best"]
        assert len(set(best["keys"])) == 4
        assert set(best["keys"]) <= set(pools[cid])
        assert best["score"] == pytest.approx(best["real"] + best["synergy"], abs=0.02)
