"""Starters on the one DeepScore rule without losing rare winners? (Nico 2026-11-24: "Is there a way to unify rules
while keeping rare starters?")

The bound rule (backtest.py) marks a row down by its sampling noise. Other lists rank on rows pooled with earlier
patches where nothing changed (data/aramhex/common.py pool), so a rare row with a steady lead carries the pooled games.
Starters only had the live patch's games. This pools each starter over the saved patches (data/cn/history/builds,
games = the champion's AramHex games that patch x the starter's pick rate) and scores patch T three ways:
  est          the fitted estimate, no penalty (starters today)
  bound        the bound rule on patch T alone (what unifying did, and dropped 16 rare starters)
  bound+pool   the bound rule on T pooled with up to 2 earlier patches (the other lists' rule)
judged on patch T+1's lead (win rate minus the list's pick-weighted average). A starter may lead with 25% of the top
start's pick rate or 2,000 games (champion-page.ts START_MIN_GAMES), as on the card.

Run: python3 analysis/scoring/starters_pool.py
"""
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "data")
sys.path.insert(0, os.path.join(ROOT, "aramhex"))
import common as ah  # noqa: E402

FIT = json.load(open(os.path.join(HERE, "..", "..", "web", "src", "data", "deepscore-fit.json")))["items"]
PATCHES = ["16.20", "16.21", "16.22", "16.23"]


def table(p):
    hist = json.load(open(os.path.join(ROOT, "cn", "history", "builds", p + ".json")))["champions"]
    heroes = json.load(open(os.path.join(ROOT, "aramhex", "patches", p, "heroes.json")))
    out = {}
    for cid, c in hist.items():
        st = (c.get("items") or {}).get("starting") or []
        g_all = (heroes.get(cid) or [0])[0]
        if not g_all:
            continue
        rows = {}
        for ids, pick, wr in st:
            g = int(round(g_all * pick))
            if g > 0 and wr is not None:
                rows["+".join(map(str, sorted(ids)))] = [g, int(round(g * wr))]
        if rows:
            out[cid] = rows
    return out


def score(rows, pooled=None):
    """rows {key: [games, wins]} -> {key: {rule: value}}; pooled {key: (wr, games, n)} replaces each row's numbers."""
    use = {k: ((pooled[k][0], pooled[k][1]) if pooled and k in pooled else (w / g, g)) for k, (g, w) in rows.items()}
    tot = sum(rows[k][0] for k in rows)
    m = sum(rows[k][0] * use[k][0] for k in rows) / tot
    xs = {k: use[k][0] - m for k in rows}
    vs = {k: max(use[k][0] * (1 - use[k][0]), 0.05) / use[k][1] for k in rows}
    mx = sum(xs.values()) / len(xs)
    t2 = max(sum((x - mx) ** 2 for x in xs.values()) / len(xs) - sum(vs.values()) / len(vs), 1e-5)
    b, s0 = FIT["b"], FIT["s0"]
    return {k: {"est": b * t2 / (t2 + vs[k]) * xs[k], "bound": b * t2 / (t2 + vs[k]) * xs[k] - math.sqrt(s0 * s0 + vs[k])} for k in rows}


def lead_next(rows):
    tot = sum(g for g, _ in rows.values())
    m = sum(w for _, w in rows.values()) / tot
    return {k: w / g - m for k, (g, w) in rows.items()}


def main():
    T = {p: table(p) for p in PATCHES}
    res = defaultdict(list)
    rare = defaultdict(int)
    n = 0
    for i, (p, q) in enumerate(zip(PATCHES, PATCHES[1:])):
        for cid, rows in T[p].items():
            nxt = T[q].get(cid)
            if not nxt or len(rows) < 3:
                continue
            hist = [rows] + [T[e].get(cid) or {} for e in reversed(PATCHES[max(0, i - 2): i])]
            pooled = ah.pool(hist) if len(hist) > 1 else {}
            S = score(rows)
            P = score(rows, {k: v for k, v in pooled.items() if v[2] > 1})
            top = max(g for g, _ in rows.values())
            ok = [k for k in rows if rows[k][0] >= 0.25 * top or rows[k][0] >= 2000]
            Y = lead_next(nxt)
            picks = {
                "est": max(ok, key=lambda k: S[k]["est"]),
                "bound": max(ok, key=lambda k: S[k]["bound"]),
                "bound+pool": max(ok, key=lambda k: P[k]["bound"]),
            }
            if not all(k in Y for k in picks.values()):
                continue
            n += 1
            for r, k in picks.items():
                res[r].append(Y[k] - Y[picks["est"]])
                rare[r] += rows[k][0] < 0.25 * top
    print(f"{n} champion-patches (16.20-16.23)")
    print("rule".ljust(12) + "top pick vs est (pts)".rjust(24) + "rare picks (<25% of top start)".rjust(34))
    for r, v in res.items():
        mean = sum(v) / len(v)
        se = math.sqrt(sum((x - mean) ** 2 for x in v) / max(1, len(v) - 1) / len(v))
        print(f"{r:<12}{f'{mean * 100:+.2f} ± {se * 100:.2f}':>24}{rare[r]:>34}")


if __name__ == "__main__":
    main()
