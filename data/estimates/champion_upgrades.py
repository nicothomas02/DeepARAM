#!/usr/bin/env python3
"""Best upgrades per champion (champion_upgrades.json): Pentakill Empowers, the Weapon of Destiny item and a
theoretical best set of 4 augments.

Every number is either the live patch's real-game data (data/cn, data/estimates/estimates.json) or the
Simulator (simulator/mayhem_sim, `make -C simulator mayhem_sim`) run on the champion's most popular real build
(simulator/data/cn_enemy_pool.json). Sim runs share their fights (same seed), so two builds differ only by the
change being tested.

Value of a sim run. Damage per second, plus healing and shielding per second alive and crowd control per second
alive (as a share of the champion's damage per second), weighted by role (ROLE_WEIGHTS): carries count damage
almost alone, supports and tanks count protection and crowd control about as much as damage. A change's sim gain
is log(value with it / value without it).

  pentakill  Pentakill Empowers one basic ability at the start (Q/W/E: 20 ability haste, 10% more damage,
             healing and shielding) and another one at level 18 (the ultimate allowed). The start pick is the
             basic ability with the best average gain at level 8 (2 items, 1 augment), level 13 (4 items,
             2 augments; both against level-matched training dummies) and level 18 (full build against real
             enemies). The level 18 pick is tried on top of it with the full build.
  destiny    Weapon of Destiny makes the first Legendary item the Weapon: each takedown adds 200 gold of its
             own stats (data/estimates/weapon_of_destiny.json). Candidates are the Legendary items the champion
             buys first in real core builds (5%+ of them) and the ones in its popular build. Each is put in the
             popular build, then upgraded with half the champion's takedowns per game (estimated kills + assists:
             the augment comes mid-game). Score = sim gain of the upgrade, turned into win-rate points (BETA),
             plus the item's real win rate as a first item for this champion minus its average first item.
  augments   Real part: each augment's estimated win rate on this champion (estimates.json: the feed's
             per-champion grade and the augment's fair win rate) minus the champion's own, trusted less when
             rarely picked (x pick / (pick + PICK_PRIOR)). These add up on the logit scale, which assumes no
             synergy. Synergy part: the Simulator runs the popular build with each augment alone, with pairs and
             with the best candidate sets of 4. Synergy = gain of the set minus the gains of its augments one by
             one: positive when they feed each other (crit + crit damage, haste + on-cast), negative when they
             overlap (two stat caps, two shields that never stack). It's turned into win-rate points with BETA,
             fitted across all champions as the slope of real lift on single-augment sim gain, on augments that
             only add stats (fit_beta).
             Score of a set = sum of real lifts + BETA x synergy. "Theoretical": it ignores which rarities the
             game offers you and when. Augments that hand out random augments (Transmute, King Me) are left out.

Usage: python3 data/estimates/champion_upgrades.py [--only Ahri,Jinx] [--jobs 4]
Sim results are cached in ~/.cache/deeparam-sim/upgrades/ so a rerun only plays new builds.
"""

import argparse
import hashlib
import itertools
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import common as cm
import weapon_of_destiny as wod

SIM = os.path.join(cm.REPO, "simulator")
SIM_BIN = os.path.join(SIM, "mayhem_sim")
OUT = os.path.join(cm.HERE, "champion_upgrades.json")
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-sim", "upgrades")
GAME = os.path.join(CACHE, "game")  # x<N>/: live game data plus N takedowns of each Weapon of Destiny item
TRIALS = 3000
PAIR_TRIALS = 1500
SEED = 26

EMPOWER = {"Q": "heavy", "W": "power", "E": "thrash", "R": "doom"}
STAGES = {
    "early": (2, 1, "level=8,enemy_level=8,fixed_target=1,target_hp=1900,target_armor=55,target_mr=42"),
    "mid": (4, 2, "level=13,enemy_level=13,fixed_target=1,target_hp=3300,target_armor=95,target_mr=65"),
    "late": (6, 4, "level=18,enemy_level=18"),
}
LATE = STAGES["late"][2]
# (healing + shielding, crowd control) worth per role, against damage at 1.
ROLE_WEIGHTS = {
    "marksman": (0.25, 0.25), "mage": (0.3, 0.4), "assassin": (0.25, 0.25),
    "fighter": (0.5, 0.5), "tank": (0.8, 1.0), "support": (1.0, 1.0),
}
PICK_PRIOR = 0.01
SHORTLIST_REAL, SHORTLIST_SIM, SETS_CHECKED = 14, 6, 25
FIRST_SHARE = 0.05
TAKEDOWN_SHARE = 0.5


