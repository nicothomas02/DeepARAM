#!/usr/bin/env python3
"""Best upgrades per champion (champion_upgrades.json): Pentakill Empowers, the Weapon of Destiny item and a
theoretical best set of 4 augments.

Every number is either the live patch's real-game data (data/cn, data/estimates/estimates.json) or the
Simulator (simulator/mayhem_sim, `make -C simulator mayhem_sim`) run on the champion's most popular real build
(simulator/data/cn_enemy_pool.json). Sim runs share their fights (same seed), so two builds differ only by the
change being tested.

Value of a sim run. Damage per second, plus healing, shielding and crowd control per second alive (each crowd
control second worth a second of the champion's damage), weighted by role (ROLE_WEIGHTS): carries count damage
almost alone, tanks and supports count protection and crowd control about as much as damage. A change's sim gain is
log(value with it / value without it) plus log(time alive with / without) at the role's weight: fights run until
the champion goes down, so surviving longer counts: 0.6 for tanks, 0.5 for supports, 0.4 for fighters, 0.25 for
carries. Not in full: survival is where the sim is least sure (a revive or a lifesteal loop can double a fight).

  pentakill  Pentakill Empowers one basic ability at the start (Q/W/E: 20 ability haste, 10% more damage,
             healing and shielding) and another one at level 18 (the ultimate allowed). The start pick is the
             basic ability with the best average gain at level 8 (2 items, 1 augment), level 13 (4 items,
             2 augments; both against level-matched training dummies) and level 18 (full build against real
             enemies). The level 18 pick is tried on top of it with the full build. Picks are scored for a
             team fight (team_gain), not the champion's own fight alone: crowd control counts by strength (a
             slow by its amount) and each second of it is worth at least an average champion's damage per
             second; and team_extra adds what the simulator can't see, from pentakill_team.json: healing and
             shielding on allies, team utility (a revive, team invulnerability, a spell shield, team speed)
             counted as crowd control seconds, and the champion's own heals and shields in the training-dummy
             stages. Healing and shielding added there count 1.8 times (KEEP_ALIVE: the time it keeps someone
             fighting, as the simulator counts the champion's own). Role weights decide the blend, so an
             enchanter picks its heal or shield, a carry its damage. Win rate boost = BETA x
             (start gain + LEVEL18_SHARE x level 18 gain): the start pick counts all game, the level 18 one
             for the part of a fight-heavy game played at 18 (about a third).
  destiny    Weapon of Destiny makes the first Legendary item the Weapon: each takedown adds 200 gold of its
             own stats (data/estimates/weapon_of_destiny.json). Candidates are the Legendary items the champion
             buys first in real core builds (5%+ of them; every Legendary item Mayhem sells counts as a first
             item, so a build that starts with Hubris isn't credited to its second) and the ones in its popular
             build. Each is put in the
             popular build, then upgraded with half the champion's takedowns per game (estimated kills + assists:
             the augment comes mid-game). Score = sim gain of the upgrade, turned into win-rate points (BETA),
             plus the item's real win rate as a first item for this champion minus its average first item.
  augments   Real part: each augment's estimated win rate on this champion (estimates.json's model: the feed's
             per-champion grade and the augment's fair win rate) minus the champion's own, trusted less when
             rarely picked on the champion (x pick / (pick + PICK_PRIOR)) and when the overall feed barely has the
             augment (real_lift: about a dozen live augments sit near 0 picks there). These add up on the logit scale, which assumes no
             synergy. Synergy part: the Simulator runs the popular build with each augment alone, with pairs and
             with the best candidate sets of 4. Synergy = gain of the set minus the gains of its augments one by
             one: positive when they feed each other (crit + crit damage, haste + on-cast), negative when they
             overlap (two stat caps, two shields that never stack). It's turned into win-rate points with BETA,
             fitted across all champions as the slope of real lift on single-augment sim gain, on augments that
             only add stats (fit_beta).
             Score of a set = sum of real lifts + BETA x synergy, the synergy part squashed softly toward
             +-3 points (SYNERGY_CAP). "Theoretical": it ignores which rarities the
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
LEVEL18_SHARE = 0.35  # share of a game's fights played at level 18, for the level 18 Empower's boost
STAGES = {
    "early": (2, 1, "level=8,enemy_level=8,fixed_target=1,target_hp=1900,target_armor=55,target_mr=42"),
    "mid": (4, 2, "level=13,enemy_level=13,fixed_target=1,target_hp=3300,target_armor=95,target_mr=65"),
    "late": (6, 4, "level=18,enemy_level=18"),
}
LATE = STAGES["late"][2]
# Per role: healing + shielding and crowd control worth (against damage at 1), and how much staying alive counts.
ROLE_WEIGHTS = {
    "marksman": (0.25, 0.25, 0.25), "mage": (0.3, 0.4, 0.25), "assassin": (0.25, 0.25, 0.25),
    "fighter": (0.5, 0.5, 0.4), "tank": (0.8, 1.0, 0.6), "support": (1.0, 1.0, 0.5),
}
PICK_PRIOR = 0.01
GLOBAL_PRIOR = 0.005  # an augment's overall pick rate at which its real data counts half (real_lift)
SYNERGY_CAP = 3.0  # win-rate points; synergy is squashed softly toward this (synergy_points)
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
    out = {k: s.get(k, 0) for k in ("mean_dps", "healing", "shielding", "cc_seconds", "cc_hard_seconds", "time_alive")}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f)
    return out


def value(s, role, ref_dps):
    """Damage-equivalent per second alive of a sim summary."""
    wh, wc, _ = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))
    alive = max(s["time_alive"], 1.0)
    return s["mean_dps"] + (wh * (s["healing"] + s["shielding"]) + wc * ref_dps * s["cc_seconds"]) / alive


def gain(base, new, role):
    """log(value with / without), plus staying alive longer at the role's weight (fights run until the champion
    goes down)."""
    ref = max(base["mean_dps"], 1.0)
    b, n = value(base, role, ref), value(new, role, ref)
    ws = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))[2]
    alive = math.log(max(new["time_alive"], 0.1) / max(base["time_alive"], 0.1))
    return math.log(max(n, 1e-6) / max(b, 1e-6)) + ws * alive


SIM_ITEMS = load_json(os.path.join(SIM, "data", "items.json"))["items"]
KITS = {c["id"]: c for c in load_json(os.path.join(SIM, "data", "champions.json"))["champions"]}
TEAM = {k: v for k, v in load_json(os.path.join(cm.HERE, "pentakill_team.json")).items() if not k.startswith("_")}
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

STAGE_LEVEL = {"early": 8, "mid": 13, "late": 18}
EFFECTIVE = 0.7  # share of healing and shielding that counts: the rest is overhealing or lands on a full-health ally
AMP, HASTE = 0.10, 20  # what an Empower adds to its ability: 10% more damage, healing and shielding; 20 ability haste
# Healing and shielding also keep their target fighting longer. In the simulator that is worth about 0.8 times the
# healing itself (median over the tanks' and supports' Empowers that change their own healing), so healing and
# shielding the simulator can't see count 1.8 times.
KEEP_ALIVE = 0.8


def build_stats(champ, items, level):
    """The stats a heal or shield scales with, from the champion's base stats and its items."""
    kit = KITS[champ]
    st = kit["stats"]
    n = level - 1
    grow = lambda base, per: base + per * n * (0.7025 + 0.0175 * n)  # noqa: E731
    bonus = {}
    for i in items:
        for k, v in (SIM_ITEMS.get(i, {}).get("stats") or {}).items():
            bonus[k] = bonus.get(k, 0) + v
    hp = grow(st["hp"], st["hp_per_level"])
    return {"ap": bonus.get("ap", 0), "bonus_ad": bonus.get("ad", 0), "ad": grow(st["ad"], st["ad_per_level"]) + bonus.get("ad", 0),
            "bonus_hp": bonus.get("hp", 0), "hp": hp + bonus.get("hp", 0), "ah": kit["mayhem"].get("ability_haste", 0) + bonus.get("ah", 0)}


