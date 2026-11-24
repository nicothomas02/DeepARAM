"""One DeepScore method for every list? (Nico 2026-11-24: "make DeepScore consistent across ratings while maintaining
what it displays".) Today the bound rule (backtest.py) scores champions, augments, single items and spell pairs, while
cores and boots score on the shrunk lead (no fitted carry-over, no penalty for a wide range) and starters on the
fitted estimate without the penalty. This scores each list on patch T with each rule, under the card's lead rule (a
row needs 1,000 real games, card-score.ts MIN_GAMES), and judges on patch T+1: the next-patch lead (pts) of the top
row and of the top 3, paired against today's rule per champion, and Spearman rho of score vs next-patch lead over
rows with 2,000+ games next patch.

Run: python3 analysis/scoring/consistency.py
"""
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backtest import FIT, PATCHES, leads, load, scores, spearman, thin  # noqa: E402
from following_sweep import rows  # noqa: E402

MIN_GAMES = 1000
RULES = ["shrunk", "est", "bound"]
# list, fit, today's rule
LISTS = [("augments", "augments", "bound"), ("items", "items", "bound"), ("spells", "items", "bound"),
         ("boots", "items", "shrunk"), ("cores", "items", "shrunk")]


def run(name, fitkey, today, frac, seed=1):
    rng = random.Random(seed)
    fit = FIT.get(fitkey) or {}
    diff = defaultdict(list)
    rho = defaultdict(list)
    n = 0
    for T, N in zip(PATCHES, PATCHES[1:]):
        a, b = load(T, name), load(N, name)
        if not a or not b:
            continue
        for c in a:
            now = rows(a, c, name)
            now = thin(now, frac, rng) if frac < 1 else now
            if len(now) < 3:
                continue
            S = scores(now, fit)
            for k in S:
                S[k]["est"] = fit.get("b", 1.0) * S[k]["shrunk"]
            Y = leads(rows(b, c, name))
            ok = [k for k in S if now[k][0] >= MIN_GAMES] or [max(S, key=lambda k: now[k][0])]
            got = {}
            for r in RULES:
                order = [k for k in sorted(ok, key=lambda k: -S[k][r]) if k in Y]
                if not order:
                    break
                got[r] = (Y[order[0]][0], sum(Y[k][0] for k in order[:3]) / len(order[:3]))
                big = [k for k in S if k in Y and Y[k][2] >= 2000]
                if len(big) >= 4:
                    rr = spearman([S[k][r] for k in big], [Y[k][0] for k in big])
                    if rr is not None:
                        rho[r].append(rr)
            else:
                n += 1
                for r in RULES:
                    diff[(r, "top1")].append(got[r][0] - got[today][0])
                    diff[(r, "top3")].append(got[r][1] - got[today][1])
    return n, diff, rho


def fmt(v):
    if not v:
        return "n/a".rjust(16)
    m = sum(v) / len(v)
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / max(1, len(v) - 1))
    return f"{m * 100:+.2f} ± {sd / math.sqrt(len(v)) * 100:.2f}".rjust(16)


if __name__ == "__main__":
    for name, fk, today in LISTS:
        for frac in (1.0, 0.1):
            n, diff, rho = run(name, fk, today, frac)
            print(f"\n{name} ({'full' if frac == 1 else 'thinned 10%'}), today: {today}, {n} champion-patches")
            print("rule".ljust(8) + "top1 vs today".rjust(16) + "top3 vs today".rjust(16) + "rho".rjust(8))
            for r in RULES:
                rr = rho[r]
                print(f"{r:<8}{fmt(diff[(r, 'top1')])}{fmt(diff[(r, 'top3')])}{(sum(rr) / len(rr) if rr else float('nan')):8.3f}")
