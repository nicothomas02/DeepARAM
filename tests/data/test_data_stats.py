"""Confidence intervals and estimated game counts: data/stats/ (intervals.py, games.py, games.json)."""
import math

import pytest

from deeparam_data_helpers import load_json, load_module

iv = load_module("data/stats/intervals.py", "stats_intervals", extra_path=["data/stats"])
games = load_module("data/stats/games.py", "stats_games", extra_path=["data/stats"])


def test_wilson_matches_textbook_values():
    # Newcombe (1998) table I: 81/263 -> 0.2553 to 0.3662, 15/148 -> 0.0624 to 0.1605.
    lo, hi = iv.wilson_counts(81, 263)
    assert (round(lo, 4), round(hi, 4)) == (0.2553, 0.3662)
    lo, hi = iv.wilson_counts(15, 148)
    assert (round(lo, 4), round(hi, 4)) == (0.0624, 0.1605)


def test_wilson_stays_inside_zero_and_one():
    assert iv.wilson(1.0, 5)[1] == 1.0 and iv.wilson(1.0, 5)[0] > 0.5
    assert iv.wilson(0.0, 5)[0] == 0.0
    assert iv.wilson(0.5, 0) == (0.0, 1.0)


def test_interval_narrows_with_games():
    widths = [iv.half_width(0.52, n) for n in (10, 100, 1000, 100000)]
    assert widths == sorted(widths, reverse=True)
    assert iv.half_width(0.5, 100000) < 0.004


def test_diff_interval_newcombe():
    # Newcombe (1998) table II example: 56/70 vs 48/80 -> 0.0524 to 0.3339.
    lo, hi = iv.diff_interval(56 / 70, 70, 48 / 80, 80)
    assert (round(lo, 4), round(hi, 4)) == (0.0524, 0.3339)
    # Against a fixed baseline the interval is just the Wilson interval shifted.
    lo, hi = iv.diff_interval(0.56, 1000, 0.5, math.inf)
    w = iv.wilson(0.56, 1000)
    assert lo == pytest.approx(w[0] - 0.5) and hi == pytest.approx(w[1] - 0.5)


def test_sample_levels():
    assert iv.sample_level(0) == "none"
    assert iv.sample_level(iv.MIN_GAMES - 1) == "none"
    assert iv.sample_level(100) == "low"
    assert iv.sample_level(iv.games_needed() + 10) == "ok"
    assert 350 < iv.games_needed() < 420


def test_games_estimator_recovers_simulated_totals():
    # A made-up patch with a known number of matches a day, real pick rates and the feed's rounding.
    for per_day in (1e6, 4e6):
        est, _ = games.model.estimate_daily_games(games.simulate(per_day, days=10, drift=0.0003, seed=7))
        assert est == pytest.approx(per_day, rel=0.2)


def test_games_json_covers_every_patch():
    data = load_json("data/stats/games.json")
    patches = [p["patch"] for p in load_json_csv("data/cn/history/patches.csv")]
    assert set(patches) <= set(data["patches"])
    assert 5e5 < data["median_per_day"] < 2e7
    for p, v in data["patches"].items():
        assert v["matches"] == pytest.approx(v["per_day"] * v["days"], rel=1e-6, abs=1), p
    assert sum(v["estimated"] for v in data["patches"].values()) >= 5
    # The live patch uses the typical rate, the same one the Tier List's game counts use (data/fill).
    fill = load_json("data/fill/spells_games.json")
    live = data["patches"][patches[-1]]
    if fill.get("patch") == patches[-1] and not live["estimated"]:
        assert live["per_day"] == pytest.approx(fill["daily_games"], rel=0.02)
    assert games.games_for("16.21", 0.05, data) == pytest.approx(0.05 * data["patches"]["16.21"]["matches"])


def load_json_csv(path):
    import csv

    from deeparam_data_helpers import repo

    with open(repo(path), encoding="utf-8") as f:
        return list(csv.DictReader(f))