def load_json(path):
    return cm.load(path)


def sim(champ, items, augs, settings, trials=TRIALS, wod=None, takedowns=0):
    """Summary of one build; cached on disk by its inputs (and the simulator binary)."""
    augs = list(augs)
    # The Weapon's upgrade rides on a synthetic augment holding `takedowns` worth of its stats (ensure_scaled).
    extra = [f"wod_{wod}"] if wod else []
    key = json.dumps([champ, items, sorted(augs), extra, takedowns, settings, trials, SEED, BIN_STAMP])
    h = hashlib.sha1(key.encode()).hexdigest()
    path = os.path.join(CACHE, "runs", h[:2], h + ".json")
    if os.path.exists(path):
        return load_json(path)
    cmd = [SIM_BIN, "--champ", champ, "--items", ",".join(items), "--set", settings, "--json",
           "--trials", str(trials), "--threads", "1", "--seed", str(SEED)]
    all_augs = augs + extra
    if all_augs:
        cmd += ["--augs", ",".join(all_augs)]
    if wod:
        cmd += ["--game-data", os.path.join(GAME, f"x{takedowns}")]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
    if r.returncode:
        raise RuntimeError(f"{champ} {items} {all_augs}: {r.stderr.strip()[:300]}")
    s = json.loads(r.stdout)["builds"][0]["summary"]
    out = {k: s.get(k, 0) for k in ("mean_dps", "healing", "shielding", "cc_seconds", "time_alive")}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f)
    return out


def value(s, role, ref_dps):
    """Damage-equivalent per second of a sim summary."""
    wh, wc = ROLE_WEIGHTS.get(role, (0.4, 0.4))
    alive = max(s["time_alive"], 1.0)
    return s["mean_dps"] + wh * (s["healing"] + s["shielding"]) / alive + wc * ref_dps * s["cc_seconds"] / alive


def gain(base, new, role):
    ref = max(base["mean_dps"], 1.0)
    b, n = value(base, role, ref), value(new, role, ref)
    return math.log(max(n, 1e-6) / max(b, 1e-6))


GROUPS = {k: v["group"] for k, v in load_json(os.path.join(SIM, "data", "items.json"))["items"].items() if v.get("group")}


def legal(items):
    """Drop an item that shares a group (Last Whisper, Hydra...) with an earlier one; the game forbids both."""
    seen, out = set(), []
    for i in items:
        g = GROUPS.get(i)
        if g and g in seen:
            continue
        if g:
            seen.add(g)
        out.append(i)
    return out


# ---------------------------------------------------------------- Pentakill

def pentakill(e):
    champ, role = e["id"], e["role"]
    items, augs = legal(e["build"]["items"]), e["build"]["augments"]
    stage_gain = {}
    for stage, (n_items, n_augs, settings) in STAGES.items():
        it, au = items[:n_items], augs[:n_augs]
        base = sim(champ, it, au, settings)
        stage_gain[stage] = {s: gain(base, sim(champ, it, au + [EMPOWER[s]], settings), role) for s in "QWE"}
    start_score = {s: statistics.mean(stage_gain[st][s] for st in STAGES) for s in "QWE"}
    first = max("QWE", key=lambda s: start_score[s])
    with_first = sim(champ, items, augs + [EMPOWER[first]], LATE)
    late = {s: gain(with_first, sim(champ, items, augs + [EMPOWER[first], EMPOWER[s]], LATE), role)
            for s in "QWER" if s != first}
    second = max(late, key=lambda s: late[s])
    pct = lambda g: round(100 * (math.exp(g) - 1), 2)
    return {
        "start": first, "level18": second,
        "start_options": {s: {"score": pct(start_score[s]), **{st: pct(stage_gain[st][s]) for st in STAGES}} for s in "QWE"},
        "level18_options": {s: pct(g) for s, g in late.items()},
        "gain": round(pct(start_score[first]) + pct(late[second]), 2),
    }


