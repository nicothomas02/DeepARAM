#!/usr/bin/env python3
"""Headliner picks and band mission helpers (headliners.json) for the Tier List's Headliners tab.

Set 3 of Mayhem (live from 26.21) gives every game one Headliner. This script writes, per Headliner,
the champions it suits best, and for the Pentakill Headliner the ability to Empower on every champion:

  pentakill   Simulated. Each champion's most popular real build (simulator/data/cn_enemy_pool.json)
              runs with HEAVY / POWER / THRASH (Q / W / E: 20 haste, 10% more damage, healing and
              shielding) at two points: early (level 8, 2 items, 1 augment, level-matched dummy) and
              late (level 18, full build, 4 augments, real enemies). The start pick is the basic ability
              with the best average gain; at level 18 the remaining abilities, the ultimate included
              (DOOM), are tried on top of it.
  others      Estimated from data/estimates/estimates.json (champion profiles and per-champion augment
              win rates), each with the reason it fits the Headliner's rule.
  missions    The band missions in the client's Mayhem hub, with the champions most likely to finish
              each one in a game (estimated per-game totals from the same profiles and the champion kits
              the Simulator reads). Missions any champion can do get a tip instead.

Usage: python3 data/estimates/headliners.py   (needs `make -C simulator mayhem_sim`; standard library only)
       python3 data/estimates/headliners.py --no-sim   (reuse the last Pentakill results)
"""

import json
import os
import statistics
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import common as cm

SIM = os.path.join(cm.REPO, "simulator")
OUT = os.path.join(cm.HERE, "headliners.json")
TRIALS = {"early": 3000, "late": 8000}
EMPOWER = {"Q": "heavy", "W": "power", "E": "thrash", "R": "doom"}
EARLY = "level=8,enemy_level=8,fixed_target=1,target_hp=1900,target_armor=55,target_mr=42"
LATE = "level=18,enemy_level=18"
TOP = 10
COMBAT = 0.3


def sim(champ, items, augs, settings):
    trials = TRIALS["early" if settings == EARLY else "late"]
    cmd = [os.path.join(SIM, "mayhem_sim"), "--champ", champ, "--items", ",".join(items), "--set", settings,
           "--json", "--trials", str(trials), "--threads", "1", "--seed", "26"]
    if augs:
        cmd += ["--augs", ",".join(augs)]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
    if r.returncode:
        raise RuntimeError(f"{champ}: {r.stderr.strip()}")
    s = json.loads(r.stdout)["builds"][0]["summary"]
    return s["mean_dps"], s.get("healing", 0) + s.get("shielding", 0)


def gain(base, new):
    """Damage gain in %, or healing and shielding gain when the damage barely moves (support kits)."""
    d = 100 * (new[0] / base[0] - 1) if base[0] > 0 else 0.0
    h = 100 * (new[1] / base[1] - 1) if base[1] > 0 else 0.0
    return d, h


def pentakill_one(e):
    try:
        return e["champion_id"], pentakill_champ(e)
    except RuntimeError as err:
        print("skipped", err, file=sys.stderr)
        return e["champion_id"], None


GROUPS = {k: v["group"] for k, v in cm.load(os.path.join(SIM, "data", "items.json"))["items"].items() if v.get("group")}


def legal(items):
    """Drop an item that shares a group (Last Whisper, Hydra...) with an earlier one; the game forbids both."""
    seen, out = set(), []
    for i in items:
        g = GROUPS.get(i)
        if g and g in seen:
            continue
        seen.add(g)
        out.append(i)
    return out