def amount(scaling, stats):
    return sum(v if k == "const" else v * stats.get(k, 0) for k, v in (scaling or {}).items())


def team_extra(champ, role, slot, items, stage, cc_ref):
    """What Empowering `slot` adds per second that the simulator can't see, in the same damage-equivalent units as
    value(): healing and shielding on allies (pentakill_team.json), team utility counted as crowd control seconds,
    and in the training-dummy stages (nobody hits back, so heals and shields there count nothing) the champion's own
    heals and shields. More casts from the haste, and 10% more healing and shielding per cast."""
    kit = KITS[champ]
    ab = next((a for a in kit["abilities"] if a["slot"] == slot), None)
    team = TEAM.get(champ, {}).get(slot, {})
    ab = ab or {}  # the kit leaves out abilities that deal no damage (Rakan E, Shen R); the table gives their cooldown
    cooldown = ab.get("cooldown") or team.get("cooldown")
    if not cooldown or ab.get("no_haste"):
        return 0.0
    stats = build_stats(champ, items, STAGE_LEVEL[stage])
    rate = (100 + stats["ah"]) / (100 * cooldown)
    rate_up = (100 + stats["ah"] + HASTE) / (100 * cooldown)
    wh, wc, _ = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))
    mode = kit.get("mayhem", {})
    per_cast = 0.0
    for kind, mod in (("heal", "healing"), ("shield", "shielding")):
        own = (ab.get(kind) or {}).get("scaling")
        reach = team.get("allies", 0) * bool(team.get(kind) or own) + (1 if own and stage != "late" else 0)
        per_cast += amount(team.get(kind) or own, stats) * reach * mode.get(mod, 1.0)
    out = wh * EFFECTIVE * (1 + KEEP_ALIVE) * per_cast * ((1 + AMP) * rate_up - rate)
    return out + wc * cc_ref * team.get("util", 0) * (rate_up - rate)