# ---------------------------------------------------------------- Weapon of Destiny

def destiny(e, ctx, beta):
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    items = legal(e["build"]["items"])
    legendary_keys = ctx["legendary"]
    firsts = wod.first_legendary(ctx["builds"].get(cid, {}), set(ctx["leg_ids"].values()))
    cands = {ctx["id_to_key"][g] for g, (share, _) in firsts.items() if share >= FIRST_SHARE and g in ctx["id_to_key"]}
    cands |= {i for i in items if i in legendary_keys}
    cands = {c for c in cands if c in ctx["wod_keys"]}
    prof = ctx["profiles"].get(cid)
    takedowns = max(1, round(TAKEDOWN_SHARE * (prof["kills"]["value"] + prof["assists"]["value"]))) if prof else 10
    ensure_scaled(takedowns, ctx)
    rows = []
    for c in sorted(cands):
        build = list(items)
        if c not in build:
            # Swap it in for the popular build's last Legendary that isn't in the same item group.
            for j in range(len(build) - 1, -1, -1):
                if build[j] in legendary_keys:
                    build[j] = c
                    break
            build = legal(build)
            if c not in build or len(build) < len(items):
                continue
        # Weapon first: build order matters for nothing in the sim, but keep it first for readability.
        build = [c] + [b for b in build if b != c]
        base = sim(champ, build, e["build"]["augments"][:3], LATE)
        up = sim(champ, build, e["build"]["augments"][:3], LATE, wod=c, takedowns=takedowns)
        g = gain(base, up, role)
        gid = ctx["key_to_id"][c]
        share, lift = firsts.get(gid, (0.0, 0.0))
        real = lift * share / (share + FIRST_SHARE)
        rows.append({"item": gid, "key": c, "sim_gain": round(100 * (math.exp(g) - 1), 2),
                     "first_share": round(share, 3), "first_lift": round(lift, 4),
                     "score": round(100 * (beta * g + real), 3)})
    rows.sort(key=lambda r: -r["score"])
    return {"takedowns": takedowns, "best": rows[0]["item"] if rows else None, "options": rows}


