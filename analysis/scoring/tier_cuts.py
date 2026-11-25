"""Do DeepScore's tier cuts (S 70+, A 59+, B 44+, C 32+, D below; web/src/lib/deepscore-scale.ts) separate picks that
really do better? (Nico 2026-11-25: validate the cutoffs, move them only if the data says so.)

Two tests, per list type (champions, a champion's augments, items, spell pairs):
  1. Public, held out: score every row on patch T with the site's rule (bound, then 50 + 15 z within the list, the
     tier from the rounded score), then judge each tier on patch T+1's games, which the score never saw. Target: the
     row's next-patch lead over its list's games-weighted average, in win-rate points, games-weighted within a tier.
     Also on patch T thinned to 10% of its games (a patch's first day).
  2. Nico's archive (all 10 players of his games, /mnt/project-files/aramhex/archive-players.json): each player's
     champion, augments and finished items are tiered with the PREVIOUS patch's public data (held out), and each tier's
     win rate is compared. Correlated, not causal (who picks what).
Then a sweep: every set of 4 cuts on a grid, scored by how much of the next-patch lead the 5 tiers explain (between-
tier share of variance, R2), with a bootstrap over lists for the gain over today's cuts. Cuts move only if the gain is
clear (lower 95% bound above 0) on full AND thinned data.

Run: python3 analysis/scoring/tier_cuts.py [path to archive-players.json]
"""
import json
import math
import os
import random
import sys
from collections import defaultdict
from itertools import combinations

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backtest import FIT, PATCHES, leads, load, rows_of, scores, thin  # noqa: E402

CUTS = (70, 59, 44, 32)
TIERS = "SABCD"


def tier_of(ds, cuts=CUTS):
    for t, c in zip(TIERS, cuts):
        if ds >= c:
            return t
    return "D"


def deep(S):
    """Site's DeepScore: bound -> z within the list -> 50 + 15 z, rounded, clamped."""
    ks = list(S)
    vs = [S[k]["bound"] for k in ks]
    m = sum(vs) / len(vs)
    sd = math.sqrt(sum((v - m) ** 2 for v in vs) / len(vs)) or 1
    return {k: max(0, min(100, round(50 + 15 * (v - m) / sd))) for k, v in zip(ks, vs)}


def hero_lists(p):
    h = load(p, "heroes")
    return {"all": {k: v for k, v in h.items() if v[0] > 0}} if h else {}


def lists(p, kind):
    if kind == "champions":
        return hero_lists(p)
    t = load(p, kind)
    return {c: rows_of(t, c) for c in t} if t else {}


FITKEY = {"champions": "champions", "augments": "augments", "items": "items", "spells": "items"}


def public_rows(kind, frac=1.0, seed=7):
    """(list id, DeepScore, next-patch lead, next-patch games) for every row present on both patches."""
    rng = random.Random(seed)
    out = []
    for T, N in zip(PATCHES, PATCHES[1:]):
        A, B = lists(T, kind), lists(N, kind)
        for c, now in A.items():
            if frac < 1:
                now = thin(now, frac, rng)
            if len(now) < 5 or c not in B:
                continue
            D = deep(scores(now, FIT.get(FITKEY[kind])))
            Y = leads(B[c])
            for k, ds in D.items():
                if k in Y:
                    out.append((f"{T}/{c}", ds, Y[k][0], Y[k][2]))
    return out


def by_tier(rows, cuts=CUTS):
    acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0])  # sum w*y, sum w, sum w*y^2, n
    for _, ds, y, g in rows:
        a = acc[tier_of(ds, cuts)]
        a[0] += g * y; a[1] += g; a[2] += g * y * y; a[3] += 1
    res = {}
    for t in TIERS:
        sy, sw, syy, n = acc[t]
        if not sw:
            continue
        m = sy / sw
        var = max(syy / sw - m * m, 0)
        # effective n for weighted mean (Kish) is approximated by the row count, conservative for skewed games
        res[t] = (m, math.sqrt(var / max(n, 1)), n)
    return res


def hist(rows):
    """Per list: games, games*lead, games*lead^2 at each DeepScore 0-100 (so any cuts score in O(101))."""
    H = defaultdict(lambda: np.zeros((3, 101)))
    for k, ds, y, g in rows:
        h = H[k]
        h[0, ds] += g; h[1, ds] += g * y; h[2, ds] += g * y * y
    return H


def r2h(h, cuts):
    """Between-tier share of the games-weighted variance of next-patch lead."""
    w, wy, wyy = h
    tot = wyy.sum() - wy.sum() ** 2 / w.sum()
    edges = [101] + list(cuts) + [0]
    between = 0.0
    my = wy.sum() / w.sum()
    for hi, lo in zip(edges, edges[1:]):
        sw = w[lo:hi].sum()
        if sw:
            between += sw * (wy[lo:hi].sum() / sw - my) ** 2
    return between / tot if tot > 0 else 0.0


