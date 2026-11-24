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

Full pool (--full): every pair of the champion's modeled augments, for "weak alone, strong together" picks. A quick
screen (SCREEN_TRIALS) of all ~800,000 pairs, then the top RECHECK_SHARE by size rerun at PAIR_TRIALS on RECHECK_SEEDS
independent seeds; a pair's points are the mean and `lo`/`hi` its mean -+ one standard deviation across seeds. Rows
also carry each augment's sim value alone (`a_alone`, `b_alone`, points) and its real grade on the champion
(`a_grade`, `b_grade`), and `hidden` when both are in the lower half of the champion's pool. Split across machines
with --shard i --shards N (GitHub: .github/workflows/augment-synergy-full.yml), then --merge the shard files.

Usage: python3 data/estimates/augment_synergy.py [--only Ahri,Jinx] [--jobs 4]
       python3 data/estimates/augment_synergy.py --full --shard 0 --shards 24
       python3 data/estimates/augment_synergy.py --merge augment_synergy.shard-*.json
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
SCREEN_TRIALS = 400  # --full: first pass over every pair
RECHECK_SHARE = 0.03  # --full: share of each champion's pairs (largest first) rerun at TRIALS
RECHECK_SEEDS = 3
GRADE_RANK = {"S": 5, "A": 4, "B": 3, "C": 2, "D": 1}


def load_rules():
    out = {}
    for r in cm.load(RULES)["pairs"]:
        out[frozenset((r["a"], r["b"]))] = r
    return out


def champion_rule_pairs(e, ctx):
    """Confirmed-mechanics pairs only (the default since 2026-11-20: the Simulator doesn't play like a real game yet,
    so it is kept out of rankings): [(key a, key b, points, source, why)]."""
    cid = str(e["champion_id"])
    keys = {ctx["aug_key"].get(a["id"]) for a in ctx["builds"].get(cid, {}).get("augments", {}).get("all", [])}
    out = []
    for p, r in ctx["rules"].items():
        if p <= keys:
            if "points" in r:
                a, b = sorted(p)
                out.append((a, b, float(r["points"]), "rule", r["why"]))
            else:
                out.append((r["a"], r["b"], (float(r["a_first"]), float(r["b_first"])), "order", r["why"]))
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