def ensure_scaled(n, ctx):
    d = os.path.join(GAME, f"x{n}")
    if os.path.exists(os.path.join(d, "augments.json")):
        return
    os.makedirs(d, exist_ok=True)
    for f in ("champions.json", "items.json", "augment_pools.json"):
        p = os.path.join(d, f)
        if not os.path.exists(p):
            os.symlink(os.path.join(SIM, "data", f), p)
    augs = load_json(os.path.join(SIM, "data", "augments.json"))
    for key, stats in ctx["wod_stats"].items():
        augs["augments"][f"wod_{key}"] = {"id": 0, "name": "Weapon of Destiny", "rarity": "gold",
                                          "stats": {k: v * n for k, v in stats.items()}}
    tmp = os.path.join(d, f"augments.json.{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(augs, f)
    os.replace(tmp, os.path.join(d, "augments.json"))


# ---------------------------------------------------------------- Augments

def augment_singles(e, ctx):
    """Real lift and sim gain of every candidate augment on its own (for the shortlist and BETA)."""
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    items = legal(e["build"]["items"])
    pool = set(ctx["pools"].get(cid, []))
    rows = {}
    for r in ctx["est"].get(cid, []):
        key = ctx["aug_key"].get(r["id"])
        if not key or key not in pool or r["id"] in ctx["selection"]:
            continue
        rows[key] = {"id": r["id"], "lift": r["lift"], "pick": r["pick_rate"],
                     "real": r["lift"] * r["pick_rate"] / (r["pick_rate"] + PICK_PRIOR),
                     "modeled": key in ctx["modeled"], "sim": 0.0}
    base = sim(champ, items, [], LATE)
    for key, r in rows.items():
        if r["modeled"]:
            r["sim"] = gain(base, sim(champ, items, [key], LATE), role)
    return rows


def augment_sets(e, ctx, singles, beta):
    champ, role = e["id"], e["role"]
    items = legal(e["build"]["items"])
    if len(singles) < 4:
        return None
    by_real = sorted(singles, key=lambda k: -singles[k]["real"])[:SHORTLIST_REAL]
    by_sim = [k for k in sorted(singles, key=lambda k: -singles[k]["sim"]) if k not in by_real][:SHORTLIST_SIM]
    short = by_real + by_sim
    base = sim(champ, items, [], LATE)

    def set_gain(keys, trials=TRIALS):
        m = [k for k in keys if singles[k]["modeled"]]
        if len(m) < 2:
            return sum(singles[k]["sim"] for k in m)
        s = sim(champ, items, m, LATE, trials=trials)
        b = base if trials == TRIALS else sim(champ, items, [], LATE, trials=trials)
        return gain(b, s, role)

    pair_syn = {}
    modeled = [k for k in short if singles[k]["modeled"]]
    for a, b in itertools.combinations(modeled, 2):
        b1 = sim(champ, items, [], LATE, trials=PAIR_TRIALS)
        ga = gain(b1, sim(champ, items, [a], LATE, trials=PAIR_TRIALS), role)
        gb = gain(b1, sim(champ, items, [b], LATE, trials=PAIR_TRIALS), role)
        pair_syn[frozenset((a, b))] = set_gain((a, b), PAIR_TRIALS) - ga - gb

    def approx(keys):
        real = sum(singles[k]["real"] for k in keys)
        syn = sum(pair_syn.get(frozenset(p), 0.0) for p in itertools.combinations(keys, 2))
        return real + beta * syn

    ranked = sorted(itertools.combinations(short, 4), key=lambda ks: -approx(ks))[:SETS_CHECKED]
    # The best set by real data alone, so the report can say what synergy changed.
    plain = tuple(by_real[:4])
    if plain not in ranked:
        ranked.append(plain)
    scored = []
    for ks in ranked:
        syn = set_gain(ks) - sum(singles[k]["sim"] for k in ks)
        real = sum(singles[k]["real"] for k in ks)
        scored.append((real + beta * syn, real, syn, ks))
    scored.sort(key=lambda t: -t[0])

    def row(t):
        score, real, syn, ks = t
        ks = sorted(ks, key=lambda k: -singles[k]["real"])
        return {"augments": [singles[k]["id"] for k in ks], "keys": ks,
                "score": round(100 * score, 2), "real": round(100 * real, 2), "synergy": round(100 * beta * syn, 2),
                "sim_synergy": round(100 * syn, 2)}

    plain_row = next(t for t in scored if t[3] == plain)
    pairs = sorted(((v, tuple(sorted(k))) for k, v in pair_syn.items()), reverse=True)
    return {
        "best": row(scored[0]),
        "runners_up": [row(t) for t in scored[1:3]],
        "by_real_only": row(plain_row),
        "best_pair_synergy": [{"keys": list(k), "sim_synergy": round(100 * v, 2)} for v, k in pairs[:3] if v > 0],
        "worst_pair_synergy": [{"keys": list(k), "sim_synergy": round(100 * v, 2)} for v, k in pairs[::-1][:2] if v < 0],
    }


def fit_beta(all_singles, stat_only):
    """Slope of real lift on single-augment sim gain, within champions (each champion's mean taken out).

    Only augments that just add stats: the Simulator gets those exactly, and noise in the sim gain (the
    x side) would flatten the slope, while noise in real lifts (the y side) doesn't bias it. On every modeled
    augment the slope is about 5 times flatter because effects the sim only approximates add x noise."""
    xs, ys = [], []
    for rows in all_singles.values():
        m = [r for k, r in rows.items() if r["modeled"] and k in stat_only]
        if len(m) < 3:
            continue
        mx = statistics.mean(r["sim"] for r in m)
        my = statistics.mean(r["real"] for r in m)
        for r in m:
            xs.append(r["sim"] - mx)
            ys.append(r["real"] - my)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    syy = sum(y * y for y in ys)
    beta = sxy / sxx if sxx else 0.0
    corr = sxy / math.sqrt(sxx * syy) if sxx and syy else 0.0
    return beta, corr, len(xs)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()

    global BIN_STAMP
    BIN_STAMP = hashlib.sha1(open(SIM_BIN, "rb").read()).hexdigest()[:12]
    enemies = load_json(os.path.join(SIM, "data", "cn_enemy_pool.json"))["enemies"]
    if args.only:
        keep = set(args.only.split(","))
        enemies = [e for e in enemies if e["id"] in keep or e["name"] in keep]
    enemies = [e for e in enemies if len(legal(e["build"]["items"])) >= 4 and e["build"].get("augments")]

    sim_items = load_json(os.path.join(SIM, "data", "items.json"))["items"]
    sim_augs = load_json(os.path.join(SIM, "data", "augments.json"))["augments"]
    wod_data = load_json(os.path.join(cm.HERE, "weapon_of_destiny.json"))["items"]
    key_to_id = {k: v["id"] for k, v in sim_items.items()}
    leg = {k: v["id"] for k, v in sim_items.items() if v.get("slot") == "legendary"}
    ctx = {
        "builds": cm.builds(),
        "profiles": cm.load(os.path.join(cm.HERE, "estimates.json"))["profiles"],
        "est": cm.load(os.path.join(cm.HERE, "estimates.json"))["augments"],
        "legendary": set(leg), "leg_ids": leg, "key_to_id": key_to_id,
        "id_to_key": {v: k for k, v in leg.items()},
        "wod_stats": {k: wod_data[str(v)]["per_takedown"] for k, v in leg.items() if str(v) in wod_data},
        "pools": load_json(os.path.join(SIM, "data", "augment_pools.json"))["pools"],
        "aug_key": {v["id"]: k for k, v in sim_augs.items() if v.get("id")},
        "modeled": {k for k, v in sim_augs.items() if v.get("stats") or v.get("effects")},
        "selection": {a["id"] for a in cm.augment_rules().get("selectionAugments", [])},
    }
    ctx["wod_keys"] = set(ctx["wod_stats"])
    os.makedirs(GAME, exist_ok=True)

    def safe(fn, *a):
        try:
            return fn(*a)
        except RuntimeError as err:
            print("skipped", err, file=sys.stderr)
            return None

    with ThreadPoolExecutor(args.jobs) as ex:
        print(f"{len(enemies)} champions: augment singles", file=sys.stderr, flush=True)
        singles = dict(zip([e["id"] for e in enemies], ex.map(lambda e: safe(augment_singles, e, ctx), enemies)))
        singles = {k: v for k, v in singles.items() if v}
        stat_only = {k for k, v in sim_augs.items() if v.get("stats") and not v.get("effects")}
        beta, corr, n = fit_beta(singles, stat_only)
        print(f"beta {beta:.4f} (r {corr:.3f}, {n} champion-augment pairs)", file=sys.stderr, flush=True)
        print("pentakill", file=sys.stderr, flush=True)
        pk = dict(zip([e["id"] for e in enemies], ex.map(lambda e: safe(pentakill, e), enemies)))
        print("weapon of destiny", file=sys.stderr, flush=True)
        wd = dict(zip([e["id"] for e in enemies], ex.map(lambda e: safe(destiny, e, ctx, beta), enemies)))
        print("augment sets", file=sys.stderr, flush=True)
        sets = dict(zip([e["id"] for e in enemies],
                        ex.map(lambda e: safe(augment_sets, e, ctx, singles.get(e["id"], {}), beta) if e["id"] in singles else None, enemies)))

    champions = {}
    dd = cm.data_dragon()
    for e in enemies:
        cid = str(e["champion_id"])
        champions[cid] = {"name": dd.get(cid, {}).get("name", e["name"]), "key": e["id"], "role": e["role"],
                          "pentakill": pk.get(e["id"]), "weapon_of_destiny": wd.get(e["id"]),
                          "augments": sets.get(e["id"])}
    out = {
        "patch": cm.live_patch(), "simulated": True,
        "method": {"trials": TRIALS, "seed": SEED, "role_weights": ROLE_WEIGHTS, "pick_prior": PICK_PRIOR,
                   "beta": round(beta, 5), "beta_corr": round(corr, 3), "beta_pairs": n,
                   "takedown_share": TAKEDOWN_SHARE, "first_share": FIRST_SHARE},
        "champions": champions,
    }
    path = OUT if not args.only else OUT.replace(".json", ".partial.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"{len(champions)} champions -> {os.path.relpath(path, cm.REPO)}", file=sys.stderr)


BIN_STAMP = ""

if __name__ == "__main__":
    main()
