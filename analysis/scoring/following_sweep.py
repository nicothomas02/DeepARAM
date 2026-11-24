"""How much should a row's popularity hold it back? Sweep of the following rule's threshold (Nico 2026-11-24: "give
more weight to win rate and less on pick rate").

Cards rank each list on the bound rule (backtest.py) but only rows with at least SHARE of the top row's games may lead
(card-score.ts MIN_FOLLOWING = 0.25; spell pairs 0.05 from PR #668). This scores patch T with each SHARE and judges the
pick on patch T+1's games, which the rule never saw: the next-patch lead (win rate minus the list's games-weighted
average, pts) of the card's top row and of its top 3, paired against SHARE = 0.25 per champion.

Run: python3 analysis/scoring/following_sweep.py
"""
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backtest import FIT, PATCHES, leads, load, rows_of, scores, thin  # noqa: E402

SHARES = [0.25, 0.10, 0.05, 0.02, 0.0]
LISTS = [("augments", "augments"), ("spells", "items"), ("items", "items"), ("boots", "items"), ("cores", "items")]


def rows(table, c, name):
    if name == "cores":
        return {"+".join(map(str, r[0])): [r[1], r[2]] for r in table.get(c) or [] if r[1] > 0}
    return rows_of(table, c)


def run(name, fitkey, frac, seed=1):
    rng = random.Random(seed)
    res = defaultdict(list)  # (share, metric) -> [paired diff vs 0.25 per champion-patch]
    absol = defaultdict(list)
    changed = defaultdict(int)
    for T, N in zip(PATCHES, PATCHES[1:]):
        a, b = load(T, name), load(N, name)
        if not a or not b:
            continue
        for c in a:
            now = rows(a, c, name)
            now = thin(now, frac, rng) if frac < 1 else now
            nxt = rows(b, c, name)
            if len(now) < 3:
                continue
            S = scores(now, FIT.get(fitkey))
            Y = leads(nxt)
            maxn = max(g for g, _ in now.values())
            base = None
            for sh in SHARES:
                ok = [k for k in S if now[k][0] >= sh * maxn]
                order = sorted(ok, key=lambda k: -S[k]["bound"])
                top1 = [k for k in order[:1] if k in Y]
                top3 = [k for k in order[:3] if k in Y]
                if not top1:
                    break
                m1, m3 = Y[top1[0]][0], sum(Y[k][0] for k in top3) / len(top3)
                if base is None:
                    base = (m1, m3, top1[0])
                res[(sh, "top1")].append(m1 - base[0])
                res[(sh, "top3")].append(m3 - base[1])
                absol[(sh, "top1")].append(m1)
                changed[sh] += top1[0] != base[2]
            else:
                changed["n"] += 1
    return res, absol, changed


def fmt(v):
    if not v:
        return "n/a".rjust(16)
    m = sum(v) / len(v)
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / max(1, len(v) - 1))
    return f"{m * 100:+.2f} ± {sd / math.sqrt(len(v)) * 100:.2f}".rjust(16)


if __name__ == "__main__":
    print("Paired next-patch lead vs SHARE = 0.25 (pts, ± 1 standard error); 'top1 now' = the card's top row as is;")
    print("'changed' = champions whose top row changes.")
    for name, fk in LISTS:
        for frac in (1.0, 0.1):
            res, absol, ch = run(name, fk, frac)
            n = ch["n"]
            tag = "full" if frac == 1 else "thinned 10%"
            print(f"\n{name} ({tag}), {n} champion-patches")
            print("share".ljust(8) + "top1 vs 0.25".rjust(16) + "top3 vs 0.25".rjust(16) + "top1 now".rjust(12) + "changed".rjust(10))
            for sh in SHARES:
                a = absol[(sh, "top1")]
                print(f"{sh:<8}{fmt(res[(sh, 'top1')])}{fmt(res[(sh, 'top3')])}{(sum(a) / len(a) * 100 if a else float('nan')):+12.2f}{ch[sh]:>10}")
