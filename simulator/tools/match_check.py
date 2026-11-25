#!/usr/bin/env python3
"""Replays logged Mayhem games as simulated five-against-five fights and scores how well the
simulator's damage shares match the real ones.

Each game (10 minutes or longer) runs once in team mode (mayhem_sim --allies/--team) with every
player's real items and augments. For every player it compares the simulator's share of its
team's damage with the real share of its team's damage to champions.

    python3 simulator/tools/match_check.py ARCHIVE_DIR [--trials 60] [--out summary.json]
        [--set key=value ...]

ARCHIVE_DIR holds League client end-of-game records (*.json or *.json.gz, one game each, with
participants[].championId/teamId/stats). Those are private match histories, so this tool only
prints and writes AGGREGATES: overall scores and per-champion average gaps (champions with 12+
games). It never writes a game, a player or a build. --set passes rule changes to the simulator
(e.g. --set enemy_spread=500) to test a change before making it.

Scores: per-player Spearman rank correlation and mean absolute error (points of team share; 20
for everyone scores about 5.7 on real games), then the same on champion averages.
"""
import argparse
import concurrent.futures as cf
import glob
import gzip
import json
import math
import os
import statistics as st
import subprocess
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from real_builds import load  # noqa: E402


def spearman(a, b):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0] * len(v)
        for k, i in enumerate(order):
            r[i] = k
        return r
    a, b = rank(a), rank(b)
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("archive")
    ap.add_argument("--trials", default="60")
    ap.add_argument("--out")
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--sim", default=os.path.join(SIM, "mayhem_sim"))
    args = ap.parse_args()

    by_id, aug_by_id = load()
    champs = {c["champion_id"]: c["id"] for c in json.load(open(os.path.join(SIM, "data", "champions.json")))["champions"]}
    extra = [x for s in args.set for x in ("--set", s)]

    def spec(p):
        s = p["stats"]
        items = [by_id[s[f"item{i}"]] for i in range(6) if s.get(f"item{i}") in by_id]
        augs = [aug_by_id[s[f"playerAugment{i}"]] for i in range(1, 7) if s.get(f"playerAugment{i}") in aug_by_id]
        return champs.get(p["championId"]), items, augs

    def fmt(c, items, augs):
        return c + (":items=" + "+".join(items) if items else "") + (":augs=" + "+".join(augs) if augs else "")

    def run(path):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            g = json.load(f)
        if g.get("gameDuration", 0) < 600:
            return None
        teams = defaultdict(list)
        for p in g.get("participants", []):
            teams[p["teamId"]].append(p)
        if len(teams) != 2 or any(len(v) != 5 for v in teams.values()):
            return None
        a, b = list(teams.values())
        sa, sb = [spec(p) for p in a], [spec(p) for p in b]
        if any(c is None for c, _, _ in sa + sb):
            return None
        me = sa[0]
        cmd = [args.sim, "--champ", me[0], "--json", "--trials", args.trials, "--threads", "1", "--seed", "7",
               "--allies", ",".join(fmt(*x) for x in sa[1:]), "--team", ",".join(fmt(*x) for x in sb)] + extra
        if me[1]:
            cmd += ["--items", ",".join(me[1])]
        if me[2]:
            cmd += ["--augs", ",".join(me[2])]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
        try:
            d = json.loads(r.stdout)
        except ValueError:
            return "error"
        rows = []
        for real, simmed, specs in ((a, d["members"], sa), (b, d["enemies"], sb)):
            total = sum(p["stats"]["totalDamageDealtToChampions"] for p in real) or 1
            for p, m, (c, _, _) in zip(real, simmed, specs):
                rows.append((c, p["stats"]["totalDamageDealtToChampions"] / total, m["share"]))
        return rows

    files = sorted(glob.glob(os.path.join(args.archive, "*.json.gz")) + glob.glob(os.path.join(args.archive, "*.json")))
    with cf.ThreadPoolExecutor(os.cpu_count()) as ex:
        results = [r for r in ex.map(run, files) if r]
    errors = sum(1 for r in results if r == "error")
    rows = [x for r in results if r != "error" for x in r]
    if not rows:
        sys.exit("no games could be replayed")
    real = [r for _, r, _ in rows]
    simmed = [s for _, _, s in rows]
    by = defaultdict(list)
    for c, r, s in rows:
        by[c].append((r, s))
    champ = {c: (st.mean(s for _, s in v), st.mean(r for r, _ in v), len(v)) for c, v in by.items() if len(v) >= 12}
    summary = {
        "games": len(results) - errors, "errors": errors, "players": len(rows), "trials": int(args.trials), "set": args.set,
        "spearman": round(spearman(simmed, real), 3),
        "mae_points": round(100 * st.mean(abs(s - r) for r, s in zip(real, simmed)), 2),
        "mae_points_everyone_20": round(100 * st.mean(abs(0.2 - r) for r in real), 2),
        "champion_spearman": round(spearman([v[0] for v in champ.values()], [v[1] for v in champ.values()]), 3),
        "champion_mae_points": round(100 * st.mean(abs(v[0] - v[1]) for v in champ.values()), 2),
        # Simulated minus real share of team damage, in points: + means the simulator gives the champion too much.
        "champion_gaps": dict(sorted(((c, {"gap_points": round(100 * (v[0] - v[1]), 1), "players": v[2]}) for c, v in champ.items()),
                                     key=lambda kv: -abs(kv[1]["gap_points"]))),
    }
    print(json.dumps({k: v for k, v in summary.items() if k != "champion_gaps"}))
    for c, g in list(summary["champion_gaps"].items())[:15]:
        print(f"  {c:14s} {g['gap_points']:+5.1f} points ({g['players']} players)")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()
