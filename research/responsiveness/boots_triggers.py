"""Do logic boot triggers hold up? (Nico 2026-11-27: Swiftness vs slow-heavy teams, Mercury's vs CC-heavy teams.)
Archive timelines (all 10 players, private input). Decision = first tier-2 boots bought.
Step 1: do players pick the boot more when the trigger is on (within champion)?
Step 2: matched mechanism test: buyer of the boot vs matched buyer of other boots (same class, minute +-1, other game),
outcomes over the next 5 minutes: damage taken per minute, damage dealt per minute, taken/(taken+dealt), and deaths
when the export carries them (export_timelines_compact.py "deaths", added 2026-11-27; the direct check for Swiftness).
Not measured: time spent slowed (no such stat) or running away (positions are once a minute only).
Placebo = the same comparison in games without the trigger. Counter effect = with - without.
Run: python3 boots_triggers.py <timelines-compact.jsonl.gz> <dd champion.json> <ability_tags.json> <champion-cc.json>"""
import sys, gzip, json, ast, collections, statistics as st, math, random
TL, CH, AT, CC = sys.argv[1:5]
champs = json.load(open(CH))["data"]; key2 = {int(v["key"]): (k, v["tags"][0]) for k, v in champs.items()}
tags = json.load(open(AT)); cc = json.load(open(CC))
def slows(name):
    d = tags.get(name) or {}
    return sum(1 for s in "QWER" if s in d and "slow" in (d[s].get("tips") or []) + (d[s].get("tags") or []))
def hard(name):
    d = cc.get(name) or {}
    return sum(1 for v in (d.get("slots") or {}).values() if v and v != "slow")
BOOTS = {3009: "Swiftness", 3047: "Steelcaps", 3111: "Mercury's", 3006: "Berserker's", 3020: "Sorcerer's", 3158: "Lucidity", 3117: "Mobility"}
P = lambda x: ast.literal_eval(x) if isinstance(x, str) else x
dec = []
for line in gzip.open(TL, "rt"):
    g = json.loads(line); ps = g["players"]
    for p in ps:
        c = int(p["champ"])
        if c not in key2: continue
        enemies = [key2.get(int(q["champ"]), ("?", "?"))[0] for q in ps if q["team"] != p["team"]]
        it = [x for x in P(p["items"]) if x[1] == "purchased" and x[2] in BOOTS]
        if not it: continue
        t, _, b = it[0]; m = int(t // 60)
        fr = {f[0]: f for f in P(p["frames"])}
        if m < 1 or m + 5 not in fr or m not in fr: continue
        tk = fr[m + 5][7] - fr[m][7]; dl = fr[m + 5][3] - fr[m][3]
        if tk + dl <= 0: continue
        dd = p.get("deaths")
        deaths = sum(1 for x in dd if t < x[0] <= t + 300) if dd is not None else None
        dec.append(dict(game=g["game"], champ=key2[c][0], cls=key2[c][1], m=m, boot=b, win=p["win"] in (True, "True"), deaths=deaths,
                        slow=sum(map(slows, enemies)), hard=sum(map(hard, enemies)),
                        taken=tk / 5, dealt=dl / 5, share=tk / (tk + dl)))
print("decisions", len(dec))
def cut(key):
    v = sorted(d[key] for d in dec); return v[int(len(v) * 2 / 3)]
def step1(boot, key, hi):
    by = collections.defaultdict(lambda: [[0, 0], [0, 0]])
    for d in dec: by[d["champ"]][d[key] >= hi][0] += d["boot"] == boot; by[d["champ"]][d[key] >= hi][1] += 1
    num = den = 0
    for c, ((a0, n0), (a1, n1)) in by.items():
        if n0 and n1: w = n0 * n1 / (n0 + n1); num += w * (a1 / n1 - a0 / n0); den += w
    return num / den if den else float("nan")
def match(boot, key, hi, present):
    pool = collections.defaultdict(list)
    for d in dec:
        if (d[key] >= hi) == present: pool[d["cls"]].append(d)
    out = collections.defaultdict(list)
    for lst in pool.values():
        for d in lst:
            if d["boot"] != boot: continue
            ctrl = [e for e in lst if e["boot"] != boot and abs(e["m"] - d["m"]) <= 1 and e["game"] != d["game"]]
            if len(ctrl) < 3: continue
            for k in ("taken", "dealt", "share", "win", "deaths"):
                if d[k] is None or any(e[k] is None for e in ctrl): continue
                out[k].append(float(d[k]) - st.mean(float(e[k]) for e in ctrl))
    return out
def ms(v): return (st.mean(v), 1.96 * st.pstdev(v) / math.sqrt(len(v))) if len(v) >= 8 else (float("nan"), float("nan"))
res = {}
for boot, key in ((3009, "slow"), (3111, "hard")):
    hi = cut(key); name = BOOTS[boot]
    s1 = step1(boot, key, hi)
    w, wo = match(boot, key, hi, True), match(boot, key, hi, False)
    r = {"trigger": f"enemy {key} abilities >= {hi} (top third)", "pick_shift_pts": round(100 * s1, 1), "n_with": len(w["share"]), "n_without": len(wo["share"])}
    for k in ("taken", "dealt", "share", "win", "deaths"):
        if not w[k] or not wo[k]: continue
        a, ea = ms(w[k]); b, eb = ms(wo[k]); scale = 100 if k in ("share", "win") else 1
        r[k] = {"with": [round(a * scale, 1), round(ea * scale, 1)], "without": [round(b * scale, 1), round(eb * scale, 1)],
                "effect": [round((a - b) * scale, 1), round(math.hypot(ea, eb) * scale, 1)]}
    res[name] = r; print(name, json.dumps(r))
json.dump(res, open(sys.argv[5] if len(sys.argv) > 5 else "boots_triggers.json", "w"), indent=1)
