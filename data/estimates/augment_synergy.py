#!/usr/bin/env python3
"""Augment pair synergy per champion (augment_synergy.json, estimated): how much more one augment is worth once
another is already taken, for the champion page's "I took..." re-ranking (web/src/lib/augment-synergy.ts).

The real-game feed has no augment pairs (data/estimates/README.md), so every number here is a model estimate:

  sim    The Simulator (simulator/mayhem_sim) runs the champion's most popular real build
         (simulator/data/cn_enemy_pool.json) with each candidate augment alone and with every candidate pair, on
         the same fights. Synergy = sim gain of the pair - the two gains alone (champion_upgrades.gain: log value
         per second alive at the role's weights, plus staying alive). Turned into win-rate points with BETA, the
         slope champion_upgrades.py fits between real lift and sim gain, and squashed softly toward +-3 points
         (champion_upgrades.synergy_points). Candidates: the champion's MOST_PICKED most picked augments the
         Simulator models, plus every rule pair below whose augments the champion takes.
  rule   augment_synergy_rules.json: pairs that feed each other by confirmed mechanics. When the Simulator models
         both, the pair is simulated like any other (the rule adds its "why" line) and the rule's points are a floor,
         since the Simulator can miss part of an interaction (a ceiling for clashing pairs); otherwise the rule's points are used.

Only pairs worth at least MIN_POINTS either way are written. Pairs are symmetric, except rule pairs where pick order
decides (`a_first` / `b_first`: One Hit Wonder and Purist Caster).

Usage: python3 data/estimates/augment_synergy.py [--only Ahri,Jinx] [--jobs 4]
Needs `make -C simulator mayhem_sim`. Shares champion_upgrades.py's sim cache (~/.cache/deeparam-sim/upgrades/), so a
rerun only plays new builds. About 90 minutes on 4 cores.
"""

import argparse
import hashlib
import itertools
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import champion_upgrades as cu
import common as cm

OUT = os.path.join(cm.HERE, "augment_synergy.json")
RULES = os.path.join(cm.HERE, "augment_synergy_rules.json")
MOST_PICKED = 30  # the champion's most picked modeled augments, every pair simulated
MIN_PICK = 0.002  # an augment under this share of the champion's games counts as not taken
MIN_POINTS = 0.15  # win-rate points; smaller pairs are sim noise as often as not
TRIALS = cu.PAIR_TRIALS


def load_rules():
    out = {}
    for r in cm.load(RULES)["pairs"]:
        out[frozenset((r["a"], r["b"]))] = r
    return out


def champion_pairs(e, ctx):
    """[(key a, key b, points, source, why)] for one champion."""
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    taken = [(ctx["aug_key"].get(a["id"]), a["pick_rate"])
             for a in ctx["builds"].get(cid, {}).get("augments", {}).get("all", [])]
    taken = [(k, p) for k, p in taken if k and p >= MIN_PICK and ctx["augs"][k]["id"] not in ctx["selection"]]
    keys = {k for k, _ in taken}
    modeled = [k for k, _ in sorted(taken, key=lambda t: -t[1]) if k in ctx["modeled"]][:MOST_PICKED]
    rules = {p: r for p, r in ctx["rules"].items() if p <= keys and "points" in r}
    ordered = [r for p, r in ctx["rules"].items() if p <= keys and "points" not in r]
    sim_keys = set(modeled) | {k for p in rules for k in p if all(x in ctx["modeled"] for x in p)}
    items = cu.legal(e["build"]["items"])
    base = cu.sim(champ, items, [], cu.LATE, trials=TRIALS)
    single = {k: cu.gain(base, cu.sim(champ, items, [k], cu.LATE, trials=TRIALS), role) for k in sorted(sim_keys)}
    pairs = {frozenset(p) for p in itertools.combinations(sorted(modeled), 2)}
    pairs |= {p for p in rules if p <= sim_keys}
    out = []
    for p in sorted(pairs, key=sorted):
        a, b = sorted(p)
        syn = cu.gain(base, cu.sim(champ, items, [a, b], cu.LATE, trials=TRIALS), role) - single[a] - single[b]
        pts = 100 * cu.synergy_points(ctx["beta"] * syn)
        r = rules.get(p)
        if r and (pts < r["points"] if r["points"] >= 0 else pts > r["points"]):
            # The Simulator misses part of a confirmed interaction (Vulnerability's crits on damage over time,
            # Mystic Punch's cut capped by attacks): the rule's points are a floor.
            out.append((a, b, float(r["points"]), "rule", r["why"]))
        elif abs(pts) >= MIN_POINTS or r:
            out.append((a, b, round(pts, 2), "sim", r["why"] if r else None))
    for p, r in rules.items():
        if p not in pairs:
            a, b = sorted(p)
            out.append((a, b, float(r["points"]), "rule", r["why"]))
    # Pick order decides these: (a, b, points if a was taken first, points if b was).
    for r in ordered:
        out.append((r["a"], r["b"], (float(r["a_first"]), float(r["b_first"])), "order", r["why"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()

    cu.BIN_STAMP = hashlib.sha1(open(cu.SIM_BIN, "rb").read()).hexdigest()[:12]
    enemies = cm.load(os.path.join(cu.SIM, "data", "cn_enemy_pool.json"))["enemies"]
    enemies = [e for e in enemies if len(cu.legal(e["build"]["items"])) >= 4]
    if args.only:
        keep = set(args.only.split(","))
        enemies = [e for e in enemies if e["id"] in keep or e["name"] in keep]
    augs = cm.load(os.path.join(cu.SIM, "data", "augments.json"))["augments"]
    upgrades = cm.load(cu.OUT)
    ctx = {
        "builds": cm.builds(),
        "augs": augs,
        "aug_key": {v["id"]: k for k, v in augs.items() if v.get("id")},
        "modeled": {k for k, v in augs.items() if v.get("stats") or v.get("effects")},
        "selection": {a["id"] for a in cm.augment_rules().get("selectionAugments", [])},
        "rules": load_rules(),
        "beta": upgrades["method"]["beta"],
    }

    def safe(e):
        try:
            return champion_pairs(e, ctx)
        except RuntimeError as err:
            print("skipped", err, file=sys.stderr)
            return None

    with ThreadPoolExecutor(args.jobs) as ex:
        results = list(ex.map(safe, enemies))

    champions = {}
    for e, rows in zip(enemies, results):
        if not rows:
            continue
        size = lambda r: max(map(abs, r[2])) if isinstance(r[2], tuple) else abs(r[2])
        champions[str(e["champion_id"])] = [
            {"a": augs[a]["id"], "b": augs[b]["id"], "source": src,
             **({"a_first": pts[0], "b_first": pts[1]} if isinstance(pts, tuple) else {"points": pts}),
             **({"why": why} if why else {})}
            for a, b, pts, src, why in sorted(rows, key=lambda r: -size(r))
        ]
    out = {
        "patch": cm.live_patch(), "estimated": True,
        "method": {"trials": TRIALS, "seed": cu.SEED, "beta": ctx["beta"], "most_picked": MOST_PICKED,
                   "min_pick": MIN_PICK, "min_points": MIN_POINTS, "cap": cu.SYNERGY_CAP},
        "champions": champions,
    }
    path = OUT if not args.only else OUT.replace(".json", ".partial.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    n = sum(len(v) for v in champions.values())
    print(f"{len(champions)} champions, {n} pairs -> {os.path.relpath(path, cm.REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