def pentakill_champ(e):
    items, augs = legal(e["build"]["items"]), e["build"]["augments"]
    if len(items) < 2:
        return None
    early_items, early_augs = items[:2], augs[:1]
    base_e = sim(e["id"], early_items, early_augs, EARLY)
    base_l = sim(e["id"], items, augs, LATE)
    start = {}
    for slot in "QWE":
        de, he = gain(base_e, sim(e["id"], early_items, early_augs + [EMPOWER[slot]], EARLY))
        dl, hl = gain(base_l, sim(e["id"], items, augs + [EMPOWER[slot]], LATE))
        start[slot] = {"early": round(de, 2), "late": round(dl, 2), "heal": round(hl, 2), "score": (de + dl) / 2}
    damage_kit = max(v["score"] for v in start.values()) >= 0.5
    key = (lambda s: start[s]["score"]) if damage_kit else (lambda s: start[s]["heal"] + start[s]["score"])
    first = max("QWE", key=key)
    with_first = sim(e["id"], items, augs + [EMPOWER[first]], LATE)
    late = {}
    for slot in "QWER":
        if slot == first:
            continue
        dl, hl = gain(with_first, sim(e["id"], items, augs + [EMPOWER[first], EMPOWER[slot]], LATE))
        late[slot] = {"late": round(dl, 2), "heal": round(hl, 2)}
    lkey = (lambda s: late[s]["late"]) if damage_kit else (lambda s: late[s]["heal"] + late[s]["late"])
    second = max(late, key=lkey)
    for v in start.values():
        v["score"] = round(v["score"], 2)
    return {
        "start": first, "level18": second, "by": "damage" if damage_kit else "healing",
        "start_options": start, "level18_options": late,
        "gain": round(start[first]["score"] + late[second]["late"], 2),
    }


def pentakill(enemies):
    with ThreadPoolExecutor(os.cpu_count() or 2) as ex:
        res = dict(ex.map(pentakill_one, enemies))
    return {str(k): v for k, v in res.items() if v}


def zscores(values):
    vals = [v for v in values.values() if v is not None]
    mu, sd = statistics.mean(vals), statistics.pstdev(vals) or 1
    return {k: (v - mu) / sd for k, v in values.items() if v is not None}


def top(scores, n=TOP, value=None, reverse=True):
    order = sorted(scores, key=lambda k: scores[k], reverse=reverse)[:n]
    return [{"id": int(k), "value": round((value or scores)[k], 3)} for k in order]


def kit_rates(champions):
    """Per champion, from the Simulator's kit: casts per minute of skillshots, long-range spells,
    area abilities, and how many dashes the kit has. Cooldowns at rank with 30 ability haste."""
    out = {}
    for c in champions:
        skill = far = aoe = 0.0
        dashes = 0
        for a in c["abilities"]:
            g = a["geometry"]
            if g.get("move") in ("dash", "blink"):
                dashes += 1
            if not a["hits"] or not a["cooldown"] or a.get("toggle") or a.get("placeholder"):
                continue
            # Casts per minute of fighting: champions fight about COMBAT of a game and can't recast faster than 1.5 s.
            per_min = COMBAT * 60 / max(a["cooldown"] * 100 / 130, 1.5)
            aimed = g["shape"] in ("line", "cone", "circle") and not g["on_self"] and not g.get("move")
            if aimed:
                skill += per_min
            if g["range"] >= 600 and not g["on_self"] and not g.get("move"):
                far += per_min
            if aimed and a["area"] == "aoe":
                aoe += per_min
        out[c["champion_id"]] = {"skillshots": skill, "far": far, "aoe": aoe, "dashes": dashes}
    return out


def build_stats(enemies, items, champions):
    """Bonus Health, AD/AP and attack speed of each champion's popular full build at level 18."""
    base = {c["champion_id"]: c["stats"] for c in champions}
    out = {}
    for e in enemies:
        st = {"hp": 0.0, "ad": 0.0, "ap": 0.0, "as": 0.0}
        for i in legal(e["build"]["items"]):
            for k in st:
                st[k] += items.get(i, {}).get("stats", {}).get(k, 0)
        # Bonus attack speed counts level-ups; bonus Health and AD don't.
        st["as"] += 17 * base.get(e["champion_id"], {}).get("attack_speed_per_level", 0)
        out[e["champion_id"]] = st
    return out


