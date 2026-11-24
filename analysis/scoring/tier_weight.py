"""Tier List: does more weight on win rate (less on sample size) pick better? (Nico 2026-11-24: "Test tier list with
more weight to win rate".) Score = fitted estimate - Z x typical miss (lib/deepscore.ts uses Z = 1). Lower Z leans on
the win rate itself; Z = 0 is the estimate alone. Judged on the next patch: Spearman rank correlation with next
patch's win rate (rows with 2,000+ games next patch) and the next-patch lead of the top 10 rows (pts).

Run: python3 analysis/scoring/tier_weight.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backtest import FIT, PATCHES, leads, load, rows_of, spearman, tau2_of, thin  # noqa: E402
import random  # noqa: E402

ZS = [1.0, 0.75, 0.5, 0.25, 0.0]


def scored(rows, fit, z):
    L = leads(rows)
    t2 = tau2_of(L)
    b, s0 = fit["b"], fit["s0"]
    return {k: b * t2 / (t2 + v) * x - z * math.sqrt(s0 * s0 + v) for k, (x, v, g) in L.items()}


def run(lists, fitkey, frac=1.0, top=10):
    rng = random.Random(1)
    out = {z: {"rho": [], "top": []} for z in ZS}
    for T, N in zip(PATCHES, PATCHES[1:]):
        for now, nxt in lists(T, N):
            if frac < 1:
                now = thin(now, frac, rng)
            if len(now) < 5:
                continue
            Y = leads(nxt)
            for z in ZS:
                S = scored(now, FIT[fitkey], z)
                big = [k for k in S if k in Y and Y[k][2] >= 2000]
                r = spearman([S[k] for k in big], [Y[k][0] for k in big])
                if r is not None:
                    out[z]["rho"].append(r)
                best = [k for k in sorted(S, key=lambda k: -S[k]) if k in Y][:top]
                out[z]["top"].append(sum(Y[k][0] for k in best) / len(best))
    return out


def champions(T, N):
    a, b = load(T, "heroes"), load(N, "heroes")
    if a and b:
        yield {k: v for k, v in a.items() if v[0] > 0}, {k: v for k, v in b.items() if v[0] > 0}


def augments(T, N):
    a, b = load(T, "augments"), load(N, "augments")
    if a and b:
        for c in a:
            yield rows_of(a, c), rows_of(b, c)


if __name__ == "__main__":
    for name, lists, fk, top in (("Champions", champions, "champions", 10), ("Augments per champion", augments, "augments", 5)):
        for frac in (1.0, 0.1):
            res = run(lists, fk, frac, top)
            print(f"\n{name} ({'full' if frac == 1 else 'thinned 10%'}), top {top}")
            print("Z".ljust(6) + "rho".rjust(10) + f"top{top} lead".rjust(14))
            for z in ZS:
                r, t = res[z]["rho"], res[z]["top"]
                print(f"{z:<6}{sum(r) / len(r):+10.4f}{sum(t) / len(t) * 100:+14.3f}")
