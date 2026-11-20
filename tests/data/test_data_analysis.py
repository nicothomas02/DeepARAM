"""Analyses in data/analysis/ (common.py and the four JSON outputs read by the site)."""
import json
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


def test_forecast_scorecard_measures_like_patch_impact(monkeypatch, tmp_path):
    """A saved forecast for a past patch is scored against the same difference in differences as patch_impact."""
    sc = load_module("data/analysis/forecast_scorecard.py", "analysis_forecast_scorecard", extra_path=["data/analysis"])
    monkeypatch.setattr(sc, "c", common)
    impact = load_json("data/analysis/patch_impact.json")
    past = max(impact["patches"], key=lambda p: len(p["champions"]))
    entries = [
        {"name": r["name"], "alias": r["alias"], "display": r["name"], "tag": r["dose"]["intent"], "predicted_pts": round(50 * r["effect"], 2), "range_pts": [0, 0]}
        for r in past["champions"]
    ]
    (tmp_path / f"{past['patch']}.json").write_text(json.dumps({"taken": "t", "patch": past["patch"], "model": {"cv_rmse_pts": 1.9}, "entries": entries}))
    monkeypatch.setattr(sc, "SNAPSHOTS", tmp_path)
    out = sc.build()
    scored = out["patches"][0]
    assert scored["patch"] == past["patch"] and scored["final"]
    measured = {r["alias"]: r["measured_pts"] for r in scored["champions"]}
    for r in past["champions"]:
        assert abs(measured[r["alias"]] - 100 * r["effect"]) < 0.01
    s = scored["summary"]
    # half of every true effect: the miss is exactly half the no-change miss and every direction is right
    assert abs(s["mae_pts"] - s["no_change_mae_pts"] / 2) < 0.02 and s["beat_no_change"]
    assert s["direction"]["right"] == s["direction"]["of"]
    assert 0 <= s["in50"] <= s["in95"] <= 1
    assert out["pooled"]["n"] == s["n"]


def test_forecast_scorecard_snapshot_freezes_once_live(monkeypatch, tmp_path):
    sc = load_module("data/analysis/forecast_scorecard.py", "analysis_forecast_scorecard", extra_path=["data/analysis"])
    monkeypatch.setattr(sc, "c", common)
    monkeypatch.setattr(sc, "SNAPSHOTS", tmp_path / "snaps")
    monkeypatch.setattr(common, "OUT", tmp_path)
    fc = {"model": {"n": 60, "cv_mae_pts": 1.6, "cv_rmse_pts": 1.9, "baseline_no_change_mae_pts": 1.9}, "pbe": {"build": "99.1.1", "live": "99.0.1", "entries": [{"name": "Annie", "alias": "Annie", "display": "Annie", "tag": "buff", "predicted_pts": 2.0, "range_pts": [-1.7, 5.7]}]}}
    save = lambda: (tmp_path / "patch_forecast.json").write_text(json.dumps(fc))
    save()
    assert sc.patch_of("16.23.8384656") == "16.23"
    assert sc.snapshot() == "99.1"
    assert sc.snapshot() is None  # unchanged forecast: the file is left alone
    fc["pbe"]["entries"][0]["predicted_pts"] = 3.0
    save()
    assert sc.snapshot() == "99.1"  # still on the test server: the forecast follows the changes
    fc["pbe"]["entries"][0]["predicted_pts"] = 4.0
    fc["pbe"]["live"] = "99.1.2"  # the patch went live: its forecast stays as it was
    save()
    assert sc.snapshot() is None
    assert json.loads((tmp_path / "snaps" / "99.1.json").read_text())["entries"][0]["predicted_pts"] == 3.0


def test_forecast_scorecard_output():
    s = load_json("data/analysis/forecast_scorecard.json")
    assert s["min_days"] >= 7
    for p in s["patches"]:
        assert p["days"] >= s["min_days"] and p["summary"]["n"] == len(p["champions"]) > 0
        for r in p["champions"]:
            assert abs(r["miss_pts"] - abs(r["measured_pts"] - r["predicted_pts"])) < 0.02
    for w in s["waiting"]:
        assert 0 <= w["day"] < w["of"] and w["champions"] > 0


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
    assert "archive" not in lift  # the owner's own stats stay out of the public repo


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
    try:
        data = load_json("data/analysis/game_length.json")  # private output, not in the repo
    except FileNotFoundError:
        return
    s = data["curves"]["all"]["survival"]
    assert s[0] == 1.0 and all(a >= b for a, b in zip(s, s[1:]))
    assert 10 < data["curves"]["all"]["median"] < 30
    for k in ("win_vs_loss", "blue_vs_red"):
        assert 0 <= data["compare"][k]["p"] <= 1


# ---------- predictive.py: fitted DeepScore settings ----------

predictive = load_module("data/analysis/predictive.py", "analysis_predictive", extra_path=["data/analysis"])


def test_predictive_fit_recovers_carry_over():
    """On synthetic lists where next = mean + 0.6 * (this - mean), the grid fit finds b = 0.6 and k = 0."""
    cases = []
    for t in range(6):
        case = []
        for i in range(40):
            x = 0.45 + i * 0.0025 + 0.001 * t
            case.append({"x": x, "n": 0.5 + (i % 5) / 2, "y": 0.0})
        m = sum(e["x"] for e in case) / len(case)
        for e in case:
            e["y"] = m + 0.6 * (e["x"] - m)
        cases.append(case)
    b, k = predictive.fit_bk(cases)
    assert (b, k) == (0.6, 0.0)
    spread = predictive.fit_spread(cases, b, k)
    assert spread["s0"] < 1e-6


def test_predictive_helpers():
    assert predictive.spearman([1, 2, 3], [10, 20, 30]) == pytest.approx(1.0)
    assert predictive.spearman([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    assert predictive.quantile([0, 1, 2, 3, 4], 0.5) == 2
    t = predictive.tiers([0.4 + i * 0.001 for i in range(100)])
    assert t[0] == "D" and t[-1] == "S"
    # tier cuts match the site's
    assert [z for _, z in predictive.TIER_Z][:4] == [1.35, 0.6, -0.4, -1.2]


def test_predictive_outputs_match_and_beat_the_old_rule():
    """The checked-in outputs: the site's settings file mirrors predictive.json, and the fitted settings
    predicted next patch at least as well as the old hand-set prior in the backtest."""
    full = load_json("data/analysis/predictive.json")
    site = load_json("web/src/data/deepscore-fit.json")
    for fam in ("champions", "augments", "items"):
        if full.get(fam):
            for key in ("b", "k", "s0", "s1", "q80", "q95"):
                assert site[fam][key] == full[fam]["fit"][key], (fam, key)
            models = full[fam]["backtest"]["models"]
            assert models["fitted"]["rmse_pts"] <= models["current"]["rmse_pts"], fam
    champ = full["champions"]
    cov = champ["backtest"]["models"]["fitted"]["coverage"]
    assert 0.7 <= cov["80"] <= 0.95 and cov["95"] >= 0.85
    for p in champ["projection"]["champions"].values():
        assert p["lo95"] <= p["lo80"] <= p["wr"] <= p["hi80"] <= p["hi95"]