def team_value(s, role, ref):
    """value() for a team fight: crowd control counted by strength (a slow by its amount) and each second of it worth
    `ref`."""
    wh, wc, _ = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))
    alive = max(s["time_alive"], 1.0)
    return s["mean_dps"] + (wh * (s["healing"] + s["shielding"]) + wc * ref * s["cc_hard_seconds"]) / alive


def team_gain(base, new, role, cc_ref, extra):
    """gain() for a team fight: a second of crowd control is worth at least an average champion's damage per second
    (it stops that enemy and the whole team hits them), plus team_extra on top of the simulated value."""
    ref = max(base["mean_dps"], cc_ref, 1.0)
    b, n = team_value(base, role, ref), team_value(new, role, ref) + extra
    ws = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))[2]
    alive = math.log(max(new["time_alive"], 0.1) / max(base["time_alive"], 0.1))
    return math.log(max(n, 1e-6) / max(b, 1e-6)) + ws * alive


def pentakill_bases(e):
    """The champion's plain build at each stage (the reference for CC_REF)."""
    items, augs = legal(e["build"]["items"]), e["build"]["augments"]
    return {st: sim(e["id"], items[:n_i], augs[:n_a], settings)["mean_dps"] for st, (n_i, n_a, settings) in STAGES.items()}


def pentakill(e, cc_ref):
    champ, role = e["id"], e["role"]
    items, augs = legal(e["build"]["items"]), e["build"]["augments"]
    stage_gain = {}
    for stage, (n_items, n_augs, settings) in STAGES.items():
        it, au = items[:n_items], augs[:n_augs]
        base = sim(champ, it, au, settings)
        stage_gain[stage] = {s: team_gain(base, sim(champ, it, au + [EMPOWER[s]], settings), role, cc_ref[stage],
                                          team_extra(champ, role, s, it, stage, cc_ref[stage])) for s in "QWE"}
    start_score = {s: statistics.mean(stage_gain[st][s] for st in STAGES) for s in "QWE"}
    first = max("QWE", key=lambda s: start_score[s])
    with_first = sim(champ, items, augs + [EMPOWER[first]], LATE)
    late = {s: team_gain(with_first, sim(champ, items, augs + [EMPOWER[first], EMPOWER[s]], LATE), role, cc_ref["late"],
                         team_extra(champ, role, s, items, "late", cc_ref["late"]))
            for s in "QWER" if s != first}
    second = max(late, key=lambda s: late[s])
    pct = lambda g: round(100 * (math.exp(g) - 1), 2)
    return {
        "start": first, "level18": second,
        "start_options": {s: {"score": pct(start_score[s]), **{st: pct(stage_gain[st][s]) for st in STAGES}} for s in "QWE"},
        "level18_options": {s: pct(g) for s, g in late.items()},
        "gain": round(pct(start_score[first]) + pct(late[second]), 2),
    }


def pentakill_boost(pk, beta):
    """Estimated win rate points from both Empowers: their sim gains (log scale) turned into points with BETA."""
    g = lambda pct: math.log(1 + pct / 100)
    start, late = g(pk["start_options"][pk["start"]]["score"]), g(pk["level18_options"][pk["level18"]])
    return round(100 * beta * (start + LEVEL18_SHARE * late), 2)


# ---------------------------------------------------------------- Weapon of Destiny

def destiny(e, ctx, beta):
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    items = legal(e["build"]["items"])
    legendary_keys = ctx["legendary"]
    firsts = wod.first_legendary(ctx["builds"].get(cid, {}), ctx["shop_legendary"])
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

def real_lift(champ_wr, dev, grade, global_pick, model):
    """Estimated win rate of an augment on a champion minus the champion's own (estimates.json's model,
    common.augment_win_rate), with the augment's part trusted only as far as the overall feed backs it: a dozen
    live augments have almost no picks there (pick rate ~0), so their fair win rate is noise."""
    trust = global_pick / (global_pick + GLOBAL_PRIOR)
    z = cm.logit(champ_wr) + trust * (model["lambda"] * cm.logit(0.5 + dev) + model["grade"].get(grade or "", 0.0))
    return cm.sigmoid(z) - champ_wr


