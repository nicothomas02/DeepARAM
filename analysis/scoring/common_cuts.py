"""One set of cuts for every list (the site's one scale): the grid cut set that best explains next-patch lead averaged over
all 8 list x data cases, its bootstrap gain over today's cuts, and each tier's share of games. Run after tier_cuts.py."""
import sys, numpy as np
sys.path.insert(0, '.')
import tier_cuts as tc
data = {}
for kind in ("champions", "augments", "items", "spells"):
    for frac in (1.0, 0.1):
        rows = tc.public_rows(kind, frac)
        H = tc.hist(rows); keys = list(H)
        data[(kind, frac)] = np.stack([H[k] for k in keys])
def score(c, hs=None):
    return np.mean([tc.r2h((hs or {}).get(k, s.sum(0)) if hs else s.sum(0), c) for k, s in data.items()])
best = max(tc.GRID, key=score)
print("common best", best, round(score(best), 3), "today", round(score(tc.CUTS), 3))
rng = np.random.default_rng(5); g = []
for _ in range(200):
    hs = {k: s[rng.integers(0, len(s), len(s))].sum(0) for k, s in data.items()}
    g.append(score(best, hs) - score(tc.CUTS, hs))
print("gain 95%", np.percentile(g, [2.5, 97.5]).round(3))
for c in (tc.CUTS, best):
    for k, s in data.items():
        w = s.sum(0)[0]; edges = [101] + list(c) + [0]
        print(c, k, [round(w[lo:hi].sum() / w.sum() * 100) for hi, lo in zip(edges, edges[1:])], round(tc.r2h(s.sum(0), c), 3))
