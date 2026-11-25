"""Which augments warrant leaning into: building items that multiply what the augment does (Nico 2026-11-24, e.g.
"does Lich Brain warrant Riftmaker on a mage?").

For every augment with 50+ holders in the archive and every finished item that either
  (kit) carries a stat the augment's own wiki text scales with (Lich Brain: "bonus health" -> Health items), or
  (pull) its holders build clearly more than the same champions' players without it (augment-item-shift z >= 3),
test, within champion (champions of the item's damage type only), holders who built the item in their first three
legendaries vs holders who didn't, minus the same gap among non-holders (difference in differences). Leading indicator:
share of the team's champion damage; win rate secondary.

lean-in (measured): damage share above zero by 3 SE with 15+ matched holders, win not below zero by 3 SE.
lean-in (kit):      kit stat match and the augment's holders build it 3+ pts more (logic and behavior agree), no
                    contradiction (Nico 2026-11-24: kit rules go on unless data contradicts).
contradicted:       damage share or win below zero by 3 SE with 10+ matched holders.
Everything else is neutral.

Run: python3 data/estimates/augment_lean_in.py <archive-players.json> <archive-damage.json>
Writes web/src/data/augment-lean-in.json (engine rule leanIn) and prints a Markdown table.
"""
import collections, glob, json, math, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
KIT = [  # wiki text pattern -> Data Dragon tag of the items that multiply it
    (r"(bonus|maximum|max) health", "Health"),
    (r"ability haste|cooldown", "AbilityHaste"),
    (r"attack speed", "AttackSpeed"),
    (r"critical(ly)? strike", "CriticalStrike"),
    (r"on-hit", "OnHit"),
    (r"\bmana\b", "Mana"),
    (r"omnivamp|life steal|lifesteal", "LifeSteal"),
    (r"omnivamp|spell vamp", "SpellVamp"),
    (r"lethality|armor penetration", "ArmorPenetration"),
    (r"magic penetration", "MagicPenetration"),
    (r"bonus armor|your armor", "Armor"),
    (r"bonus magic resist|your magic resist", "SpellBlock"),
    (r"movement speed", "NonbootsMovement"),
]
AD = {"Damage", "CriticalStrike", "AttackSpeed", "ArmorPenetration"}
AP = {"SpellDamage", "MagicPenetration"}
MIN_HOLDERS = 50
# The augment's own number grows with a stat ("(+ 4% bonus health)"): the clearest case for building that stat.
SCALING = r"\(\+?\s*[\d.]+%?\s*(?:\([^)]*\)\s*)?(?:bonus |maximum |max )?(?:health|armor|magic resist|ability haste|attack speed|critical strike|mana|lethality)"
POS_N, NEG_N = 15, 10  # matched holders needed to call a gain / a contradiction
NEG_WIN_N = 20  # a contradiction on win rate alone needs 20+ (Critical Healing -> Moonstone rested on 10, damage share flat)
FRONT = {"Warden", "Vanguard", "Juggernaut"}  # enemy frontliners (champions/tags.json subclass)
Z = 3.0  # ~600 pair tests: at 1.96 about 15 would cross by luck in each direction, at 3.0 about one
FIT = float(os.environ.get("LEAN_FIT", "0.10"))  # a champion "normally builds" an item: 10%+ of its players without the augment
FIT_MIN = 3  # ...and at least 3 of them (Nico 2026-11-24: losses may come from forcing an item on champions that can't use it)
KIT_PULL = 0.03  # kit pairs also need holders to build the item 3+ pts more (behavior agrees with the logic)