def champion_pairs_full(e, ctx):
    """Every pair of the champion's modeled augments: [(key a, key b, points, source, why, extra)]."""
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    rows = ctx["builds"].get(cid, {}).get("augments", {}).get("all", [])
    taken = [(ctx["aug_key"].get(a["id"]), a.get("grade")) for a in rows]
    taken = [(k, g) for k, g in taken if k and ctx["augs"][k]["id"] not in ctx["selection"]]
    grade = dict(taken)
    keys = {k for k, _ in taken}
    modeled = sorted(k for k in keys if k in ctx["modeled"])
    items = cu.legal(e["build"]["items"])
    pts = lambda syn: 100 * cu.synergy_points(ctx["beta"] * syn)

    base = cu.sim(champ, items, [], cu.LATE, trials=SCREEN_TRIALS)
    single = {k: cu.gain(base, cu.sim(champ, items, [k], cu.LATE, trials=SCREEN_TRIALS), role) for k in modeled}
    screen = {}
    for a, b in itertools.combinations(modeled, 2):
        both = cu.gain(base, cu.sim(champ, items, [a, b], cu.LATE, trials=SCREEN_TRIALS), role)
        screen[(a, b)] = pts(both - single[a] - single[b])
    rules = {p: r for p, r in ctx["rules"].items() if p <= keys and "points" in r}
    n = max(1, round(RECHECK_SHARE * len(screen)))
    pick = set(sorted(screen, key=lambda p: -abs(screen[p]))[:n])
    pick |= {tuple(sorted(p)) for p in rules if all(x in ctx["modeled"] for x in p)}

    seeds = [cu.SEED + i for i in range(RECHECK_SEEDS)]
    bases = {s_: cu.sim(champ, items, [], cu.LATE, trials=TRIALS, seed=s_) for s_ in seeds}
    alone_full = {}

    def alone(k, s_):
        if (k, s_) not in alone_full:
            alone_full[(k, s_)] = cu.gain(bases[s_], cu.sim(champ, items, [k], cu.LATE, trials=TRIALS, seed=s_), role)
        return alone_full[(k, s_)]

    # The lower half of the champion's pool, by real grade where it has one, else by sim value alone.
    by_grade = sorted((k for k in modeled if grade.get(k) in GRADE_RANK), key=lambda k: GRADE_RANK[grade[k]])
    weak_grade = set(by_grade[: len(by_grade) // 2])
    by_sim = sorted(modeled, key=lambda k: single[k])
    weak_sim = set(by_sim[: len(by_sim) // 2])
    weak = lambda k: k in weak_grade if grade.get(k) in GRADE_RANK else k in weak_sim

    out = []
    for a, b in sorted(pick):
        vals = []
        for s_ in seeds:
            both = cu.gain(bases[s_], cu.sim(champ, items, [a, b], cu.LATE, trials=TRIALS, seed=s_), role)
            vals.append(pts(both - alone(a, s_) - alone(b, s_)))
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / max(1, len(vals) - 1)) ** 0.5
        lo, hi = mean - sd, mean + sd
        r = rules.get(frozenset((a, b)))
        extra = {"lo": round(lo, 2), "hi": round(hi, 2), "screen": round(screen.get((a, b), 0), 2),
                 "a_alone": round(100 * cu.synergy_points(ctx["beta"] * sum(alone(a, s_) for s_ in seeds) / len(seeds)), 2),
                 "b_alone": round(100 * cu.synergy_points(ctx["beta"] * sum(alone(b, s_) for s_ in seeds) / len(seeds)), 2),
                 **({"a_grade": grade[a]} if grade.get(a) else {}), **({"b_grade": grade[b]} if grade.get(b) else {}),
                 **({"hidden": True} if weak(a) and weak(b) and lo >= MIN_POINTS else {})}
        if r and (mean < r["points"] if r["points"] >= 0 else mean > r["points"]):
            out.append((a, b, float(r["points"]), "rule", r["why"], extra))
        elif lo >= MIN_POINTS or hi <= -MIN_POINTS or r:
            out.append((a, b, round(mean, 2), "sim", r["why"] if r else None, extra))
    for p, r in rules.items():
        if tuple(sorted(p)) not in pick:
            a, b = sorted(p)
            out.append((a, b, float(r["points"]), "rule", r["why"], {}))
    for r in ctx["rules"].values():
        if frozenset((r["a"], r["b"])) <= keys and "points" not in r:
            out.append((r["a"], r["b"], (float(r["a_first"]), float(r["b_first"])), "order", r["why"], {}))
    return out


def write_rows(champions, e, rows, augs):
    size = lambda r: max(map(abs, r[2])) if isinstance(r[2], tuple) else abs(r[2])
    champions[str(e["champion_id"])] = [
        {"a": augs[a]["id"], "b": augs[b]["id"], "source": src,
         **({"a_first": pts[0], "b_first": pts[1]} if isinstance(pts, tuple) else {"points": pts}),
         **({"why": why} if why else {}), **extra}
        for a, b, pts, src, why, extra in sorted(rows, key=lambda r: -size(r))
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--sim", action="store_true", help="also simulate the most picked pairs (exploration only)")
    ap.add_argument("--full", action="store_true", help="simulate every pair of the champion's modeled augments (exploration only)")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    ap.add_argument("--merge", nargs="+", help="combine --full shard files into augment_synergy.json")
    args = ap.parse_args()
    if args.merge:
        merged = None
        for path in args.merge:
            part = cm.load(path)
            if merged is None:
                merged = {**part, "champions": {}}
            merged["champions"].update(part["champions"])
        merged["method"].pop("shard", None)
        # Exploration only: the site's augment_synergy.json stays rules-only (the Simulator is kept out of rankings).
        full = OUT.replace(".json", "_full.json")
        with open(full, "w", encoding="utf-8") as f:
            json.dump(merged, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")
        n = sum(len(v) for v in merged["champions"].values())
        print(f"{len(merged['champions'])} champions, {n} pairs -> {os.path.relpath(full, cm.REPO)}", file=sys.stderr)
        return

    if args.sim or args.full:
        cu.BIN_STAMP = hashlib.sha1(open(cu.SIM_BIN, "rb").read()).hexdigest()[:12]
    enemies = cm.load(os.path.join(cu.SIM, "data", "cn_enemy_pool.json"))["enemies"]
    if args.sim or args.full:
        enemies = [e for e in enemies if len(cu.legal(e["build"]["items"])) >= 4]
    if args.only:
        keep = set(args.only.split(","))
        enemies = [e for e in enemies if e["id"] in keep or e["name"] in keep]
    augs = cm.load(os.path.join(cu.SIM, "data", "augments.json"))["augments"]
    upgrades = cm.load(cu.OUT)
    builds = cm.builds()
    if not (args.sim or args.full):
        # Rule pairs need only the champion's augment pool, so every champion with builds gets them, including ones the
        # Simulator doesn't model yet (Yunara had none, Nico 2026-11-24).
        have = {str(e["champion_id"]) for e in enemies}
        enemies = enemies + [{"id": cid, "name": cid, "champion_id": int(cid)} for cid in sorted(builds)
                             if cid not in have and builds[cid].get("augments", {}).get("all")
                             and (not args.only or cid in set(args.only.split(",")))]
    enemies = sorted(enemies, key=lambda e: str(e["id"]))[args.shard::args.shards]
    ctx = {
        "builds": builds,
        "augs": augs,
        "aug_key": {v["id"]: k for k, v in augs.items() if v.get("id")},
        "modeled": {k for k, v in augs.items() if v.get("stats") or v.get("effects")},
        "selection": {a["id"] for a in cm.augment_rules().get("selectionAugments", [])},
        "rules": load_rules(),
        "beta": upgrades["method"]["beta"],
    }

    def safe(e):
        try:
            if args.full:
                return champion_pairs_full(e, ctx)
            if args.sim:
                return [r + ({},) for r in champion_pairs(e, ctx)]
            return [r + ({},) for r in champion_rule_pairs(e, ctx)]
        except RuntimeError as err:
            print("skipped", err, file=sys.stderr)
            return None

    with ThreadPoolExecutor(args.jobs) as ex:
        results = list(ex.map(safe, enemies))

    champions = {}
    for e, rows in zip(enemies, results):
        if rows:
            write_rows(champions, e, rows, augs)
    out = {
        "patch": cm.live_patch(), "estimated": True,
        "method": {"trials": TRIALS, "seed": cu.SEED, "beta": ctx["beta"], "min_points": MIN_POINTS, "cap": cu.SYNERGY_CAP,
                   "simulated": bool(args.sim or args.full),
                   **({"pool": "full", "screen_trials": SCREEN_TRIALS, "recheck_share": RECHECK_SHARE,
                       "recheck_seeds": RECHECK_SEEDS, "shard": [args.shard, args.shards]} if args.full else
                      {"most_picked": MOST_PICKED, "min_pick": MIN_PICK})},
        "champions": champions,
    }
    path = OUT if not args.only else OUT.replace(".json", ".partial.json")
    if args.shards > 1:
        path = OUT.replace(".json", f".shard-{args.shard}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    n = sum(len(v) for v in champions.values())
    print(f"{len(champions)} champions, {n} pairs -> {os.path.relpath(path, cm.REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
