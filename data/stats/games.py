#!/usr/bin/env python3
"""Estimated matches behind every patch's stats, for confidence intervals (data/stats/games.json).

The feed has win rates and pick rates but no game counts. Pick rate is a champion's share of matches
(pick rates sum to 10), so only the number of matches is missing. data/fill/model.py reads it from how
much each champion's daily win rate jitters: binomial noise shrinks with games, real drift grows with the
gap between days, and fitting both across ~170 champions separates them (estimate_daily_games). Any noise
beyond pure binomial noise lands in the estimate too, so it's an *effective* sample size, which is what
an interval should use.

This runs that estimator on every patch window (data/fill only needs the live patch). A patch with fewer
than 10 days, high drift or a fit far from the norm, and the live patch while it fills, uses the typical rate (median of the
recent stable patches, model.typical_daily_games), so the live patch matches data/fill/spells_games.json.

Writes {"median_per_day", "patches": {patch: {days, per_day, matches, estimated}}}. A champion's games are
pick_rate x matches; an item's or a teammate pair's are its share x the champion's games.
Standard library only.

Usage: python3 data/stats/games.py [--verbose] [--check]
"""

import argparse
import datetime as dt
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "fill"))
import model  # noqa: E402  (data/fill/model.py)

OUT = os.path.join(HERE, "games.json")
MIN_DAYS = 10
MAX_DRIFT = 0.0015  # same bar as model.typical_daily_games
BAND = 1.8  # a fit further than this factor from the typical rate (rounding swamping the noise) isn't trusted


def estimate(verbose=False):
    by = model.history_days()
    dates = sorted(by)
    rows = model.patches()
    typical, _ = model.typical_daily_games()
    out = {}
    for i, p in enumerate(rows):
        win = [d for d in dates if p["window_start"] <= d <= p["last_day"]]
        n, drift = model.estimate_daily_games([by[d] for d in win]) if len(win) >= 3 else (None, None)
        own = (
            i < len(rows) - 1
            and len(win) >= MIN_DAYS
            and n
            and drift is not None
            and drift < MAX_DRIFT
            and typical / BAND <= n <= typical * BAND
        )
        per_day = n if own else typical
        days = int(p["days"])
        out[p["patch"]] = {"days": days, "per_day": round(per_day), "matches": round(per_day * days), "estimated": bool(own)}
        if verbose:
            got = f"{n / 1e6:5.2f}M/day, drift {drift:.4f}" if n else "no fit"
            print(f"{p['patch']:>6}  {got:<26} -> {'own' if own else 'typical'}")
    return round(typical), out


def simulate(per_day, days=10, drift=0.0, seed=1):
    """A made-up patch window in model.estimate_daily_games' input format ([{champion: (win rate, pick
    rate)}] per day, cumulative, rounded like the feed), with a known number of matches per day and the
    latest day's real pick rates."""
    rnd = random.Random(seed)
    by = model.history_days()
    champs = [(c, w, p) for c, (w, p) in by[max(by)].items()]
    state = {c: [0, 0, w] for c, w, _ in champs}
    window = []
    for t in range(1, days + 1):
        day = {}
        for c, _, p in champs:
            s = state[c]
            s[2] = min(0.9, max(0.1, s[2] + rnd.gauss(0, drift)))
            g = max(1, round(rnd.gauss(per_day * p, (per_day * p) ** 0.5)))
            # Normal approximation to the binomial (exact draws would be slow at millions of games).
            s[1] += round(min(g, max(0, rnd.gauss(g * s[2], (g * s[2] * (1 - s[2])) ** 0.5))))
            s[0] += g
            day[c] = (round(s[1] / s[0], 4), round(s[0] / (per_day * t), 4))
        window.append(day)
    return window


def check():
    print("Simulated patches (known matches per day -> estimate):")
    for per_day in (1e6, 3.5e6, 8e6):
        for drift in (0.0, 0.0005):
            got = [model.estimate_daily_games(simulate(per_day, drift=drift, seed=s))[0] for s in range(3)]
            print(f"  {per_day / 1e6:4.1f}M/day, drift {drift:.4f}: " + ", ".join(f"{g / 1e6:.2f}M" for g in got))


def games_for(patch, pick_rate, data=None):
    """A champion's estimated games in a patch from its pick rate."""
    if data is None:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
    p = data["patches"].get(patch)
    return pick_rate * (p["matches"] if p else data["median_per_day"] * 14)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--check", action="store_true", help="test the estimator on simulated patches and exit")
    args = ap.parse_args()
    if args.check:
        return check()
    typical, patches = estimate(args.verbose)
    data = {
        "about": "Effective matches behind each patch's stats (data/stats/games.py). A champion's games = pick_rate x "
        "matches; an item's or a teammate pair's = its share x the champion's games.",
        "updated": dt.date.today().isoformat(),
        "median_per_day": typical,
        "patches": patches,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
        f.write("\n")
    print(f"games.json: typical {typical / 1e6:.2f}M matches/day, {sum(p['estimated'] for p in patches.values())} of {len(patches)} patches estimated")


if __name__ == "__main__":
    main()