def headliners(est, pk, kit, champs):
    prof = {int(k): v for k, v in est["profiles"].items()}
    ids = [i for i in prof if i in champs]
    p = lambda key: {i: prof[i][key]["value"] for i in ids if key in prof[i]}
    minutes = p("game_minutes")
    aug_tier = {a["augment_id"]: a["tier"] for a in cm.load(os.path.join(cm.CN, "augments.json"))["augments"]}
    out = []
    # Pentakill: biggest total gain from the two Empowers.
    out.append({"id": "Pentakill", "basis": "pentakill",
                "champions": top({int(k): v["gain"] for k, v in pk.items() if int(k) in champs})})
    # K/DA: an extra augment. Champions whose best augments lift their win rate most.
    lifts = {}
    best_aug = {}
    for k, rows in est["augments"].items():
        rows = sorted(rows, key=lambda r: r["lift"], reverse=True)
        if int(k) in champs and rows:
            lifts[int(k)] = statistics.mean(r["lift"] for r in rows[:3])
            best_aug[int(k)] = rows[0]["id"]
    kda = top(lifts)
    for r in kda:
        r["augment"] = best_aug[r["id"]]
    out.append({"id": "KDA", "basis": "extra_augment", "champions": kda})
    # HEARTSTEEL: stronger augments. Champions whose win rate swings most with their augments.
    spread = {}
    for k, rows in est["augments"].items():
        if int(k) in champs and len(rows) >= 5:
            spread[int(k)] = statistics.pstdev(r["win_rate"] for r in rows)
    out.append({"id": "Heartsteel", "basis": "augment_reliance", "champions": top(spread)})
    # Command Line: rerolls into a higher tier. Champions whose Prismatic augments beat their Silver ones most.
    gap = {}
    for k, rows in est["augments"].items():
        by = {t: [r["win_rate"] for r in rows if aug_tier.get(r["id"]) == t] for t in cm.RARITIES}
        if int(k) in champs and by["Silver"] and by["Prismatic"]:
            gap[int(k)] = statistics.mean(by["Prismatic"]) - statistics.mean(by["Silver"])
    out.append({"id": "CommandLine", "basis": "tier_gap", "champions": top(gap)})
    # True Damage: anvils from multi-kills, shutdowns and towers.
    mk, tw = zscores(p("multikills")), zscores(p("turret_damage"))
    td = {i: mk[i] + 0.5 * tw[i] for i in mk if i in tw}
    out.append({"id": "TrueDamage", "basis": "multikills_towers", "champions": top(td, value=p("multikills"))})
    # Disco: 1,000 gold for everyone. Worth the most to champions who are slowest to their third core item.
    third = {int(k): v["minutes"][-1] for k, v in est["item_timing"].items() if int(k) in champs and v.get("minutes")}
    out.append({"id": "Disco", "basis": "slow_core", "champions": top(third)})
    # Cafe Cuties: Health relics restore 20% missing Health. Champions who take a lot and heal little.
    tk, hl = zscores(p("taken_per_min")), zscores(p("heal_per_min"))
    cc = {i: tk[i] - 0.7 * hl[i] for i in tk if i in hl}
    out.append({"id": "CafeCuties", "basis": "relic_value", "champions": top(cc, value=p("taken_per_min"))})
    # Bees: grab Honey (heal, gold) and dodge Bees. Mobile champions who also take a lot of damage.
    dash = {i: kit[i]["dashes"] for i in ids if i in kit}
    bees = {i: dash[i] + 0.5 * tk.get(i, 0) for i in dash}
    out.append({"id": "Bees", "basis": "mobility", "champions": top(bees, value=dash)})
    return out


