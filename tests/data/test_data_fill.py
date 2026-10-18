"""Estimated spells and game counts: data/fill/ (model.py, spell_model.json, spells_games.json)."""
import math
import random

import pytest

from deeparam_data_helpers import load_json, load_module

m = load_module("data/fill/model.py", "fill_model")


def simulate(per_day, days, seed):
    """Cumulative daily (win rate, pick rate) rounded to 4 decimals, like the feed."""
    rnd = random.Random(seed)
    base = {str(i): (0.45 + 0.1 * rnd.random(), 0.02 + 0.08 * rnd.random()) for i in range(170)}
    cum = {c: [0.0, 0.0] for c in base}
    total, out = 0.0, []
    for _ in range(days):
        n = per_day * math.exp(rnd.gauss(0, 0.15))
        total += n
        for c, (w, p) in base.items():
            g = n * p
            cum[c][0] += g
            cum[c][1] += rnd.gauss(g * w, math.sqrt(g * w * (1 - w)))
        out.append({c: (round(v[1] / v[0], 4), round(v[0] / total, 4)) for c, v in cum.items()})
    return out


@pytest.mark.parametrize("per_day", [1e6, 3e6])
def test_daily_games_recovered_from_noise(per_day):
    est = sorted(m.estimate_daily_games(simulate(per_day, 12, s))[0] for s in range(3))
    assert 0.75 * per_day < est[1] < 1.3 * per_day


def test_rift_shares_drop_flash_smite_teleport():
    shares = m.rift_shares(["14_4_50_60#3_4_50_30#12_4_50_10", "11_4_50_100"])
    assert set(shares) == {14, 3}
    assert shares[14] == pytest.approx(60 / 90)


def test_round_sig():
    assert m.round_sig(2_271_234) == 2_270_000
    assert m.round_sig(0) == 0


def test_spell_model_matches_features():
    model = load_json("data/fill/spell_model.json")
    assert model["spells"] == m.SPELLS
    rows = m.features(["Marksman"], m.numeric(None, {"attackrange": 550}), {6: 0.5, 3: 0.2})
    assert len(model["coef"]) == len(rows[0])
    probs = m.predict(model, rows)
    assert sum(probs) == pytest.approx(1)
    assert model["cv_log_loss"] < model["baseline_log_loss"]


def test_estimates_file_shape():
    d = load_json("data/fill/spells_games.json")
    assert d["estimated"] is True and d["total_games"] > 0
    for c in d["champions"].values():
        assert c["games"] > 0
        for s in c["spells"]:
            assert m.FLASH in s["ids"] and len(s["ids"]) == 2 and m.EXHAUST not in s["ids"]
            assert s["win_rate"] is None
        assert sum(s["pick_rate"] for s in c["spells"]) <= 1.0001
