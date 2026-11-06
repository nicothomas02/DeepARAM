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


def test_item_lift_adjusts_against_finished_builds():
    lift = load_json("data/analysis/item_lift.json")
    assert lift["premium"]["champions"] >= 100
    assert 0 <= lift["premium"]["share_positive"] <= 1
    ranked = {i: v for i, v in lift["items"].items() if "rank_raw" in v}
    assert len(ranked) == lift["ranked"] >= 60
    assert sorted(v["rank_raw"] for v in ranked.values()) == list(range(1, len(ranked) + 1))
    assert sorted(v["rank_adjusted"] for v in ranked.values()) == list(range(1, len(ranked) + 1))
    for v in lift["items"].values():
        # adjusted = raw - premium, up to rounding
        assert abs(v["adjusted"] - (v["raw"] - v["premium"])) < 0.001
        assert -0.5 < v["raw"] < 0.5 and v["weight"] > 0
    assert lift["moved_ten"] == sum(1 for v in ranked.values() if abs(v["rank_raw"] - v["rank_adjusted"]) >= 10)
    if lift["archive"]:
        assert sum(r["games"] for r in lift["archive"]["rows"]) == lift["archive"]["games"]
        for r in lift["archive"]["rows"]:
            assert r["ci"][0] <= r["win_rate"] <= r["ci"][1]


def test_owner_archive_keeps_counts_only(monkeypatch):
    archive = load_module("data/analysis/owner_archive.py", "analysis_owner_archive", extra_path=["data/analysis"])
    monkeypatch.setattr(archive, "c", common)  # other test modules load their own `common`
    rows = [
        {"dur": 1200, "team": 100, "win": 1, "i0": 3089, "i1": 1001, "i2": 0, "i3": 0, "i4": 0, "i5": 0, "k": 9},
        {"dur": 120, "team": 200, "win": 0, "i0": 0, "i1": 0, "i2": 0, "i3": 0, "i4": 0, "i5": 0},
        {"dur": 1500, "team": 200, "win": 0, "i0": 3089, "i1": 4645, "i2": 3157, "i3": 3135, "i4": 3020, "i5": 3118},
    ]
    agg = archive.aggregate(rows)
    assert agg["games"] == 3 and agg["remakes_excluded"] == 1
    assert agg["ended_in_minute"]["all"] == {"20": 1, "25": 1}
    assert agg["ended_in_minute"]["win"] == {"20": 1} and agg["ended_in_minute"]["red"] == {"25": 1}
    assert agg["by_completed_legendary"]["1"] == {"games": 1, "wins": 1}
    assert agg["by_completed_legendary"]["5"] == {"games": 1, "wins": 0}
    assert agg["by_completed_legendary"]["0"] == {"games": 1, "wins": 0}
    text = str(agg)
    for key in ("k", "puuid", "champ", "3089"):
        assert key not in agg and f"'{key}'" not in text


def test_game_length_survival_is_monotone_and_tested():
    gl = load_module("data/analysis/game_length.py", "analysis_game_length", extra_path=["data/analysis"])
    c = gl.curve([0, 0, 2, 3, 5])
    assert c["games"] == 10 and c["survival"] == [1.0, 1.0, 1.0, 0.8, 0.5] and c["hazard"][4] == 1.0
    assert c["median"] == 4.0 and c["quartiles"][0] == 3.17  # 2.5 games in: a sixth of the way through minute 3
    same = gl.log_rank([0, 5, 5, 5], [0, 5, 5, 5])
    assert same["z"] == 0 and same["p"] == 1
    longer = gl.log_rank([0, 0, 0, 20], [0, 20, 0, 0])
    assert longer["z"] > 2 and longer["p"] < 0.05
    data = load_json("data/analysis/game_length.json")
    s = data["curves"]["all"]["survival"]
    assert s[0] == 1.0 and all(a >= b for a, b in zip(s, s[1:]))
    assert 10 < data["curves"]["all"]["median"] < 30
    for k in ("win_vs_loss", "blue_vs_red"):
        assert 0 <= data["compare"][k]["p"] <= 1