def missions(est, kit, stats, champs, r_share, self_heal):
    prof = {int(k): v for k, v in est["profiles"].items()}
    ids = [i for i in prof if i in champs]
    v = lambda i, key: prof[i][key]["value"] if key in prof[i] else None
    mins = {i: v(i, "game_minutes") or 17 for i in ids}

    def per_game(f):
        return {i: f(i) for i in ids if f(i) is not None}

    takedowns = per_game(lambda i: (v(i, "kills") or 0) + (v(i, "assists") or 0))
    # Landed share: the Simulator lands about 74% of skillshots.
    skill = per_game(lambda i: kit[i]["skillshots"] * mins[i] * 0.74 if i in kit else None)
    far = per_game(lambda i: kit[i]["far"] * mins[i] * 0.74 if i in kit else None)
    aoe = per_game(lambda i: kit[i]["aoe"] * mins[i] * 0.74 * 0.4 if i in kit else None)
    dash_td = per_game(lambda i: takedowns[i] * min(kit[i]["dashes"], 2) / 2 * 0.5 if i in kit and i in takedowns else None)
    heal = per_game(lambda i: self_heal.get(i))
    cc = per_game(lambda i: v(i, "cc_seconds"))
    hp = per_game(lambda i: stats[i]["hp"] if i in stats else None)
    adap = per_game(lambda i: max(stats[i]["ad"], stats[i]["ap"]) if i in stats else None)
    atk = per_game(lambda i: 100 * stats[i]["as"] if i in stats else None)
    ult = per_game(lambda i: (v(i, "damage_per_min") or 0) * mins[i] * r_share[i] if i in r_share else None)

    hub = cm.load(os.path.join(cm.HERE, "kiwi_hub.json"))
    metric = {
        "takedowns": takedowns, "skillshots": skill, "snipe": far, "dash_takedowns": dash_td, "self_heal": heal,
        "bonus_health": hp, "cc": cc, "bonus_ad_ap": adap, "bonus_as": atk, "ult_damage": ult, "multi_hit": aoe,
    }
    out = []
    for band in hub["bands"]:
        ms = []
        for m in band["missions"]:
            row = dict(m)
            vals = metric.get(m.get("metric"))
            if vals:
                row["champions"] = top(vals)
            ms.append(row)
        out.append({**{k: band[k] for k in band if k != "missions"}, "missions": ms})
    return out


def main():
    est = cm.load(os.path.join(cm.HERE, "estimates.json"))
    pool = cm.load(os.path.join(SIM, "data", "cn_enemy_pool.json"))["enemies"]
    champions = cm.load(os.path.join(SIM, "data", "champions.json"))["champions"]
    items = cm.load(os.path.join(SIM, "data", "items.json"))["items"]
    champs = {c["champion_id"] for c in champions}
    if "--no-sim" in sys.argv and os.path.exists(OUT):
        pk = cm.load(OUT)["pentakill"]
    else:
        pk = pentakill(pool)
    best = cm.load(os.path.join(SIM, "viewer", "replay-data", "best-builds.json"))["champions"]
    key = {c["id"]: c["champion_id"] for c in champions}
    r_share = {key[b["champion"]]: b["summary"]["share_by_source"].get("R", 0) for b in best if b["champion"] in key}
    # Healing a game; supports are left out because most of theirs goes to allies.
    self_heal = {c["champion_id"]: (est["profiles"].get(str(c["champion_id"]), {}).get("heal_per_min", {}).get("value", 0)
                                    * est["profiles"].get(str(c["champion_id"]), {}).get("game_minutes", {}).get("value", 17))
                 for c in champions if c["role"] != "support"}
    kit = kit_rates(champions)
    out = {
        "patch": cm.live_patch(),
        "estimated": True,
        "pentakill": pk,
        "headliners": headliners(est, pk, kit, champs),
        "missions": missions(est, kit, build_stats(pool, items, champions), champs, r_share, self_heal),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"pentakill {len(pk)} champions, {len(out['headliners'])} headliners, {sum(len(b['missions']) for b in out['missions'])} missions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
