#!/usr/bin/env python3
"""Simulated early / mid / late power curve per champion (power_curve.json).

Runs the all-champion Simulator (simulator/mayhem_sim, built with `make -C simulator mayhem_sim`) on
each champion's best build at three points of a game, each against a level-matched training dummy:
  early  level 8,  first 2 items, 1 augment
  mid    level 13, first 4 items, 2 augments
  late   level 18, full build,    4 augments
Each point's damage per second is turned into a percentile among all champions. `scaling` is
log(late DPS / early DPS) as a z-score: above 0 grows into the late game, below 0 peaks early.

Real games can't confirm this yet (data/estimates/README.md), so it's labelled as simulated.

Usage: python3 data/estimates/power_curve.py   (standard library only)
"""

import json
import math
import os
import statistics
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import common as cm

SIM = os.path.join(cm.REPO, "simulator")
STAGES = {
    "early": (2, 1, 8, "fixed_target=1,target_hp=1900,target_armor=55,target_mr=42"),
    "mid": (4, 2, 13, "fixed_target=1,target_hp=3300,target_armor=95,target_mr=65"),
    "late": (6, 4, 18, "fixed_target=1"),
}
TRIALS = 1500


def run(champ):
    b = champ["build"]
    out = {}
    for stage, (n_items, n_augs, level, target) in STAGES.items():
        cmd = [os.path.join(SIM, "mayhem_sim"), "--champ", champ["champion"], "--items", ",".join(b["items"][:n_items]),
               "--set", f"level={level},enemy_level={level},{target}", "--json", "--trials", str(TRIALS), "--threads", "1"]
        if b["augments"][:n_augs]:
            cmd[5:5] = ["--augs", ",".join(b["augments"][:n_augs])]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
        out[stage] = json.loads(r.stdout)["builds"][0]["summary"]["mean_dps"]
    return champ["champion"], out


def main():
    best = cm.load(os.path.join(SIM, "viewer", "replay-data", "best-builds.json"))["champions"]
    listing = json.loads(subprocess.run([os.path.join(SIM, "mayhem_sim"), "--list", "--json"],
                                        capture_output=True, text=True, cwd=SIM).stdout)
    key = {c["id"]: str(c["key"]) for c in listing["champions"]}
    with ThreadPoolExecutor(os.cpu_count() or 2) as ex:
        dps = dict(ex.map(run, best))
    ratio = {c: math.log(max(v["late"], 1) / max(v["early"], 1)) for c, v in dps.items()}
    mu, sd = statistics.mean(ratio.values()), statistics.pstdev(ratio.values())
    ranks = {s: sorted(v[s] for v in dps.values()) for s in STAGES}
    champions = {}
    for c, v in dps.items():
        if c not in key:
            continue
        champions[key[c]] = {
            **{s: round(sum(1 for x in ranks[s] if x <= v[s]) / len(ranks[s]), 3) for s in STAGES},
            "scaling": round((ratio[c] - mu) / sd, 3),
        }
    order = sorted(champions, key=lambda c: champions[c]["scaling"])
    out = {"simulated": True, "stages": {s: {"level": STAGES[s][2], "items": STAGES[s][0], "augments": STAGES[s][1]} for s in STAGES},
           "champions": champions, "early_game": [int(c) for c in order[:10]], "late_game": [int(c) for c in order[::-1][:10]]}
    with open(os.path.join(cm.HERE, "power_curve.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(champions)} champions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
