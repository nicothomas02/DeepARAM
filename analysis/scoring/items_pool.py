"""Pool boots and single items across patches, as augments and starters already are? (Nico 2026-11-24: "Can we do
this with historical patches?")

AramHex publishes item tables only from 16.22, so this uses the saved per-patch 101 snapshots instead
(data/cn/history/builds/<p>.json: each champion's 4 boots and ~10 single items with pick and win rate; games = the
champion's AramHex games that patch x pick rate), the same source starters_pool.py used. Patch T is scored two ways:
  bound        the bound rule on patch T alone (boots and items today)
  bound+pool   the bound rule on T pooled with up to 2 earlier patches (data/aramhex/common.py pool, the augments' rule)
judged on patch T+1's lead (win rate minus the list's pick-weighted average), which neither saw:
  top     the next-patch lead of the top pick among rows with a following (25% of the top row or 2,000 games)
  offer   random 3-row offers: next-patch lead of the pick minus the offer's average
  rho     rank correlation of score with next-patch lead
Each also runs on patch T thinned to 10% of its games (a patch's first days), where pooling should matter most.

Run: python3 analysis/scoring/items_pool.py
"""
import json
import math
import os
import random
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "data")
sys.path.insert(0, os.path.join(ROOT, "aramhex"))
sys.path.insert(0, HERE)
import common as ah  # noqa: E402
from backtest import spearman  # noqa: E402
from starters_pool import lead_next, score  # noqa: E402

PATCHES = ["16.20", "16.21", "16.22", "16.23"]


def table(p, section):
    hist = json.load(open(os.path.join(ROOT, "cn", "history", "builds", p + ".json")))["champions"]
    heroes = json.load(open(os.path.join(ROOT, "aramhex", "patches", p, "heroes.json")))
    out = {}
    for cid, c in hist.items():
        g_all = (heroes.get(cid) or [0])[0]
        rows = {}
        for ids, pick, wr in (c.get("items") or {}).get(section) or []:
            g = int(round(g_all * pick))
            if g > 0 and wr is not None:
                rows["+".join(map(str, sorted(ids)))] = [g, int(round(g * wr))]
        if rows:
            out[cid] = rows
    return out


def thin(rows, frac, rng):
    out = {}
    for k, (g, w) in rows.items():
        n = max(1, int(round(g * frac)))
        p = w / g
        out[k] = [n, int(round(min(n, max(0, rng.gauss(n * p, math.sqrt(n * p * (1 - p)))))))]
    return out


def run(section, frac, seed=1):
    rng = random.Random(seed)
    T = {p: table(p, section) for p in PATCHES}
    res = defaultdict(list)
    for i, (p, q) in enumerate(zip(PATCHES, PATCHES[1:])):
        for cid, full in T[p].items():
            nxt = T[q].get(cid)
            if not nxt or len(full) < 3:
                continue
            rows = thin(full, frac, rng) if frac < 1 else full
            hist = [rows] + [T[e].get(cid) or {} for e in reversed(PATCHES[max(0, i - 2): i])]
            pooled = ah.pool(hist) if len(hist) > 1 else {}
            S = {"bound": score(rows), "bound+pool": score(rows, {k: v for k, v in pooled.items() if v[2] > 1})}
            Y = lead_next(nxt)
            top = max(g for g, _ in rows.values())
            ok = [k for k in rows if k in Y and (rows[k][0] >= 0.25 * top or rows[k][0] >= 2000 * frac)]
            keys = [k for k in rows if k in Y]
            if not ok or len(keys) < 3:
                continue
            offers = [rng.sample(keys, 3) for _ in range(30)]
            for r, s in S.items():
                res[("top", r)].append(Y[max(ok, key=lambda k: s[k]["bound"])])
                for o in offers:
                    res[("offer", r)].append(Y[max(o, key=lambda k: s[k]["bound"])] - sum(Y[k] for k in o) / 3)
                rho = spearman([s[k]["bound"] for k in keys], [Y[k] for k in keys])
                if rho is not None:
                    res[("rho", r)].append(rho)
    return res


def show(title, res):
    print(title)
    for m in ("top", "offer", "rho"):
        line = f"  {m:6s}"
        for r in ("bound", "bound+pool"):
            v = res[(m, r)]
            mean = sum(v) / len(v)
            se = math.sqrt(sum((x - mean) ** 2 for x in v) / max(1, len(v) - 1) / len(v))
            line += f"  {r} {mean * (1 if m == 'rho' else 100):+.3f} ± {se * (1 if m == 'rho' else 100):.3f}"
        print(line + f"  (n={len(v)})")


if __name__ == "__main__":
    for section in ("boots", "other"):
        for frac in (1.0, 0.1):
            show(f"{'Boots' if section == 'boots' else 'Single items'}{'' if frac == 1 else ' (patch thinned to 10%)'}", run(section, frac))
