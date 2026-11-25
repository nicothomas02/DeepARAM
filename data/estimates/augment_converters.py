"""Converter augments: augments whose own text changes what a stat is worth (ADAPt turns bonus AD into AP, Jeweled
Gauntlet lets abilities crit, Ethereal Weapon makes abilities apply on-hit...). The kit logic says which kind of item
the augment makes worth buying; real lobbies say which of those items its holders actually buy.

Writes web/src/data/augment-converters.json for the build engine (rule `converterItems`):
  augment id -> {name, kind: the Data Dragon tag the augment re-prices, champs: "ap" | "ad" | null (whose builds it
  changes), items: [item ids, most-pulled first], test: archive check}.

Items: the augment's holders build them more than the same champions' players without it (augment-item-shift.json,
shrunk build pull >= 0.05 with z >= 3) and the item carries the re-priced tag.

Test (Nico 2026-11-24: kit rules go on unless data contradicts): within each champion, holders who built a re-priced
item in their first three legendaries vs holders who didn't, minus the same gap among non-holders (difference in
differences, so an item that's simply good on the champion doesn't count). Leading indicator: share of the team's
champion damage; win rate secondary. The rule is on unless either is below zero by more than 1.96 standard errors.

Run by hand: python3 data/estimates/augment_converters.py <archive-players.json> <archive-damage.json>
"""
import collections
import glob
import json
import math
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "web/src/data/augment-converters.json")

# augment ids (both id generations) -> (name, re-priced Data Dragon tag, whose builds it changes, wiki gist)
CONVERTERS = {
    "Ethereal Weapon": ([1029, 29], "OnHit", None, "Your abilities apply on-hit effects."),
    "Jeweled Gauntlet": ([1048, 48], "CriticalStrike", "ap", "Your abilities can critically strike."),
    "ADAPt": ([1205, 205], "Damage", "ap", "Bonus attack damage converts into ability power."),
    "EscAPADe": ([1206, 206], "SpellDamage", "ad", "Ability power converts into bonus attack damage."),
    "Purist - Caster": ([2018], "AttackSpeed", "ap", "Bonus attack speed converts into ability haste."),
    "No Mana, No Problem": ([3059], "Mana", None, "Mana from items converts into ability power."),
    "Big Shot": ([3018], "CriticalStrike", "ad", "Attack speed converts into critical strike damage."),
    "Gift of the Drowned": ([3063], "Health", "ad", "Bonus health converts into lethality."),
    "Double Tap": ([2010], "OnHit", "ad", "Critical strikes apply on-hit effects twice."),
    "Juiced": ([2016], "Mana", "ad", "Basic attacks deal bonus damage from maximum mana."),
    "Tickle Monster": ([3058], "AttackSpeed", "ad", "Bonus attack damage converts into attack speed."),
}
PULL_MIN, PULL_Z = 0.05, 3.0


def main(players_path, damage_path):
    dd = sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/item.json")))[-1]
    items = json.load(open(dd))["data"]
    tag, fin = {}, set()
    for i, it in items.items():
        s = int(i) % 10000
        tag.setdefault(s, set()).update(it.get("tags", []))
        if it.get("gold", {}).get("total", 0) >= 2000 and not it.get("into"):
            fin.add(s)
    shift = json.load(open(os.path.join(ROOT, "web/src/data/augment-item-shift.json")))["pairs"]

    P = [p for p in json.load(open(players_path)) if "items_in_order" in p]
    D = {(d["game"], d["champion_id"]): d for d in json.load(open(damage_path))}
    team = collections.defaultdict(float)
    for p in P:
        d = D.get((p["game"], p["champion_id"]))
        p["dmg"] = d["physical"] + d["magic"] + d["true"] if d else None
        if p["dmg"] is not None:
            team[(p["game"], p["side"])] += p["dmg"]
    lean = collections.defaultdict(lambda: [0, 0])
    for p in P:
        t = team[(p["game"], p["side"])]
        p["share"] = p["dmg"] / t if p["dmg"] is not None and t else None
        p["win"] = 1.0 if p["win"] else 0.0
        p["fin"] = [s % 10000 for s in p["items_in_order"] if s % 10000 in fin and "Boots" not in tag.get(s % 10000, ())][:3]
        p["aug"] = set(p["augments"])
        for s in p["fin"]:
            lean[p["champion_id"]][0] += "SpellDamage" in tag.get(s, ())
            lean[p["champion_id"]][1] += 1
    is_ap = lambda c: lean[c][1] and lean[c][0] / lean[c][1] > 0.5

    out = {}
    for name, (ids, kind, champs, gist) in CONVERTERS.items():
        has = lambda p: any(kind in tag.get(s, ()) for s in p["fin"])
        by = collections.defaultdict(lambda: {"h": [], "n": []})
        for p in P:
            if len(p["fin"]) < 2 or (champs == "ap" and not is_ap(p["champion_id"])) or (champs == "ad" and is_ap(p["champion_id"])):
                continue
            by[p["champion_id"]]["h" if p["aug"] & set(ids) else "n"].append(p)

        def did(metric):
            num = den = var = 0.0
            for g in by.values():
                hs = [p for p in g["h"] if p[metric] is not None]
                ns = [p for p in g["n"] if p[metric] is not None]
                a, b = [p[metric] for p in hs if has(p)], [p[metric] for p in hs if not has(p)]
                c, d = [p[metric] for p in ns if has(p)], [p[metric] for p in ns if not has(p)]
                if min(len(a), len(b)) < 2 or min(len(c), len(d)) < 3:
                    continue
                m = lambda x: sum(x) / len(x)
                v = lambda x: sum((y - m(x)) ** 2 for y in x) / (len(x) - 1) / len(x)
                w = min(len(a), len(b))
                num += w * ((m(a) - m(b)) - (m(c) - m(d)))
                den += w
                var += w * w * (v(a) + v(b) + v(c) + v(d))
            return [round(num / den * 100, 1), round(math.sqrt(var) / den * 100, 1), int(den)] if den else None

        share, win = did("share"), did("win")
        worse = any(r and r[0] < -1.96 * r[1] for r in (share, win))
        pulls = {}
        for a in ids:
            for i, v in shift.get(str(a), {}).items():
                if v[0] >= PULL_MIN and v[4] >= PULL_Z and kind in tag.get(int(i), ()) and int(i) in fin:
                    pulls[int(i)] = max(pulls.get(int(i), 0), v[0])
        holders = sum(len(g["h"]) for g in by.values())
        for a in ids:
            out[str(a)] = {
                "name": name,
                "kind": kind,
                "champs": champs,
                "does": gist,
                "items": [i for i, _ in sorted(pulls.items(), key=lambda kv: -kv[1])],
                "on": not worse,
                "test": {"holders": holders, "damageShare": share, "win": win},
            }
        print(f"{name:22s} on={not worse!s:5s} holders {holders:4d} items {[items.get(str(i), {}).get('name', i) for i in out[str(ids[0])]['items']]} share {share} win {win}")
    json.dump({"about": __doc__.split("\n\n")[0], "pairs": out}, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:3])
