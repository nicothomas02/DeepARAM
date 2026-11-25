#!/usr/bin/env python3
"""Synergy catalog (Nico 2026-11-25: "make sure each augment, item, and champ is individually looked at").

Every augment is tagged by hand in synergy_catalog_augments.json with what it gives and what it uses. A chain is a
`gives` tag of one augment feeding a `uses` tag of another (CHAINS below, each with the reason shown on the site).
For every chain pair not yet in augment_synergy_rules.json this prints the archive interaction test (within champion:
(both - first only) - (second only - neither), on team damage share and win), so a pair can be added when its
mechanics hold and neither metric leans worse by 2 SE.

Run: python3 data/estimates/synergy_catalog.py <archive-players.json> <archive-damage.json> [--json out.json] [--items items-out.json]
(--items: the same chains between augments and the finished items in synergy_catalog_items.json, both directions.)
"""
import collections, json, math, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
# (gives tag, uses tag, reason). Crit chains are left out on purpose: crit-chance pairs tested worse (synergy hunt
# pass 1, Soul Siphon + Upgrade IE -3.3 +/- 1.0), so "more crit" is not treated as a chain. For the same reason plain
# attack speed x per-attack augments and plain ability haste x after-cast augments are left out ("more of a stat" is
# not a chain; Deft + Tap Dancer and Pursuit of Haste + Archmage tested worse): only refunds and resets count as extra
# casts (ONLY below), and RISE recasts are left out because the wiki doesn't say they count as Ultimate casts.
CHAINS = [
    ("onhit", "onhit", "Its extra hits apply on-hit effects, so the other augment triggers more often."),
    ("haste_stat", "haste_stat", "Its Ability Haste feeds the other augment, which scales with Ability Haste."),
    ("casts", "casts", "Its extra casts empower more of the other augment's attacks."),
    ("ult_haste", "ult_casts", "More Ultimate casts trigger the other augment more often."),
    ("move_speed", "move_speed", "Its Move Speed feeds the other augment's bonus."),
    ("dash", "dash", "More dashes, so the dash effects trigger more often."),
    ("stealth", "stealth", "Leaving stealth triggers the other augment."),
    ("immobilize", "immobilize", "Its immobilize triggers the other augment."),
    ("slow", "slow", "Its slow gets Ice Cold's extra slow."),
    ("healing", "healing", "Its healing feeds the other augment, which triggers on heals."),
    ("shield", "shield", "Its shields trigger the other augment."),
    ("hs_power", "hs_power", "Its stronger heals and shields feed the other augment, which scales with them."),
    ("ally_hs", "ally_hs", "It heals or shields more allies, so the other augment triggers more often."),
    ("health", "health", "Its bonus Health feeds the other augment, which scales with Health."),
    ("armor", "armor", "Its bonus Armor feeds the other augment, which scales with it."),
    ("magic_resist", "magic_resist", "Its bonus Magic Resist feeds the other augment, which scales with it."),
    ("range", "range", "Its attack range lets more attacks land from far enough for the other augment."),
    ("burn", "burn", "Its burn feeds the other augment."),
]


# consumers a chain leaves out: CRIMSON COBALT and Sap Magic pay off once on a timer or a mark, not per attack, and
# Shrink Ray only refreshes a debuff, so more attacks or extra on-hit hits add little
ONLY = {"casts": {"Archmage", "Ultimate Awakening", "Mystic Punch", "Skilled Sniper", "Overloaded"}}
SKIP = {"onhit": {"CRIMSON COBALT", "Sap Magic"}, "attack_speed": {"CRIMSON COBALT", "Sap Magic", "Shrink Ray"}}
# reasons already written (and translated) for these consumers
WHY = {"Circle of Death": "Its healing also deals damage with Circle of Death.",
       "With Haste": "Its Ability Haste also becomes Move Speed with With Haste.",
       "Don't Blink": "Its movement speed widens the gap Don't Blink turns into damage.",
       "Gift of the Drowned": "Its bonus Health becomes Lethality with Gift of the Drowned."}
WHY.update({("casts", b): "Its extra casts trigger the other augment more often." for b in ("Archmage", "Double Time", "Master of Duality", "Overloaded")})


def load():
    cat = json.load(open(os.path.join(ROOT, "data/estimates/synergy_catalog_augments.json")))["augments"]
    sim = json.load(open(os.path.join(ROOT, "simulator/data/augments.json")))["augments"]
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    by = {norm(v["name"]): k for k, v in sim.items()}
    key = {n: by[norm(n)] for n in cat if norm(n) in by}  # augments the simulator has no key for can't carry a rule
    rules = json.load(open(os.path.join(ROOT, "data/estimates/augment_synergy_rules.json")))["pairs"]
    have = {frozenset((p["a"], p["b"])) for p in rules}
    return cat, key, have


