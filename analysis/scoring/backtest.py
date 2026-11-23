"""Backtest of DeepScore's formula against its purpose: when a player is offered a few options (3 augments of one
rarity, or a choice of items/spells), does picking the highest score pick the option that wins most NEXT patch?

Data: data/aramhex/patches/<p>/{augments,items,spells,heroes}.json and augment_info.json (rarity).
Run: python3 analysis/scoring/backtest.py

Scoring rules compared (all on a row's lead = win rate minus the list's games-weighted average):
  raw      the lead as observed
  shrunk   empirical-Bayes lead, tau2/(tau2+v) * lead            (champion card today, web/src/lib/card-score.ts)
  bound    fitted estimate minus one typical miss, b*shrunk - sqrt(s0^2+v)  (tier lists today, lib/deepscore.ts)
  popular  most games
Each also runs on the live patch thinned to 10% of its games (a patch's first day), where rules differ most.

Metrics (target = next patch's lead, which the rule never saw):
  offer    mean next-patch lead of the pick from random 3-option offers, minus the offer's average (pts). Augment offers
           are drawn within one rarity, like the game.
  top5     mean next-patch lead of the 5 best-scored rows that pass the following rule (pts).
  rho      Spearman rank correlation of score with next-patch lead, over rows with 2,000+ games next patch.
"""
import json
import math
import os
import random
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "aramhex", "patches")
PATCHES = ["16.19", "16.20", "16.21", "16.22", "16.23"]
FIT = json.load(open(os.path.join(ROOT, "..", "..", "..", "web", "src", "data", "deepscore-fit.json")))


def load(p, name):
    path = os.path.join(ROOT, p, name + ".json")
    return json.load(open(path)) if os.path.exists(path) else None


def rows_of(table, c):
    r = table.get(c) or {}
    if "items" in r and "all" in r:
        r = r["items"]
    return {k: v for k, v in r.items() if v[0] > 0}


def leads(rows):
    tot = sum(g for g, _ in rows.values())
    if not tot:
        return {}
    m = sum(w for _, w in rows.values()) / tot
    return {k: (w / g - m, max(w / g * (1 - w / g), 0.05) / g, g) for k, (g, w) in rows.items()}


def tau2_of(L):
    xs = [x for x, _, _ in L.values()]
    vs = [v for _, v, _ in L.values()]
    if not xs:
        return 1e-5
    m = sum(xs) / len(xs)
    return max(sum((x - m) ** 2 for x in xs) / len(xs) - sum(vs) / len(vs), 1e-5)


def thin(rows, frac, rng):
    out = {}
    for k, (g, w) in rows.items():
        n = sum(1 for _ in range(g) if rng.random() < frac) if g < 400 else max(0, int(round(rng.gauss(g * frac, math.sqrt(g * frac * (1 - frac))))))
        p = w / g
        wins = sum(1 for _ in range(n) if rng.random() < p) if n < 400 else int(round(min(n, max(0, rng.gauss(n * p, math.sqrt(n * p * (1 - p)))))))
        if n > 0:
            out[k] = [n, wins]
    return out


def share_of(L):
    mx = max(g for _, _, g in L.values())
    return {k: g / mx for k, (_, _, g) in L.items()}


def fit_curve(tables):
    """Weighted least squares of lead on ln(games / list's top row's games), over every list in one patch."""
    sw = sx = sy = sxx = sxy = 0.0
    for L in tables:
        if len(L) < 4:
            continue
        sh = share_of(L)
        for k, (x, v, g) in L.items():
            w = 1 / (v + 1e-4)
            z = math.log(sh[k])
            sw += w; sx += w * z; sy += w * x; sxx += w * z * z; sxy += w * z * x
    beta = (sw * sxy - sx * sy) / (sw * sxx - sx * sx)
    return (sy - beta * sx) / sw, beta


