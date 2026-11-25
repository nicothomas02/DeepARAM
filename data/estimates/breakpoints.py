"""Breakpoints: when this game's enemies are tanky enough that penetration or %-health items and augments are worth more
than usual (Nico 2026-11-25, "use the simulator's math to find breakpoints, e.g. Thread the Needle, BotRK").

The app estimates each enemy's armor, magic resist and health from champion base stats at their level plus their items
(Data Dragon; the Live Client API reports both). It compares the team average with a typical team at the same level and
item count (archive lobbies: what players' first n finished items add). A game is "tanky" when the ratio is above the
archive's mean + 1 SD of the same ratio at game end (about the top 16% of games). Plain resist / %-health math, no
simulation; estimated (Mayhem stat augments on enemies aren't seen).

Writes web/src/data/breakpoints.json for the build engine (rule `breakpoints`).
Run: python3 data/estimates/breakpoints.py <archive-players.json>
"""
import collections, glob, json, math, os, re, statistics, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
DD = sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US")))[-1]
STATS = ("hp", "armor", "spellblock")
MODS = ("FlatHPPoolMod", "FlatArmorMod", "FlatSpellBlockMod")
key = lambda s: re.sub(r"[^a-z]", "", s.lower())


def grow(base, per, lvl):
    return base + per * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1))


def main(players_path):
    champs = json.load(open(os.path.join(DD, "champion.json")))["data"]
    items = json.load(open(os.path.join(DD, "item.json")))["data"]
    ch = {}
    by_id = {}
    for c in champs.values():
        row = [round(c["stats"][s], 1) for s in STATS] + [round(c["stats"][s + "perlevel"], 2) for s in STATS]
        ch[key(c["id"])] = row
        ch[key(c["name"])] = row
        by_id[int(c["key"])] = row
    it, fin = {}, set()
    for i, x in items.items():
        s = int(i) % 10000
        v = [x.get("stats", {}).get(m, 0) for m in MODS]
        if any(v):
            it[s] = v
        if x.get("gold", {}).get("total", 0) >= 2000 and not x.get("into") and "Boots" not in x.get("tags", []):
            fin.add(s)

    P = [p for p in json.load(open(players_path)) if "items_in_order" in p and p["champion_id"] in by_id]
    # what items add after the n-th finished item (everything bought up to it, boots and components included)
    add = collections.defaultdict(list)
    for p in P:
        tot, n = [0, 0, 0], 0
        for s in p["items_in_order"]:
            s %= 10000
            tot = [a + b for a, b in zip(tot, it.get(s, (0, 0, 0)))]
            if s in fin:
                n += 1
                if n <= 6:
                    add[n].append(list(tot))
        p["tot"], p["n"] = tot, min(n, 6)
    ref = [[0, 0, 0]] + [[round(statistics.mean(r[j] for r in add[n]), 1) for j in range(3)] for n in range(1, 7)]
    rows = [by_id[p["champion_id"]] for p in P]
    avg = [round(statistics.mean(r[j] for r in rows), 2) for j in range(6)]

    # end-of-game enemy teams (level 18): ratio of the team's stats to a typical team with the same item counts
    teams = collections.defaultdict(list)
    for p in P:
        teams[(p["game"], p["side"])].append(p)
    ratios = [[], [], []]
    for t in teams.values():
        if len(t) < 5:
            continue
        for j in range(3):
            got = statistics.mean(grow(by_id[p["champion_id"]][j], by_id[p["champion_id"]][j + 3], 18) + p["tot"][j] for p in t)
            exp = statistics.mean(grow(avg[j], avg[j + 3], 18) + ref[p["n"]][j] for p in t)
            ratios[j].append(got / exp)
    cut = [round(statistics.mean(r) + statistics.stdev(r), 3) for r in ratios]
    print("teams", len(ratios[0]), "ratio mean/sd", [(round(statistics.mean(r), 3), round(statistics.stdev(r), 3)) for r in ratios], "cut", cut)
    print("ref per finished item", ref)
    out = {
        "about": __doc__.split("\n\n")[0],
        "champions": ch,  # key -> [hp, armor, mr, hp/lvl, armor/lvl, mr/lvl]
        "items": {str(k): v for k, v in sorted(it.items())},  # id -> [hp, armor, mr]
        "finished": sorted(fin),
        "avgChampion": avg,
        "refItems": ref,  # typical [hp, armor, mr] from items after n finished items, n = 0..6
        "cut": dict(zip(("hp", "armor", "mr"), cut)),
        "teams": len(ratios[0]),
    }
    json.dump(out, open(os.path.join(ROOT, "web/src/data/breakpoints.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