GRID = list(combinations(range(85, 19, -3), 4))


def sweep(rows, boot=200, seed=3):
    H = hist(rows)
    keys = list(H)
    stack = np.stack([H[k] for k in keys])
    full = stack.sum(0)
    best = max(GRID, key=lambda c: r2h(full, c))
    base, top = r2h(full, CUTS), r2h(full, best)
    rng = np.random.default_rng(seed)
    gains = []
    for _ in range(boot):
        h = stack[rng.integers(0, len(keys), len(keys))].sum(0)
        gains.append(r2h(h, best) - r2h(h, CUTS))
    lo, hi = np.percentile(gains, [2.5, 97.5])
    return best, base, top, lo, hi


def fmt(T):
    return "  ".join(f"{t} {m * 100:+.2f}±{se * 100:.2f} (n {n})" for t, (m, se, n) in T.items())


def public_report():
    out = {}
    for kind in ("champions", "augments", "items", "spells"):
        for label, frac in (("full", 1.0), ("thinned 10%", 0.1)):
            rows = public_rows(kind, frac)
            T = by_tier(rows)
            mono = all(T[a][0] > T[b][0] for a, b in zip(TIERS, TIERS[1:]) if a in T and b in T)
            best, base, top, lo, hi = sweep(rows)
            print(f"\n{kind} ({label}), {len(rows)} rows: next-patch lead by tier (pts, games-weighted)")
            print("  " + fmt(T))
            print(f"  monotonic: {mono}; R2 today {base:.3f}; best grid cuts {best} R2 {top:.3f}; gain 95% [{lo:+.3f}, {hi:+.3f}]")
            out[(kind, label)] = dict(tiers={t: [round(m * 100, 2), round(se * 100, 2), n] for t, (m, se, n) in T.items()},
                                      monotonic=mono, r2=round(base, 3), best=best, best_r2=round(top, 3), gain=[round(lo, 3), round(hi, 3)])
    return out


def prev_patch(p):
    return PATCHES[PATCHES.index(p) - 1] if p in PATCHES and PATCHES.index(p) > 0 else None


def archive_report(path):
    if not os.path.exists(path):
        print("\n(no archive file; skipping Nico's games)")
        return {}
    games = json.load(open(path))
    want = {f"16.{n}" for n in range(19, 24)}
    norm = lambda p: p if p in want else None  # noqa: E731
    cache = {}

    def tiers(p, kind, champ):
        key = (p, kind, champ)
        if key not in cache:
            L = lists(p, kind)
            now = L.get("all" if kind == "champions" else str(champ))
            cache[key] = deep(scores(now, FIT.get(FITKEY[kind]))) if now and len(now) >= 5 else {}
        return cache[key]

    acc = {k: defaultdict(lambda: [0, 0]) for k in ("champions", "augments", "items")}
    used = 0
    for g in games:
        p = norm(g.get("patch"))
        q = prev_patch(p) if p else None
        if not q:
            continue
        used += 1
        c = g["champion_id"]
        w = 1 if g["win"] else 0
        ch = tiers(q, "champions", c).get(str(c))
        if ch is not None:
            a = acc["champions"][tier_of(ch)]; a[0] += w; a[1] += 1
        A = tiers(q, "augments", c)
        for aug in g.get("augments") or []:
            ds = A.get(str(aug))
            if ds is not None:
                a = acc["augments"][tier_of(ds)]; a[0] += w; a[1] += 1
        I = tiers(q, "items", c)
        for it in g.get("items_in_order") or []:
            ds = I.get(str(it))
            if ds is not None:
                a = acc["items"][tier_of(ds)]; a[0] += w; a[1] += 1
    print(f"\nNico's archive: {used} player-games on 16.20-16.23 (tiered with the previous patch's public data)")
    out = {}
    for kind, A in acc.items():
        parts = []
        out[kind] = {}
        for t in TIERS:
            w, n = A[t]
            if n:
                p = w / n
                parts.append(f"{t} {p * 100:.1f}%±{math.sqrt(p * (1 - p) / n) * 100:.1f} (n {n})")
                out[kind][t] = [round(p * 100, 1), n]
        print(f"  {kind}: " + "  ".join(parts))
    return out


if __name__ == "__main__":
    res = {"public": {f"{k} | {l}": v for (k, l), v in public_report().items()}}
    res["archive"] = archive_report(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/aramhex/archive-players.json")
    json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tier_cuts.json"), "w"), indent=1, default=list)