def main(players_path, damage_path):
    items = json.load(open(sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/item.json")))[-1]))["data"]
    tag, fin, name = {}, set(), {}
    for i, it in items.items():
        s = int(i) % 10000
        tag.setdefault(s, set()).update(it.get("tags", []))
        name.setdefault(s, it.get("name", str(s)))
        if it.get("gold", {}).get("total", 0) >= 2000 and not it.get("into") and "Boots" not in it.get("tags", []):
            fin.add(s)
    pure = lambda s: "ad" if tag[s] & AD and not tag[s] & AP else "ap" if tag[s] & AP and not tag[s] & AD else ""
    shift = json.load(open(os.path.join(ROOT, "web/src/data/augment-item-shift.json")))["pairs"]
    names = json.load(open(os.path.join(ROOT, "web/src/data/augment-names.json")))
    wiki = {k.lower(): v for k, v in json.load(open(os.path.join(ROOT, "data/wiki/mayhem_augments.json"))).items()}
    conv = json.load(open(os.path.join(ROOT, "web/src/data/augment-converters.json")))["pairs"]

    P = [p for p in json.load(open(players_path)) if "items_in_order" in p]
    D = {(d["game"], d["champion_id"]): d for d in json.load(open(damage_path))}
    team = collections.defaultdict(float)
    for p in P:
        d = D.get((p["game"], p["champion_id"]))
        p["dmg"] = d["physical"] + d["magic"] + d["true"] if d else None
        if p["dmg"] is not None:
            team[(p["game"], p["side"])] += p["dmg"]
    tags = json.load(open(os.path.join(ROOT, "champions", "tags.json")))["champions"]
    sub = {v["id"]: (v.get("subclasses") or v.get("classes") or ["?"])[0] for v in tags.values()}
    sides = collections.defaultdict(lambda: collections.defaultdict(int))
    for p in P:
        sides[p["game"]][p["side"]] += sub.get(p["champion_id"]) in FRONT
    lean = collections.defaultdict(lambda: [0, 0])
    for p in P:
        p["front"] = sum(n for s, n in sides[p["game"]].items() if s != p["side"])
        t = team[(p["game"], p["side"])]
        p["share"] = p["dmg"] / t if p["dmg"] and t else None
        p["win"] = 1.0 if p["win"] else 0.0
        p["fin"] = set([s % 10000 for s in p["items_in_order"] if s % 10000 in fin][:3])
        p["aug"] = set(p["augments"])
        for s in p["fin"]:
            if pure(s):
                lean[p["champion_id"]][pure(s) == "ap"] += 1
    ctype = lambda c: "ap" if lean[c][1] > lean[c][0] else "ad"
    by_champ = collections.defaultdict(list)
    for p in P:
        if len(p["fin"]) >= 2:
            by_champ[p["champion_id"]].append(p)

    groups = collections.defaultdict(set)  # augment name -> ids
    for a, n in names.items():
        groups[n].add(int(a))

    def did(ids, item, metric, only=lambda p: True):
        num = den = var = 0.0
        want = pure(item)
        for c, ps in by_champ.items():
            if want and ctype(c) != want:
                continue
            n = [p for p in ps if not p["aug"] & ids]
            built = sum(item in p["fin"] for p in n)
            if FIT and (built < FIT_MIN or built < FIT * len(n)):
                continue
            h = [p for p in ps if p["aug"] & ids and p[metric] is not None and only(p)]
            n = [p for p in n if p[metric] is not None and only(p)]
            a = [p[metric] for p in h if item in p["fin"]]; b = [p[metric] for p in h if item not in p["fin"]]
            cc = [p[metric] for p in n if item in p["fin"]]; d = [p[metric] for p in n if item not in p["fin"]]
            if min(len(a), len(b)) < 2 or min(len(cc), len(d)) < 3:
                continue
            m = lambda x: sum(x) / len(x)
            v = lambda x: sum((y - m(x)) ** 2 for y in x) / (len(x) - 1) / len(x)
            w = min(len(a), len(b))
            num += w * ((m(a) - m(b)) - (m(cc) - m(d))); den += w; var += w * w * (v(a) + v(b) + v(cc) + v(d))
        return (num / den, math.sqrt(var) / den, int(den)) if den else None

    rows, out, tests = [], {}, [0]
    for aname, ids in sorted(groups.items()):
        holders = sum(1 for p in P if p["aug"] & ids)
        if holders < MIN_HOLDERS or any(str(i) in conv for i in ids):
            continue
        text = wiki.get(aname.lower(), "")
        kit_tags = {t for pat, t in KIT if re.search(pat, text, re.I)}
        pulls = {}
        for a in ids:
            for i, v in shift.get(str(a), {}).items():
                if int(i) in fin:
                    pulls[int(i)] = max(pulls.get(int(i), -9), v[0]) if v[2] >= 30 else pulls.get(int(i), 0)
        strong = {i for a in ids for i, v in shift.get(str(a), {}).items() if int(i) in fin and v[4] >= 3 and v[0] >= 0.05}
        strong = {int(i) for i in strong}
        cands = set(strong)
        kit_items = sorted((i for i in fin if tag[i] & kit_tags and pulls.get(i, 0) >= 0), key=lambda i: -pulls.get(i, 0))[:4]
        cands |= set(kit_items)
        verdicts = []
        for i in cands:
            s, w = did(ids, i, "share"), did(ids, i, "win")
            pull = pulls.get(i, 0)
            tests[0] += 1
            bad = lambda s, w: bool(s and s[2] >= NEG_N and s[0] < -Z * s[1]) or bool(w and w[2] >= NEG_WIN_N and w[0] < -Z * w[1])
            neg = bad(s, w)
            pos = bool(s and s[2] >= POS_N and s[0] > Z * s[1]) and pull >= 0
            kit = i in kit_items and pull >= KIT_PULL
            v = "contradicted" if neg and (kit or pos or i in strong) else "measured" if pos else "kit" if kit else None
            # Nico 2026-11-24: items like BotRK are best vs high health. If the loss isn't there against 2+ enemy
            # frontliners too, the block only holds against squishier teams.
            tanky = v == "contradicted" and not bad(did(ids, i, "share", lambda p: p["front"] >= 2), did(ids, i, "win", lambda p: p["front"] >= 2))
            if v:
                verdicts.append(("contradicted vs 0-1 frontliners" if tanky else v, i, s, w, i in kit_items, pull))
        lean_items = [x for x in verdicts if x[0] in ("measured", "kit")]
        lean_items.sort(key=lambda x: (x[0] != "measured", -x[5]))
        blocked = sorted(x[1] for x in verdicts if x[0] == "contradicted")
        squishy = sorted(x[1] for x in verdicts if x[0] == "contradicted vs 0-1 frontliners")
        for a in ids:
            if lean_items or blocked or squishy:
                out[str(a)] = {"name": aname, "items": [x[1] for x in lean_items[:3]], "how": lean_items[0][0] if lean_items else None,
                               "kit": sorted(kit_tags), "scaling": bool(re.search(SCALING, text, re.I)), "blocked": blocked, "blockedVsSquishy": squishy}
        fmt = lambda r: "" if not r else f"{r[0]*100:+.1f} ± {r[1]*100:.1f}"
        for v, i, s, w, kit, pull in verdicts:
            rows.append((aname, holders, v, name[i], pure(i) or "any", fmt(s), fmt(w), s[2] if s else 0, f"{pull*100:+.0f}", "kit" if kit else "pull"))
    json.dump({"about": __doc__.split("\n\n")[0], "pairs": out}, open(os.path.join(ROOT, "web/src/data/augment-lean-in.json"), "w"), indent=1)
    order = {"measured": 0, "kit": 1, "contradicted": 2, "contradicted vs 0-1 frontliners": 3}
    print("| Augment | Holders | Verdict | Item | For | Damage share (pts) | Win (pts) | n | Pull | Source |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: (order[r[2]], r[0])):
        print("| " + " | ".join(str(x) for x in r) + " |")
    lean_augs = {v["name"] for v in out.values() if v["items"]}
    print("\nScaling augments (items enter the core): " + "; ".join(sorted({f"{v['name']} -> {', '.join(name[i] for i in v['items'])}" for v in out.values() if v['scaling'] and v['items']})), file=sys.stderr)
    print(f"\n{tests[0]} pair tests; {len(lean_augs)} lean-in augments of {sum(1 for n, ids in groups.items() if sum(1 for p in P if p['aug'] & ids) >= MIN_HOLDERS)} with {MIN_HOLDERS}+ holders", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
