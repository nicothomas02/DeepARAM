"""Analyses in data/analysis/ (common.py and the four JSON outputs read by the site)."""
import math

import pytest

from deeparam_data_helpers import load_json, load_module

common = load_module("data/analysis/common.py", "analysis_common", extra_path=["data/analysis"])


@pytest.mark.parametrize(
    "line, kind, sign",
    [
        ("Damage Dealt: 95% ⇒ 100%", "damage_dealt", 1),
        ("Damage Taken: 105% ⇒ 100%", "damage_taken", 1),  # taking less damage is a buff
        ("Damage Taken: 5% ⇒ 0%", "damage_taken", 1),  # the same change written as a bonus
        ("Damage Taken: -5% ⇒ 0%", "damage_taken", -1),
        ("Healing: 90% ⇒ 100%", "healing", 1),
        ("Shielding Done: 80% ⇒ 100%", "shielding", 1),
        ("W Cooldown: 22–12 ⇒ 18–12", "ability", 1),  # a shorter cooldown is a buff
        ("Q2 Damage: 60–180 ⇒ 80–240", "ability", 1),
        ("E damage per second 10/15/20/25/30 → 10/16/22/28/34", "ability", 1),  # PBE tracker spelling
        ("Q cooldown 12/11/10/9/8s → 10/9.5/9/8.5/8s", "ability", 1),
        ("Ability Haste: -10 ⇒ 0", "ability", 1),
    ],
)
def test_parse_change_kind_and_direction(line, kind, sign):
    c = common.parse_change(line)
    assert c and c["kind"] == kind
    assert math.copysign(1, c["signed"]) == sign


def test_parse_change_ignores_text_lines():
    assert common.parse_change("NEW In ARAM maps, Viktor gains 1 stack every 5 seconds.") is None
    assert common.parse_change("Damage Dealt: 100% ⇒ 100%")["signed"] == 0


def test_dose_sums_and_intent():
    d = common.dose(["Damage Dealt: 95% ⇒ 100%", "Damage Taken: 105% ⇒ 100%", "W Cooldown: 20 ⇒ 21"])
    assert d["parsed"] == 3 and d["lines"] == 3
    assert d["damage_dealt"] > 0 and d["damage_taken"] > 0 and d["ability"] < 0
    assert d["intent"] == "buff"
    assert common.dose(["Damage Dealt: 105% ⇒ 100%"])["intent"] == "nerf"


def test_small_statistics():
    assert common.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1)
    assert common.spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1)
    assert common.ranks([3, 1, 3]) == [2.5, 1, 2.5]
    coef = common.ridge([[1], [2], [3]], [3, 5, 7], 0.0)
    assert coef[0] == pytest.approx(1) and coef[1] == pytest.approx(2)


@pytest.fixture(scope="module")
def impact():
    return load_json("data/analysis/patch_impact.json")


def test_patch_impact_rows_are_consistent(impact):
    assert impact["patches"], "no patch with notes was measured"
    for p in impact["patches"]:
        assert p["control"]["n"] >= 20
        for c in p["champions"]:
            assert c["verdict"] in ("worked", "opposite", "noise", "moved")
            assert c["ci"][0] <= c["effect"] <= c["ci"][1]
            assert abs(c["effect"] - (c["delta"] - p["control"]["mean"])) < 2e-4
            if c["verdict"] == "noise":
                assert abs(c["z"]) < 1.96
            if c["verdict"] == "worked":
                assert (c["effect"] > 0) == (c["dose"]["intent"] == "buff")


def test_dose_response_has_intervals(impact):
    d = impact["dose_response"]
    assert d["n"] >= 10
    for k, v in d["coefficients"].items():
        assert v["ci"][0] <= v["pts_per_5pct"] <= v["ci"][1], k
    # The best-measured lever: a damage-dealt modifier raises the win rate.
    assert d["coefficients"]["damage_dealt"]["ci"][0] > 0


def test_meta_settling_shape():
    s = load_json("data/analysis/meta_settling.json")
    for p in s["patches"]:
        assert len(p["spearman"]) == p["days"] == len(p["mad_pts"])
        assert all(-1 <= v <= 1 for v in p["spearman"])
        assert p["spearman"][-1] == pytest.approx(1) and p["mad_pts"][-1] == 0
    assert s["typical"]["spearman"], "typical curve missing"
    for sh in s["shifts"]:
        assert abs(sh["shift"]) >= s["shift_rule"]["min_pts"]
        assert abs(sh["z"]) >= s["shift_rule"]["min_z"]
        assert sh["patch"] in {p["patch"] for p in s["patches"]}
    for e in s["events"]:
        assert len(e["champions"]) >= 3


def test_playstyle_clusters_cover_every_champion_once():
    c = load_json("data/analysis/playstyle_clusters.json")
    assert 4 <= c["k"] <= 9
    assert -1 <= c["silhouette"] <= 1
    members = [a for cl in c["clusters"] for a in cl["champions"]]
    assert len(members) == len(set(members)) == len(c["champions"]) >= 150
    for ch in c["champions"]:
        assert 0 <= ch["cluster"] < c["k"]
        assert ch["alias"] in c["clusters"][ch["cluster"]]["champions"]
    for cl in c["clusters"]:
        assert cl["label"] and cl["size"] == len(cl["champions"])


def test_patch_forecast_reports_baselines_and_ranges():
    f = load_json("data/analysis/patch_forecast.json")
    m = f["model"]
    assert m["n"] >= 15
    assert m["cv_mae_pts"] > 0 and m["baseline_no_change_mae_pts"] > 0
    if f["pbe"]:
        for e in f["pbe"]["entries"]:
            assert e["range_pts"][0] <= e["predicted_pts"] <= e["range_pts"][1]
            assert e["parsed"] >= 1