def augment_singles(e, ctx):
    """Real lift and sim gain of every candidate augment on its own (for the shortlist and BETA)."""
    champ, role, cid = e["id"], e["role"], str(e["champion_id"])
    items = legal(e["build"]["items"])
    pool = set(ctx["pools"].get(cid, []))
    rows = {}
    champ_wr = ctx["stats"].get(cid, {}).get("win_rate")
    for r in ctx["builds"].get(cid, {}).get("augments", {}).get("all", []):
        key, aid = ctx["aug_key"].get(r["id"]), str(r["id"])
        if not key or key not in pool or r["id"] in ctx["selection"] or champ_wr is None or aid not in ctx["dev"]:
            continue
        lift = real_lift(champ_wr, ctx["dev"][aid], r.get("grade"), ctx["global_pick"].get(aid, 0.0), ctx["model"])
        rows[key] = {"id": r["id"], "lift": lift, "pick": r["pick_rate"],
                     "real": lift * r["pick_rate"] / (r["pick_rate"] + PICK_PRIOR),
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
        scored.append((real + synergy_points(beta * syn), real, syn, ks))
    scored.sort(key=lambda t: -t[0])

    def row(t):
        score, real, syn, ks = t
        ks = sorted(ks, key=lambda k: -singles[k]["real"])
        return {"augments": [singles[k]["id"] for k in ks], "keys": ks,
                "score": round(100 * score, 2), "real": round(100 * real, 2),
                "synergy": round(100 * synergy_points(beta * syn), 2),
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


def synergy_points(x):
    """Synergy in win-rate units, squashed softly toward +-SYNERGY_CAP points: the sim's biggest interactions
    (revives, survival loops on tanks) are where it's least reliable, and one set shouldn't outweigh all the real data."""
    cap = SYNERGY_CAP / 100
    return cap * math.tanh(x / cap)


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
    pool = [e for e in enemies if len(legal(e["build"]["items"])) >= 4 and e["build"].get("augments")]
    if args.only:
        keep = set(args.only.split(","))
        enemies = [e for e in enemies if e["id"] in keep or e["name"] in keep]
    enemies = [e for e in enemies if len(legal(e["build"]["items"])) >= 4 and e["build"].get("augments")]

    sim_items = load_json(os.path.join(SIM, "data", "items.json"))["items"]
    sim_augs = load_json(os.path.join(SIM, "data", "augments.json"))["augments"]
    wod_data = load_json(os.path.join(cm.HERE, "weapon_of_destiny.json"))["items"]
    key_to_id = {k: v["id"] for k, v in sim_items.items()}
    leg = {k: v["id"] for k, v in sim_items.items() if v.get("slot") == "legendary"}
    stats, builds = cm.champion_stats(), cm.builds()
    groups = cm.load(os.path.join(cm.REPO, "web", "src", "data", "item-groups.json"))
    dev, _ = cm.augment_on_champion(stats, builds, cm.fair_augments())
    ctx = {
        "builds": builds,
        "profiles": cm.load(os.path.join(cm.HERE, "estimates.json"))["profiles"],
        "stats": stats, "dev": dev, "model": cm.load(os.path.join(cm.HERE, "fitted.json"))["augment_model"],
        "global_pick": {str(a["augment_id"]): a["pick_rate"] for a in cm.load(os.path.join(cm.CN, "augments.json"))["augments"]},
        "legendary": set(leg), "leg_ids": leg, "key_to_id": key_to_id,
        "id_to_key": {v: k for k, v in leg.items()},
        # Every Legendary item Mayhem's shop sells, the simulator's or not (Hubris, Rite of Ruin), so a core build that
        # starts with one isn't credited to its second item.
        "shop_legendary": set(leg.values()) | {int(k) for k, g in groups.items() if g.get("e") == 5 and g.get("m") == 1},
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
        bases = [b for b in ex.map(lambda e: safe(pentakill_bases, e), pool) if b]
        cc_ref = {st: statistics.median(b[st] for b in bases) for st in STAGES}
        pk = dict(zip([e["id"] for e in enemies], ex.map(lambda e: safe(pentakill, e, cc_ref), enemies)))
        for v in pk.values():
            if v:
                v["boost"] = pentakill_boost(v, beta)
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
                   "takedown_share": TAKEDOWN_SHARE, "level18_share": LEVEL18_SHARE, "first_share": FIRST_SHARE},
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
