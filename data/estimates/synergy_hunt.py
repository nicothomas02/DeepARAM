#!/usr/bin/env python3
"""Synergy hunt (Nico 2026-11-25, "keep looking for synergies like Tap Dancer + Runaan's + Don't Blink").

Augment chains where one piece feeds another, by mechanism read from the augments' own text:
  on-hit   augments that add on-hit applications (Typhoon, Dual Wield, Double Tap, Ethereal Weapon) x augments that
           stack or deal damage per on-hit (Tap Dancer, Light 'em Up!, Third Times the Harm, ...). Precedent:
           Ethereal Weapon's ability on-hits trigger Mystic Punch's "basic attacks on-hit" (Nico, confirmed).
  speed    augments that give lasting or burst movement speed x Don't Blink (damage per 10 movement speed over the
           target).
  crit     crit-chance augments x augments that trigger on crits (listed, not added: "more crit" is not a chain).
Pairs already in augment_synergy_rules.json are skipped. Each candidate is tested in the archive, within champion:
interaction contrast (both - first only) - (second only - neither) on team damage share and win.
A pair is added (points 1, estimated) when the mechanics hold and neither metric leans worse by 2 SE.

Run: python3 data/estimates/synergy_hunt.py <archive-players.json> <archive-damage.json>
"""
import collections, json, math, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
ONHIT_PROD = ["Typhoon", "Dual Wield", "Double Tap", "Ethereal Weapon"]
ONHIT_CONS = ["Tap Dancer", "Light 'em Up!", "Third Times the Harm", "Take'em Down Down Down", "Master of Duality", "Hellbent",
              "Juiced", "Marksmage", "Heavy Hitter", "Firebrand", "Mystic Punch", "Tickle Monster", "Shrink Ray", "Reload"]
MS_PROD = ["Tap Dancer", "Leg Day", "With Haste", "Homeguard", "Shadow Runner", "Giant Slayer", "Draw Your Sword", "Shrink Engine",
           "Prom Queen", "Kill Secured", "Final Form", "It's Go Time", "Get Excited", "Goldrend", "Sound Barrier", "Wee Woo Wee Woo"]
MS_CONS = ["Don't Blink"]
CRIT_PROD = ["It's Critical", "Zealot", "Critical Healing", "Critical Rhythm", "Double Tap", "Jeweled Gauntlet", "Soul Siphon", "Vulnerability", "Twin Fire"]
CRIT_CONS = ["Critical Rhythm", "Double Tap", "Soul Siphon", "Twin Fire", "Critical Healing", "Upgrade Infinity Edge"]
# pass 2 (2026-11-25): heal/shield power x augments that scale with or trigger on heals and shields; shields gained x
# Mighty Shield; extra ability casts (Archmage refunds, ultimate resets) x "after casting an ability" empowered attacks
HSP_PROD = ["Back to Basics", "Protein Shake", "Overflow", "Empyrean Promise", "Critical Healing", "Bolstered"]
HSP_CONS = ["Circle of Death", "Spirit Bomb", "Sound Barrier"]
SHIELD_PROD = ["Big Brain", "Blue Barrier", "Courage of the Colossus", "Escape Plan", "Final Form", "Swift and Safe", "Don't Change the Channel", "Bolstered"]
SHIELD_CONS = ["Mighty Shield", "Sound Barrier", "Spirit Bomb"]
CAST_PROD = ["Archmage", "Ultimate Awakening"]
CAST_CONS = ["Armored Impact", "Bouncing Bees", "The Boom and the Bass", "Sap Magic"]
CHAINS = [("on-hit", ONHIT_PROD, ONHIT_CONS), ("speed", MS_PROD, MS_CONS), ("crit", CRIT_PROD, CRIT_CONS),
          ("heal power", HSP_PROD, HSP_CONS), ("shield", SHIELD_PROD, SHIELD_CONS), ("cast", CAST_PROD, CAST_CONS)]
KEYS = {"Take'em Down Down Down": "takeem_down_down_down", "Light 'em Up!": "light_em_up"}
key = lambda n: KEYS.get(n, re.sub(r"[^a-z0-9]+", "_", n.lower().replace("'", "")).strip("_"))


def main(players, damage):
    rules = json.load(open(os.path.join(ROOT, "data/estimates/augment_synergy_rules.json")))["pairs"]
    have = {frozenset((p["a"], p["b"])) for p in rules}
    names = json.load(open(os.path.join(ROOT, "web/src/data/augment-names.json")))
    ids = collections.defaultdict(set)
    for i, n in names.items():
        ids[n].add(int(i))
    P = [p for p in json.load(open(players)) if "items_in_order" in p]
    D = {(d["game"], d["champion_id"]): d for d in json.load(open(damage))}
    team = collections.defaultdict(float)
    for p in P:
        d = D.get((p["game"], p["champion_id"]))
        p["dmg"] = d["physical"] + d["magic"] + d["true"] if d else None
        if p["dmg"] is not None:
            team[(p["game"], p["side"])] += p["dmg"]
    by = collections.defaultdict(list)
    for p in P:
        t = team[(p["game"], p["side"])]
        p["share"] = p["dmg"] / t if p["dmg"] and t else None
        p["win"], p["aug"] = float(p["win"]), set(p["augments"])
        by[p["champion_id"]].append(p)
    m = lambda x: sum(x) / len(x)
    v = lambda x: sum((y - m(x)) ** 2 for y in x) / (len(x) - 1) / len(x) if len(x) > 1 else 0.0004

    def inter(A, B, metric):
        num = den = var = 0.0
        for ps in by.values():
            g = {k: [p[metric] for p in ps if p[metric] is not None and (bool(p["aug"] & A), bool(p["aug"] & B)) == k] for k in [(1, 1), (1, 0), (0, 1), (0, 0)]}
            if not g[(1, 1)] or min(len(g[(1, 0)]), len(g[(0, 1)]), len(g[(0, 0)])) < 3:
                continue
            w = len(g[(1, 1)])
            num += w * ((m(g[(1, 1)]) - m(g[(1, 0)])) - (m(g[(0, 1)]) - m(g[(0, 0)])))
            var += w * w * sum(v(x) for x in g.values()); den += w
        return (round(100 * num / den, 1), round(100 * math.sqrt(var) / den, 1), int(den)) if den else None

    print("| Kind | Pair | Games with both | Damage share (pts) | Win (pts) | Covered |")
    print("|---|---|---|---|---|---|")
    for kind, prod, cons in CHAINS:
        for a in prod:
            for b in cons:
                if a == b or (kind == "crit" and b in CRIT_PROD and prod.index(a) > prod.index(b) if b in prod else False):
                    continue
                A, B = ids[a], ids[b]
                both = sum(1 for p in P if p["aug"] & A and p["aug"] & B)
                s, w = inter(A, B, "share"), inter(A, B, "win")
                f = lambda r: f"{r[0]:+.1f} ± {r[1]:.1f} (n {r[2]})" if r else "too few"
                print(f"| {kind} | {a} + {b} | {both} | {f(s)} | {f(w)} | {'yes' if frozenset((key(a), key(b))) in have else 'no'} |")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
