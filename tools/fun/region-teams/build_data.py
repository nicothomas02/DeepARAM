"""Build data.js for Region Teams: the strongest Mayhem team from each region of Runeterra.

Usage: python3 build_data.py [--regions champions/regions.json] [--cn data/cn] [--tags champions/tags.json]
Writes data.js next to this script. Python 3 standard library only.

For each region, every five-champion team from that region's champions is scored the way Team Builder
ranks partners: each champion's Mayhem win rate above 50%, plus each known pair's win rate together above
50% (data/cn/duos.json and each champion's best partners). A team needs a Tank or Fighter up front, a Mage,
Marksman or Slayer for damage, and at most two Marksmen; a region with no Tank or Fighter skips that rule.
"""
import argparse, itertools, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game, write_data_js  # noqa: E402

TEAM = 5
POOL = 24  # the region's best champions by win rate that the search tries (plus every Tank and Fighter)
FRONT = {"Tank", "Fighter"}
DAMAGE = {"Mage", "Marksman", "Slayer"}


def load(path):
    with open(os.path.join(REPO, path) if not os.path.isabs(path) else path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default="champions/regions.json")
    ap.add_argument("--cn", default="data/cn")
    ap.add_argument("--tags", default="champions/tags.json")
    ap.add_argument("--channel", default="latest")
    a = ap.parse_args()
    g = Game(a.channel)
    regions, tags = load(a.regions), load(a.tags)["champions"]
    cn = load(os.path.join(a.cn, "champions.json"))
    duos = load(os.path.join(a.cn, "duos.json"))["duos"]

    by_id = {t["id"]: alias for alias, t in tags.items()}
    stats = {by_id[c["champion_id"]]: c for c in cn["champions"] if c["champion_id"] in by_id}
    pairs = {}
    for d in duos:
        pairs.setdefault(frozenset(d["names"]), d["win_rate"])
    for c in cn["champions"]:
        for p in c.get("best_partners") or []:
            if c["champion_id"] in by_id and p["champion_id"] in by_id:
                pairs.setdefault(frozenset((by_id[c["champion_id"]], by_id[p["champion_id"]])), p["win_rate"])
    classes = {alias: t["classes"] or t["roles"] for alias, t in tags.items()}

    def score(team):
        s = sum(stats[c]["win_rate"] - 0.5 for c in team)
        return s + sum(pairs.get(frozenset(p), 0.5) - 0.5 for p in itertools.combinations(team, 2))

    def ok(team, strict=True):
        cl = [classes.get(c, []) for c in team]
        roles = any(FRONT & set(x) for x in cl) and any(DAMAGE & set(x) for x in cl)
        return (roles or not strict) and sum("Marksman" in x for x in cl) <= 2

    out = []
    for r in regions["regions"]:
        members = sorted((c for c, rs in regions["champions"].items() if r["key"] in rs and c in stats),
                         key=lambda c: -stats[c]["win_rate"])
        pool = members[:POOL] + [c for c in members[POOL:] if FRONT & set(classes.get(c, []))][:6]
        best = max((t for t in itertools.combinations(pool, TEAM) if ok(t)), key=score, default=None)
        # A region with nobody to stand up front (Bandle City) still gets its best five, flagged.
        best = best or max((t for t in itertools.combinations(pool, TEAM) if ok(t, False)), key=score, default=None)
        if not best:
            continue
        best = sorted(best, key=lambda c: -stats[c]["win_rate"])
        known = [(x, y, pairs[frozenset((x, y))]) for x, y in itertools.combinations(best, 2) if frozenset((x, y)) in pairs]
        out.append({
            "key": r["key"], "name": r["name"], "size": len(members),
            "frontline": any(FRONT & set(classes.get(c, [])) for c in best),
            "score": round(score(best), 4),
            "win_rate": round(sum(stats[c]["win_rate"] for c in best) / TEAM, 4),
            "champions": [{"alias": c, "name": tags[c]["name"], "icon": g.champion_icon(tags[c]["id"]),
                           "win_rate": stats[c]["win_rate"], "classes": classes.get(c, [])} for c in best],
            "pairs": [{"a": x, "b": y, "win_rate": w} for x, y, w in sorted(known, key=lambda k: -k[2])],
        })
    out.sort(key=lambda r: -r["score"])
    write_data_js(os.path.join(HERE, "data.js"), "REGION_DATA", {
        "patch": g.version, "channel": g.ch, "stat_date": cn["meta"].get("champion_stat_date"), "regions": out})
    print(f"wrote {len(out)} region teams")


if __name__ == "__main__":
    main()
