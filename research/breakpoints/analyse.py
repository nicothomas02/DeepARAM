"""Clear item breakpoints from sweep.jsonl, checked against the archive (Nico 2026-11-28).

A breakpoint is clear when the item loses to the planned item against a typical team at that decision and wins at
some enemy health, armor or MR on one side of typical, inside the range real games reach (5th-95th percentile of
the team average at that decision, archive). Fight length can't be seen in game, so its breakpoints are listed, not
shipped. Archive check, per item and stat: at the same champion, slot and 3-minute bucket, did players who bought
this item face a higher (or lower) team value than players who bought another item of the same damage type?
z >= 2 in the breakpoint's direction = agrees; z <= -2 = contradicts (not shipped); else = can't tell.
    python3 research/breakpoints/analyse.py <states-dec.json> [--out research/breakpoints/breakpoints.json]
states-dec.json: decision rows from the private archive (cols item, slot, min, decision_min, level, ap, ad,
foe_armor, foe_mr, champ, patch, who, foe_hp); only aggregates leave it.
"""
import json, math, os, sys, statistics as st, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TYP = {2: dict(hp=1321, armor=53.0, mr=44.0, fight=18), 3: dict(hp=2068, armor=75.8, mr=54.0, fight=18)}
COL = {"hp": 12, "armor": 7, "mr": 8}


def load(states):
    R = json.load(open(states))["rows"]
    rng = {}
    for s in TYP:
        for v, c in COL.items():
            xs = sorted(r[c] for r in R if r[1] == s)
            rng[(s, v)] = (xs[len(xs) // 20], xs[len(xs) * 19 // 20])
    return R, rng


def clear(rows, rng):
    out = []
    for r in rows:
        t = r["typical"]
        if t is None or t >= 0:
            continue
        for var, cur in r["curves"].items():
            ty = TYP[r["slot"]][var]
            lo, hi = rng.get((r["slot"], var), (-1e9, 1e9))
            up = [v for v, x in cur if x is not None and x >= 0 and ty < v <= hi]
            dn = [v for v, x in cur if x is not None and x >= 0 and lo <= v < ty]
            if up:
                out.append({**{k: r[k] for k in ("champ", "item", "slot", "vs", "typical")}, "stat": var, "dir": ">=", "at": min(up)})
            if dn:
                out.append({**{k: r[k] for k in ("champ", "item", "slot", "vs", "typical")}, "stat": var, "dir": "<=", "at": max(dn)})
    return out


def archive_check(R, bps, typ_items):
    """{(item, stat, dir): (mean difference, z, n)} over the champions with that breakpoint."""
    by = collections.defaultdict(set)
    for b in bps:
        if b["stat"] in COL:
            by[(b["item"], b["stat"], b["dir"])].add((b["champ"].lower(), b["slot"]))
    buckets = collections.defaultdict(list)
    for r in R:
        buckets[(r[9].lower(), r[1], int(r[3] // 3))].append(r)
    res = {}
    for (item, var, d), where in by.items():
        c, diffs = COL[var], []
        same = typ_items.get(item, set())
        for (ch, s, _), rs in buckets.items():
            if (ch, s) not in where:
                continue
            o = [r for r in rs if r[0] != item and r[0] in same]
            if not o:
                continue
            m = st.mean(r[c] for r in o)
            diffs += [r[c] - m for r in rs if r[0] == item]
        if len(diffs) >= 10:
            se = st.pstdev(diffs) / math.sqrt(len(diffs)) or 1e-9
            z = st.mean(diffs) / se * (1 if d == ">=" else -1)
            res[(item, var, d)] = (round(st.mean(diffs), 1), round(z, 1), len(diffs))
        else:
            res[(item, var, d)] = (None, None, len(diffs))
    return res


def main():
    states = sys.argv[1]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(HERE, "breakpoints.json")
    rows = [json.loads(l) for l in open(os.path.join(HERE, "sweep.jsonl"))]
    R, rng = load(states)
    lst = json.loads(open(os.path.join(HERE, "simlist.json")).read()) if os.path.exists(os.path.join(HERE, "simlist.json")) else None
    import subprocess
    if lst is None:
        lst = json.loads(subprocess.run([os.path.join(ROOT, "simulator", "mayhem_sim"), "--list", "--json"], capture_output=True, text=True, cwd=os.path.join(ROOT, "simulator")).stdout)
    role = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
    AP, AD = {"ap"}, {"ad", "crit", "lethality", "ability_ad", "onhit"}
    typ_items = {i: {j for j in role if role[j] & (AP if role[i] & AP else AD)} for i in role}
    bps = clear(rows, rng)
    chk = archive_check(R, bps, typ_items)
    for b in bps:
        m, z, n = chk.get((b["item"], b["stat"], b["dir"]), (None, None, 0))
        b["archive"] = {"diff": m, "z": z, "n": n, "verdict": "agrees" if z is not None and z >= 2 else "contradicts" if z is not None and z <= -2 else "can't tell"}
    summary = collections.Counter((b["stat"], b["dir"], b["archive"]["verdict"]) for b in bps)
    json.dump({"typical": TYP, "range_p5_p95": {f"{s}:{v}": x for (s, v), x in rng.items()}, "pairs_tested": len(rows),
               "loses_at_typical": sum(1 for r in rows if r["typical"] is not None and r["typical"] < 0),
               "breakpoints": bps, "archive": {f"{i}:{v}:{d}": x for (i, v, d), x in chk.items()}}, open(out, "w"), indent=0)
    for k, v in sorted(summary.items()): print(k, v)


if __name__ == "__main__":
    main()
