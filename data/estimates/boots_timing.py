#!/usr/bin/env python3
"""When to buy boots in each core build (boots_timing.json): before the 1st item, after the 1st, 2nd or 3rd.

Real games don't tell us the order boots were bought in (the live feed lists core builds without boots and six-item
builds as a set), so this is the Simulator's answer. For each champion's real core builds (data/cn/builds) and each
boots it buys, the build is bought one step at a time with the gold-efficiency rule players use: at each step
(owning the core's first 1, 2 or 3 items; 0 too for a champion whose real starting buys include boots, which
almost none do) compare buying the boots next with buying the next core item, as sim
gain per gold (champion_upgrades.gain: role-weighted damage, healing, shielding and crowd control per second plus
time alive). Boots go in the first step where they give at least as much per gold as the next item; if they never
do, after the core.

Each step is fought at a level matching that much gold (STEP_LEVEL) against the live patch's real enemies at the
same level, so armor, magic resist and tenacity count, with the champion's popular augments up to that point.
Movement speed is also counted at its gold worth (MS_GOLD), turned into gain at the next item's rate: the fights
barely show what it does in a real game. Sim runs share champion_upgrades' cache and seed.

Usage: python3 data/estimates/boots_timing.py [--only Ahri,Jinx] [--jobs 4]
Needs simulator/mayhem_sim (make -C simulator mayhem_sim).
"""

import argparse
import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import common as cm
import champion_upgrades as cu

OUT = os.path.join(cm.HERE, "boots_timing.json")
TRIALS = 2000
# Items already owned -> (champion and enemy level, augments taken by then).
STEP_LEVEL = {0: (6, 1), 1: (9, 2), 2: (12, 2), 3: (14, 3)}
# Gold worth of 1 movement speed, as the shop prices it (Boots: 300 gold for 25). Fights against a group that stands
# and trades barely show it, but in a real game it dodges skill shots, catches and escapes, so it's added on top.
MS_GOLD = 12
MIN_STEPS = 3  # a core needs this many simulated items to be timed


def settings(level):
    return f"level={level},enemy_level={level}"


def time_core(champ, role, core, boots, augs, cost, ms_gold, first=1):
    """Step (first-3) at which each boots is bought, for one core build of sim item keys."""
    out = {}
    runs = {}

    def run(items, step):
        key = (tuple(items), step)
        if key not in runs:
            level, n_augs = STEP_LEVEL[step]
            runs[key] = cu.sim(champ, list(items), augs[:n_augs], settings(level), trials=TRIALS)
        return runs[key]

    for b in boots:
        step = len(core)
        for k in range(first, len(core)):
            owned = core[:k]
            base = run(owned, k)
            per_item = cu.gain(base, run(core[: k + 1], k), role) / cost[core[k]]
            # Movement speed counted at its gold worth on top of what the fight shows (see MS_GOLD).
            per_boots = (cu.gain(base, run(owned + [b], k), role) + per_item * ms_gold[b]) / cost[b]
            if per_boots >= per_item:
                step = k
                break
        out[b] = step
    return out


def champion(e, builds, key_of, cost, ms_gold):
    cid = str(e["champion_id"])
    b = builds.get(cid, {}).get("items", {})
    boots_ids = [r["items"][0] for r in b.get("boots", []) if len(r["items"]) == 1 and r["items"][0] in key_of]
    if not boots_ids:
        return cid, None
    boots = [key_of[i] for i in boots_ids]
    augs = e["build"].get("augments", [])
    # Boots before the 1st item only for a champion whose real starting buys include boots.
    first = 0 if any(i in boots_ids for r in b.get("starting", []) for i in r["items"]) else 1
    timed = {}
    for r in b.get("core", []):
        core = cu.legal([key_of[i] for i in r["items"] if i in key_of])
        if len(core) < MIN_STEPS or len(core) != len(r["items"]):
            continue
        steps = time_core(e["id"], e["role"], core, boots, augs, cost, ms_gold, first)
        timed[",".join(map(str, r["items"]))] = {str(i): steps[key_of[i]] for i in boots_ids}
    return cid, timed or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    cu.BIN_STAMP = hashlib.sha1(open(cu.SIM_BIN, "rb").read()).hexdigest()[:12]

    enemies = cu.load_json(os.path.join(cu.SIM, "data", "cn_enemy_pool.json"))["enemies"]
    if args.only:
        keep = set(args.only.split(","))
        enemies = [e for e in enemies if e["id"] in keep or e["name"] in keep]
    key_of = {v["id"]: k for k, v in cu.SIM_ITEMS.items() if v.get("slot") in ("legendary", "boots")}
    cost = {k: v["cost"] for k, v in cu.SIM_ITEMS.items()}
    ms_gold = {k: MS_GOLD * v.get("effects", {}).get("ms", 0) for k, v in cu.SIM_ITEMS.items()}
    builds = cm.builds()

    def safe(e):
        try:
            return champion(e, builds, key_of, cost, ms_gold)
        except RuntimeError as err:
            print("skipped", err, file=sys.stderr)
            return str(e["champion_id"]), None

    with ThreadPoolExecutor(args.jobs) as ex:
        results = list(ex.map(safe, enemies))
    champions = {cid: t for cid, t in results if t}
    out = {
        "patch": cm.live_patch(), "simulated": True,
        "method": {"trials": TRIALS, "seed": cu.SEED, "step_level": STEP_LEVEL, "ms_gold": MS_GOLD, "role_weights": cu.ROLE_WEIGHTS},
        "champions": champions,
    }
    path = OUT if not args.only else OUT.replace(".json", ".partial.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print(f"{len(champions)} champions -> {os.path.relpath(path, cm.REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
