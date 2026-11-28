"""Augments after which players build the other damage type than their champion usually does (Nico 2026-11-28:
"doesn't have to be first item, can be augment too"). Archive, all ten players of every lobby: a player's build type is
the majority damage type (ap / ad, Data Dragon tags) of their first legendaries (3+); the champion's usual type is the
majority over all its players. Per augment and direction: holders who build the other type vs the rate expected from
their champions' players without it (binomial z). Writes web/src/data/augment-type-switch.json (aggregates only).
    python3 research/type-switch/augment_type_switch.py
"""
import json, gzip, collections, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCH = "/mnt/project-files/private/owner-games/timelines-compact.jsonl.gz"
dd = json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/item.json")))["data"]
FIN = {int(k) % 10000: v for k, v in dd.items() if v.get("gold", {}).get("total", 0) >= 2000 and not v.get("into") and "Boots" not in v["tags"]}
AUG = {a["id"]: a["name"] for a in json.load(open(os.path.join(ROOT, "simulator/data/augments.json")))["augments"].values()}
Z_MIN, N_MIN = 4.0, 15

def typ(i):
    t = FIN[i]["tags"]; a = "SpellDamage" in t; d = "Damage" in t or "CriticalStrike" in t or "AttackSpeed" in t
    return "ap" if a and not d else "ad" if d and not a else None

players, cnt = [], collections.defaultdict(collections.Counter)
for line in gzip.open(ARCH, "rt"):
    for p in json.loads(line)["players"]:
        seq = []
        for e in p["items"]:
            i = e[2] % 10000
            if e[1] == "purchased" and i in FIN and i not in seq: seq.append(i)
        ts = [t for t in map(typ, seq[:4]) if t]
        for t in ts: cnt[p["champ"]][t] += 1
        if len(ts) >= 3: players.append((p["champ"], collections.Counter(ts).most_common(1)[0][0], {a["augment"] for a in p["augments"]}))
main = {c: v.most_common(1)[0][0] for c, v in cnt.items()}
flip = lambda c, t: t != main[c]
base = collections.defaultdict(lambda: [0, 0])   # champ -> [players, flipped] (all players; holders are a small share)
for c, t, _ in players: base[c][0] += 1; base[c][1] += flip(c, t)
out = {}
for direction in ("ap", "ad"):  # "ap": AD champions building AP; "ad": AP champions building AD
    hold = collections.defaultdict(lambda: [0, 0.0, 0])   # aug -> [holders, expected flips, flips]
    for c, t, augs in players:
        if main[c] == direction: continue
        rate = base[c][1] / base[c][0]
        for a in augs: h = hold[a]; h[0] += 1; h[1] += rate; h[2] += flip(c, t)
    for a, (n, e, f) in hold.items():
        if n < N_MIN: continue
        var = sum(0 for _ in ()) or e * (1 - e / n)
        z = (f - e) / math.sqrt(var) if var > 0 else 0
        if z >= Z_MIN: out[str(a)] = {"to": direction, "name": AUG.get(a, str(a)), "holders": n, "flipped": f, "expected": round(e, 1), "z": round(z, 1)}
res = {"made": "2026-11-28", "players": len(players), "method": {"z_min": Z_MIN, "holders_min": N_MIN, "items": "first 4 legendaries, 3+ typed"}, "augments": out}
json.dump(res, open(os.path.join(ROOT, "web/src/data/augment-type-switch.json"), "w"), indent=1)
print(len(players), "players"); [print(a, v) for a, v in sorted(out.items(), key=lambda x: -x[1]["z"])]
