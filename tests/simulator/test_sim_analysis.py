"""The Simulator's analysis reports: tuning-sensitivity curves (simulator/tools/sensitivity.py) and the validation
report (simulator/tools/validation.py), which the Simulator page's Tuning and Accuracy tabs read from
simulator/analysis/."""
from __future__ import annotations

import importlib.util
import math
import sys

import pytest

from sim_paths import SIM_DIR, load_json

ANALYSIS = SIM_DIR / "analysis"
sys.path.insert(0, str(SIM_DIR / "tools"))


def _module(name):
    spec = importlib.util.spec_from_file_location(name, SIM_DIR / "tools" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_spearman_handles_ties_and_order():
    rb = _module("real_builds")
    assert rb.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1)
    assert rb.spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1)
    assert rb.rank([5, 1, 5, 2]) == [2.5, 0, 2.5, 1]


def test_elasticity_fit_recovers_a_power_law(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["sensitivity.py", "sim", "out.json"])
    sens = _module("sensitivity")
    for e in (0.0, 0.5, 1.0, -1.3):
        pts = [(s, 1000 * (1 + s) ** e) for s in sens.STEPS]
        slope, curv = sens.fit(pts)
        assert slope == pytest.approx(e, abs=1e-9)
        assert curv == pytest.approx((1.1 ** e - 2 + 0.9 ** e), abs=1e-9)


def test_validation_role_model_on_synthetic_data():
    """Share = role level x DPS^0.3: the leave-one-out model finds the slope and calibrates."""
    val = _module("validation")
    rows = []
    for i in range(60):
        role = ["mage", "tank", "marksman"][i % 3]
        dps = 400 + 37 * i
        share = {"mage": 0.02, "tank": 0.012, "marksman": 0.025}[role] * dps ** 0.3
        rows.append({"champ": f"C{i}", "role": role, "cn": share, "dps": dps, "taken": 1000 + i, "tank": 0.2})
    rep = val.report(rows)
    assert rep["role_adjusted"]["dps_coefficient"] == pytest.approx(0.3, abs=1e-6)
    assert rep["role_adjusted"]["r2_log"] == pytest.approx(1, abs=1e-6)
    assert rep["role_adjusted"]["calibration_slope"] == pytest.approx(1, abs=1e-3)
    lo, hi = rep["dps_vs_damage_share"]["ci95"]
    assert lo <= rep["dps_vs_damage_share"]["rho"] <= hi


@pytest.mark.skipif(not (ANALYSIS / "tuning-sensitivity.json").exists(), reason="not generated")
def test_tuning_sensitivity_file():
    t = load_json(ANALYSIS / "tuning-sensitivity.json")
    assert t["steps"] == [-10, -5, 0, 5, 10]
    assert t["patch"] == (SIM_DIR / "data" / "tuned_patch.txt").read_text().strip()
    assert len(t["champions"]) > 150
    for c in t["champions"]:
        assert set(c["levers"]) == set(t["levers"]), c["champion"]
        for lever, metrics in c["levers"].items():
            for m, v in metrics.items():
                assert len(v["curve"]) == 5 and v["curve"][2] == 0, (c["champion"], lever, m)
                assert math.isfinite(v["e"])
    # Sanity of the model: more damage dealt never lowers the median champion's damage per fight, more damage
    # taken never raises it.
    med = lambda lv: sorted(c["levers"][lv]["per_fight"]["e"] for c in t["champions"])[len(t["champions"]) // 2]
    assert med("damage_dealt") > 0.5
    assert med("damage_taken") < 0
    assert t["items"] and all(i["champions"] for i in t["items"])


@pytest.mark.skipif(not (ANALYSIS / "validation.json").exists(), reason="not generated")
def test_validation_file():
    v = load_json(ANALYSIS / "validation.json")
    assert v["n"] > 150
    for corr in (v["dps_vs_damage_share"], v["taken_vs_tank_share"], v["role_adjusted"]["spearman"]):
        lo, hi = corr["ci95"]
        assert -1 <= lo <= corr["rho"] <= hi <= 1
    assert len(v["role_adjusted"]["bins"]) == 5
    assert {r["role"] for r in v["roles"]} >= {"mage", "tank", "marksman"}
    dates = [p["date"] for p in v["history"]]
    assert dates == sorted(dates)
    # Page text rule: nothing in what the page shows names where real numbers come from.
    text = (ANALYSIS / "validation.json").read_text().lower()
    for word in ("cn", "tencent", "riot api", "qq"):
        assert f'"{word}' not in text and f" {word} " not in text