def scores(rows, fit, curve=(0.0, 0.0)):
    L = leads(rows)
    t2 = tau2_of(L)
    b, s0 = (fit or {}).get("b", 1.0), (fit or {}).get("s0", 0.01)
    a, beta = curve
    sh = share_of(L)
    prior = {k: a + beta * math.log(sh[k]) for k in L}
    xs = [x - prior[k] for k, (x, _, _) in L.items()]
    vs = [v for _, v, _ in L.values()]
    m = sum(xs) / len(xs)
    t2p = max(sum((x - m) ** 2 for x in xs) / len(xs) - sum(vs) / len(vs), 1e-5)
    out = {}
    for k, (x, v, g) in L.items():
        s = t2 / (t2 + v) * x
        pp = prior[k] + t2p / (t2p + v) * (x - prior[k])
        out[k] = {"raw": x, "shrunk": s, "bound": b * s - math.sqrt(s0 * s0 + v), "popprior": pp, "popular": g}
    return out


def spearman(a, b):
    def rank(x):
        o = sorted(range(len(x)), key=lambda i: x[i])
        r = [0] * len(x)
        for i, j in enumerate(o):
            r[j] = i
        return r
    ra, rb = rank(a), rank(b)
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra)
    vb = sum((y - mb) ** 2 for y in rb)
    return cov / math.sqrt(va * vb) if va and vb else None


RULES = ["raw", "shrunk", "bound", "popprior", "popular"]


def run(name, fitkey, rarity=None, frac=1.0, seed=1, offers=60):
    rng = random.Random(seed)
    res = defaultdict(list)
    for T, N in zip(PATCHES, PATCHES[1:]):
        a, b = load(T, name), load(N, name)
        if not a or not b:
            continue
        cache = {}
        for c in a:
            now = rows_of(a, c)
            cache[c] = thin(now, frac, rng) if frac < 1 else now
        curve = fit_curve([leads(r) for r in cache.values() if r])
        res[("curve", T)] = curve
        for c in a:
            now, nxt = cache[c], rows_of(b, c)
            if len(now) < 4:
                continue
            S = scores(now, FIT.get(fitkey), curve)
            Y = leads(nxt)
            maxn = max(g for g, _ in now.values())
            ok = [k for k in S if k in Y and (now[k][0] >= 0.25 * maxn or now[k][0] >= 2000)]
            for r in RULES:
                for k in sorted(ok, key=lambda k: -S[k][r])[:5]:
                    res[("top5", r)].append(Y[k][0])
            big = [k for k in S if k in Y and Y[k][2] >= 2000]
            for r in RULES:
                rho = spearman([S[k][r] for k in big], [Y[k][0] for k in big])
                if rho is not None:
                    res[("rho", r)].append(rho)
            groups = defaultdict(list)
            for k in S:
                if k in Y:
                    groups[rarity.get(k) if rarity else "all"].append(k)
            for keys in groups.values():
                if len(keys) < 3:
                    continue
                for _ in range(offers):
                    o = rng.sample(keys, 3)
                    avg = sum(Y[k][0] for k in o) / 3
                    for r in RULES:
                        k = max(o, key=lambda k: S[k][r])
                        res[("offer", r)].append(Y[k][0] - avg)
    return res


def show(title, res):
    print(f"\n{title}")
    print("metric".ljust(10) + "".join(r.rjust(10) for r in RULES))
    print("  prior curve (a, beta per ln share) by patch:", {k[1]: tuple(round(x * 100, 2) for x in v) for k, v in res.items() if k[0] == "curve"})
    for m in ("offer", "top5", "rho"):
        line = m.ljust(10)
        for r in RULES:
            v = res.get((m, r), [])
            x = sum(v) / len(v) if v else float("nan")
            line += f"{x * (1 if m == 'rho' else 100):+10.3f}"
        print(line)


def rarity_means():
    info = load("16.22", "augment_info")
    tot = defaultdict(lambda: [0.0, 0])
    for c, rows in load("16.22", "augments").items():
        for k, (x, v, g) in leads(rows).items():
            r = info.get(k, "?")
            tot[r][0] += x * g
            tot[r][1] += g
    print("16.22 augment lead by rarity (games-weighted, pts):",
          {r: round(s / n * 100, 2) for r, (s, n) in tot.items() if n})


if __name__ == "__main__":
    info = load("16.23", "augment_info")
    rarity_means()
    for frac in (1.0, 0.1):
        tag = "" if frac == 1 else " (live patch thinned to 10%)"
        show("Augments, offers within rarity" + tag, run("augments", "augments", rarity=info, frac=frac))
        show("Items" + tag, run("items", "items", frac=frac))
        show("Spell pairs" + tag, run("spells", "items", frac=frac))
