"""Is dying a lot a sign to build defensively? Counts from the owner's private Mayhem archive, nothing per game kept.

Dying often can mean two things: getting caught (build defense) or trading your life for kills on purpose
(keep building damage). This splits every player row of every game (all ten players, no names) by deaths per
10 minutes and by kill participation, and reports how often each kind of player's team won, plus how much
damage they took per death and how much of their team's deaths they account for.

    python3 data/analysis/death_signals.py <archive.json> [--json out.json]

The archive is the My Stats helper's backup (mayhem_import.py -o). It stays on that computer; the output is
counts and rates only. Remakes (under 5 minutes) are left out.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict

REMAKE_SECONDS = 300
DEATH_BINS = [(0, 1.5, "under 1.5"), (1.5, 2.5, "1.5-2.5"), (2.5, 3.5, "2.5-3.5"), (3.5, 99, "3.5+")]
KP_BINS = [(0, 0.5, "under 50%"), (0.5, 0.65, "50-65%"), (0.65, 0.8, "65-80%"), (0.8, 9, "80%+")]


def binned(value, bins):
    return next(label for lo, hi, label in bins if lo <= value < hi)


def rows(games):
    """One row per player per game: deaths per 10 min, kill participation, share of team deaths, won."""
    for g in games:
        dur = g.get("gameDuration") or 0
        if dur > 10_000:  # milliseconds in some exports
            dur /= 1000
        if dur < REMAKE_SECONDS:
            continue
        team_kills, team_deaths = defaultdict(int), defaultdict(int)
        for p in g.get("participants") or []:
            team_kills[p["teamId"]] += p["stats"].get("kills", 0)
            team_deaths[p["teamId"]] += p["stats"].get("deaths", 0)
        for p in g.get("participants") or []:
            s, team = p["stats"], p["teamId"]
            kp = (s.get("kills", 0) + s.get("assists", 0)) / team_kills[team] if team_kills[team] else 0
            yield {
                "deaths10": s.get("deaths", 0) / (dur / 600),
                "kp": kp,
                "death_share": s.get("deaths", 0) / team_deaths[team] if team_deaths[team] else 0,
                "taken_per_death": s.get("totalDamageTaken", 0) / max(1, s.get("deaths", 0)),
                "kda": (s.get("kills", 0) + s.get("assists", 0)) / max(1, s.get("deaths", 0)),
                "win": bool(s.get("win")),
            }


def summarize(group):
    n = len(group)
    if not n:
        return {"n": 0}
    return {"n": n, "win_rate": round(sum(r["win"] for r in group) / n, 3),
            "taken_per_death": round(sum(r["taken_per_death"] for r in group) / n),
            "death_share": round(sum(r["death_share"] for r in group) / n, 3)}


def report(all_rows):
    by_deaths = defaultdict(list)
    grid = defaultdict(list)
    for r in all_rows:
        d, k = binned(r["deaths10"], DEATH_BINS), binned(r["kp"], KP_BINS)
        by_deaths[d].append(r)
        grid[(d, k)].append(r)
    return {
        "players": len(all_rows),
        "by_deaths_per_10min": {d: summarize(by_deaths[d]) for _, _, d in DEATH_BINS},
        "by_deaths_and_kill_participation": {
            d: {k: summarize(grid[(d, k)]) for _, _, k in KP_BINS} for _, _, d in DEATH_BINS},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--json")
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    out = report(list(rows(games)))
    out["games"] = len(games)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
    print(f"{out['games']} games, {out['players']} player rows (remakes left out)")
    print("\nWin rate by deaths per 10 min x kill participation (n in brackets):")
    print(f"{'deaths/10m':>11} | " + " | ".join(f"{k:>15}" for _, _, k in KP_BINS))
    for _, _, d in DEATH_BINS:
        cells = []
        for _, _, k in KP_BINS:
            c = out["by_deaths_and_kill_participation"][d][k]
            cells.append(f"{c['win_rate']:.0%} ({c['n']})".rjust(15) if c["n"] else "-".rjust(15))
        print(f"{d:>11} | " + " | ".join(cells))
    print("\nBy deaths per 10 min:")
    for d, c in out["by_deaths_per_10min"].items():
        if c["n"]:
            print(f"  {d:>9}: win {c['win_rate']:.0%}, n {c['n']}, damage taken per death {c['taken_per_death']},"
                  f" share of team deaths {c['death_share']:.0%}")


if __name__ == "__main__":
    sys.exit(main())
