"""Backtest: should the pooling window adapt per champion (Nico 2026-11-24)?

Shipped rule (data/aramhex/common.py pool): each row pools up to 2 earlier patches at decay 0.5 and drops an earlier
patch whose lead differs by more than 4 standard errors (a per-row change gate). This script asks whether a longer
window where a champion is stable, and a champion-wide cut where it changed, predict the next patch better.

Variants
  shipped        depth 2, decay 0.5, row gate 4 SE
  deeper         depth 4, same decay and gate
  deeper d.75    depth 4, decay 0.75
  deeper d1      depth 4, decay 1.0 (no decay: the gates do all the work)
  +champ gate    a champion-wide change test: across the champion's shared rows, mean of (x-x0)^2/(v+v0) is a chi-square
                 statistic per row; if it exceeds 1 + 3*sqrt(2/m) (about p < 0.002) that patch and older are dropped for
                 every row of the champion
  +pool gate     the champion's augment offer changed: a row with >= 1% of picks in the older patch is gone now, or a new
                 row has >= 1% now -> that older patch is dropped for the champion (the Armored Impact case)
Scenarios: full live patch, and live patch thinned to 10% of its games (like a patch's first day).
Metrics: next-patch squared error of the shrunk lead minus the target's own noise (pts^2, games-weighted), all rows and
rows under 2,000 games; mean next-patch lead of the top 5 picks (pts).

Result (2026-11-24, augments 16.19-16.23): a longer window changes almost nothing (small-row error 2.40 -> 2.33 at
decay 0.75, top-5 lead equal), because the per-row gate and missing rows already end most chains. Champion-wide cuts
hurt: small-row error 2.40 -> 3.28 (champion gate) and 3.24 (pool gate), top-5 lead equal or 0.01 lower. Leads are
measured against the champion's own average, so champion buffs and nerfs already cancel. Kept the shipped rule.

Usage: python3 analysis/pooling/adaptive.py [augments.json|spells.json|items.json]"""
import math, os, random, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from backtest import ROOT, PATCHES, load, leads, shrink  # noqa: E402


def champ_changed(now, older, k=3.0):
    shared = [r for r in now if r in older]
    if len(shared) < 3:
        return False
    q = sum((now[r][0] - older[r][0]) ** 2 / (now[r][1] + older[r][1]) for r in shared) / len(shared)
    return q > 1 + k * math.sqrt(2 / len(shared))


def pool_changed(now, older, share=0.01):
    def big(t):
        tot = sum(n for _, _, n in t.values()) or 1
        return {r for r, (_, _, n) in t.items() if n / tot >= share}
    return bool(big(older) - set(now)) or bool(big(now) - set(older))


def pooled(hist, decay, z, champ_gate=False, pool_gate=False):
    now = hist[0]
    cut = len(hist)
    for age, older in enumerate(hist[1:], 1):
        if (champ_gate and champ_changed(now, older)) or (pool_gate and pool_changed(now, older)):
            cut = age
            break
    out = {}
    for key, (x0, v0, n0) in now.items():
        ws, xs, vs = [1 / v0], [x0], [v0]
        for age, older in enumerate(hist[1:cut], 1):
            if key not in older or decay == 0:
                break
            x, v, _ = older[key]
            if z and abs(x - x0) > z * math.sqrt(v + v0):
                break
            ws.append(decay ** age / v)
            xs.append(x)
            vs.append(v)
        W = sum(ws)
        est = sum(w * x for w, x in zip(ws, xs)) / W
        var = sum(w * w * v for w, v in zip(ws, vs)) / W / W
        out[key] = (est, var, n0)
    return out


def thin(table, frac, rng):
    out = {}
    for c, rows in table.items():
        if isinstance(rows, dict) and "items" in rows and "all" in rows:
            rows = rows["items"]
        t = {}
        for k, (g, w) in rows.items():
            g2 = sum(1 for _ in range(g) if rng.random() < frac) if g < 2000 else int(round(g * frac))
            if g2 <= 0:
                continue
            p = w / g if g else 0
            w2 = sum(1 for _ in range(g2) if rng.random() < p) if g2 < 2000 else int(round(g2 * p))
            t[k] = [g2, w2]
        out[c] = t
    return out


CONFIGS = {
    "shipped": dict(decay=0.5, z=4, depth=2),
    "deeper": dict(decay=0.5, z=4, depth=4),
    "deeper d.75": dict(decay=0.75, z=4, depth=4),
    "deeper d1": dict(decay=1.0, z=4, depth=4),
    "+champ gate": dict(decay=0.75, z=4, depth=4, champ_gate=True),
    "+pool gate": dict(decay=0.75, z=4, depth=4, pool_gate=True),
    "+both": dict(decay=0.75, z=4, depth=4, champ_gate=True, pool_gate=True),
    "shipped+both": dict(decay=0.5, z=4, depth=2, champ_gate=True, pool_gate=True),
}


def evaluate(file, patches, frac, seed=1, top=5, small=2000):
    rng = random.Random(seed)
    res = defaultdict(lambda: defaultdict(list))
    cuts = defaultdict(int)
    for i in range(1, len(patches) - 1):
        T, nxt = patches[i], patches[i + 1]
        raw_now = load(T, file)
        now_t = leads(thin(raw_now, frac, rng) if frac < 1 else raw_now)
        hist_tables = [now_t] + [leads(load(p, file)) for p in reversed(patches[:i])]
        target = leads(load(nxt, file))
        for name, cfg in CONFIGS.items():
            for c, rows_now in hist_tables[0].items():
                if c not in target or not rows_now:
                    continue
                hist = [h.get(c, {}) for h in hist_tables[: cfg["depth"] + 1]]
                p = pooled(hist, cfg["decay"], cfg["z"], cfg.get("champ_gate"), cfg.get("pool_gate"))
                s = shrink(p)
                maxn = max(r[2] for r in rows_now.values())
                ok = [k for k in s if rows_now[k][2] >= 0.25 * maxn or rows_now[k][2] >= 2000]
                for k in sorted(ok, key=lambda k: -s[k])[:top]:
                    if k in target[c]:
                        res[name]["top5 lead"].append((target[c][k][0], 1))
                for k, est in s.items():
                    if k not in target[c]:
                        continue
                    y, vy, ny = target[c][k]
                    err = (est - y) ** 2 - vy
                    res[name]["mse all"].append((err, ny))
                    if rows_now[k][2] < small:
                        res[name]["mse small"].append((err, ny))
    return res


def report(res):
    names = list(res)
    print("metric".ljust(12) + "".join(n.rjust(14) for n in names))
    for k in ("mse all", "mse small", "top5 lead"):
        line = k.ljust(12)
        for n in names:
            v = res[n].get(k, [])
            W = sum(w for _, w in v)
            m = sum(e * w for e, w in v) / W if W else float("nan")
            line += f"{m * (100 if k.startswith('top') else 1e4):14.3f}"
        print(line)


if __name__ == "__main__":
    file = sys.argv[1] if len(sys.argv) > 1 else "augments.json"
    pats = [p for p in PATCHES if os.path.exists(os.path.join(ROOT, p, file))]
    print(file, pats)
    for frac in (1.0, 0.1):
        print(f"\nlive patch at {int(frac * 100)}% of its games")
        report(evaluate(file, pats, frac))
