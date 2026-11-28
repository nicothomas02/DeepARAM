"""Team damage mix (Nico 2026-11-28: "AP Zeri was also since team already had 2 other adcs against no real tanks"):
when your allies build mostly one damage type, does a flex champion who builds the other type win more than the same
champion building the same type? Archive, all ten players. Build type = majority Data Dragon type (ap / ad) of the
first 4 legendaries (3+ typed). Flex champion: both types are 15%+ of its archive players. Heavy team: 3+ of the 4
allies build the same type. Matched within champion (Mantel-Haenszel risk difference over champions), overall and with
an enemy team of no real tanks (no enemy whose Data Dragon primary tag is Tank).
    python3 research/type-switch/team_mix.py
"""
import json, gzip, collections, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCH = "/mnt/project-files/private/owner-games/timelines-compact.jsonl.gz"
dd = json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/item.json")))["data"]
ch = json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/champion.json")))["data"]
TAG = {int(v["key"]): v["tags"][0] for v in ch.values()}
FIN = {int(k) % 10000: v for k, v in dd.items() if v.get("gold", {}).get("total", 0) >= 2000 and not v.get("into") and "Boots" not in v["tags"]}

def typ(i):
    t = FIN[i]["tags"]; a = "SpellDamage" in t; d = "Damage" in t or "CriticalStrike" in t or "AttackSpeed" in t
    return "ap" if a and not d else "ad" if d and not a else None

def build_type(p):
    seq = []
    for e in p["items"]:
        i = e[2] % 10000
        if e[1] == "purchased" and i in FIN and i not in seq: seq.append(i)
    ts = [t for t in map(typ, seq[:4]) if t]
    return collections.Counter(ts).most_common(1)[0][0] if len(ts) >= 3 else None

rows, cnt = [], collections.defaultdict(collections.Counter)
for line in gzip.open(ARCH, "rt"):
    g = json.loads(line)
    ps = g["players"]; bt = [build_type(p) for p in ps]
    for p, t in zip(ps, bt):
        if t: cnt[p["champ"]][t] += 1
    for k, (p, t) in enumerate(zip(ps, bt)):
        if not t: continue
        allies = [bt[j] for j, q in enumerate(ps) if j != k and q["team"] == p["team"] and bt[j]]
        enemies = [q for q in ps if q["team"] != p["team"]]
        heavy = next((x for x in ("ap", "ad") if sum(a == x for a in allies) >= 3), None)
        rows.append(dict(champ=p["champ"], t=t, heavy=heavy, win=p["win"] in (True, "True", 1),
                         notank=not any(TAG.get(int(q["champ"])) == "Tank" for q in enemies)))
flex = {c for c, v in cnt.items() if sum(v.values()) >= 20 and min(v["ap"], v["ad"]) / sum(v.values()) >= 0.15}

def mh(sub):
    """Within-champion win difference, other type than the heavy team minus same type."""
    by = collections.defaultdict(lambda: [[0, 0], [0, 0]])
    for r in sub:
        s = by[r["champ"]][r["t"] != r["heavy"]]; s[0] += 1; s[1] += r["win"]
    num = den = var = 0.0; n1 = n0 = 0
    for c, ((a0, w0), (a1, w1)) in by.items():
        if not a0 or not a1: continue
        n = a0 + a1; wgt = a0 * a1 / n
        p1, p0 = w1 / a1, w0 / a0
        num += wgt * (p1 - p0); den += wgt
        var += wgt ** 2 * (p1 * (1 - p1) / a1 + p0 * (1 - p0) / a0); n1 += a1; n0 += a0
    if not den: return None
    d = num / den; se = math.sqrt(var) / den
    return dict(diff_pts=round(100 * d, 1), se_pts=round(100 * se, 1), z=round(d / se, 2) if se else None, other_type=n1, same_type=n0)

base = [r for r in rows if r["champ"] in flex and r["heavy"]]
res = {"players": len(rows), "flex_champions": len(flex), "heavy_team": mh(base),
       "heavy_team_no_enemy_tank": mh([r for r in base if r["notank"]]),
       "heavy_ad_team": mh([r for r in base if r["heavy"] == "ad"]),
       "heavy_ad_team_no_enemy_tank": mh([r for r in base if r["heavy"] == "ad" and r["notank"]])}
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "team_mix.json"), "w"), indent=1)