def candidates(cat, key, have):
    out, seen = [], set()
    for g, u, why in CHAINS:
        for a, ea in cat.items():
            if g not in ea.get("gives", []) or (g in ONLY and a not in ONLY[g]):
                continue
            for b, eb in cat.items():
                if a == b or u not in eb.get("uses", []) or a not in key or b not in key or b in SKIP.get(g, ()):
                    continue
                p = frozenset((key[a], key[b]))
                if p in have or p in seen:
                    continue
                seen.add(p)
                out.append({"chain": f"{g} -> {u}", "a": a, "b": b, "ka": key[a], "kb": key[b], "why": WHY.get((g, b), WHY.get(b, why))})
    return out


def item_candidates(cat):
    """Augment x item chains both ways (item gives -> augment uses, augment gives -> item uses), same CHAINS/ONLY/SKIP."""
    items = json.load(open(os.path.join(ROOT, "data/estimates/synergy_catalog_items.json")))["items"]
    tips = {(p["augment"], p["item"]) for p in json.load(open(os.path.join(ROOT, "web/src/data/augment-items.json")))["pairs"]}
    names = json.load(open(os.path.join(ROOT, "web/src/data/augment-names.json")))
    aid = {}
    for i, n in names.items():
        aid.setdefault(n, int(i))
    out = []
    for g, u, why in CHAINS:
        for iid, it in items.items():
            for a, ea in cat.items():
                if g in it["gives"] and u in ea.get("uses", []) and a not in SKIP.get(g, ()):
                    out.append({"chain": f"{g} -> {u}", "dir": "item feeds augment", "item": int(iid), "itemName": it["name"], "a": a, "tip": (aid.get(a), int(iid)) in tips})
                if g in ea.get("gives", []) and u in it["uses"] and (g not in ONLY or a in ONLY[g]):
                    out.append({"chain": f"{g} -> {u}", "dir": "augment feeds item", "item": int(iid), "itemName": it["name"], "a": a, "tip": (aid.get(a), int(iid)) in tips})
    return out


def tester(players, damage):
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

    for p in P:
        p["aug"] = p["aug"] | {-i for i in p["items_in_order"]}  # built items ride along as negative ids

    def test(a, b):
        A, B = ids[a], ({-b} if isinstance(b, int) else ids[b])
        return {"both": sum(1 for p in P if p["aug"] & A and p["aug"] & B), "share": inter(A, B, "share"), "win": inter(A, B, "win")}
    return test


def main(argv):
    cat, key, have = load()
    cands = candidates(cat, key, have)
    test = tester(argv[0], argv[1])
    f = lambda r: f"{r[0]:+.1f} ± {r[1]:.1f} (n {r[2]})" if r else "too few"
    print("| Chain | Pair | Games with both | Damage share (pts) | Win (pts) |\n|---|---|---|---|---|")
    for c in cands:
        c.update(test(c["a"], c["b"]))
        c["worse"] = any(r and r[2] >= 5 and r[0] + 2 * r[1] < 0 for r in (c["share"], c["win"]))
        print(f"| {c['chain']} | {c['a']} + {c['b']} | {c['both']} | {f(c['share'])} | {f(c['win'])} |{' worse' if c['worse'] else ''}")
    if "--json" in argv:
        json.dump(cands, open(argv[argv.index("--json") + 1], "w"), indent=1)
    if "--items" in argv:
        ic = item_candidates(cat)
        print("\n| Chain | Direction | Augment + item | Games with both | Damage share (pts) | Win (pts) | Already a tip |\n|---|---|---|---|---|---|---|")
        for c in ic:
            c.update(test(c["a"], c["item"]))
            c["worse"] = any(r and r[2] >= 5 and r[0] + 2 * r[1] < 0 for r in (c["share"], c["win"]))
            c["better"] = any(r and r[2] >= 5 and r[0] - 2 * r[1] > 0 for r in (c["share"], c["win"]))
            print(f"| {c['chain']} | {c['dir']} | {c['a']} + {c['itemName']} | {c['both']} | {f(c['share'])} | {f(c['win'])} | {'yes' if c['tip'] else 'no'} |")
        json.dump(ic, open(argv[argv.index("--items") + 1], "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
