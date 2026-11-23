"""Backtest: does pooling earlier patches (decay-weighted, dropping a patch whose lead disagrees) predict next-patch
augment leads better than the current patch alone? Data: data/aramhex/patches/<p>/augments.json + heroes.json.

Lead = augment win rate on the champion - the champion's pick-weighted augment mean that patch, so champion buffs and
nerfs between patches cancel out. Scores are EB-shrunk like web/src/lib/card-score.ts scoreRows."""
import json, math, os, sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "aramhex", "patches")
PATCHES = ["16.19", "16.20", "16.21", "16.22", "16.23"]


def load(p, name):
    with open(os.path.join(ROOT, p, name)) as f:
        return json.load(f)


def leads(table):
    """{champ: {key: (lead, var, n)}} from {champ: {key: [games, wins]}} (augments) or {champ:{all,items}}."""
    out = {}
    for c, rows in table.items():
        if "items" in rows and "all" in rows:
            rows = rows["items"]
        rows = {k: v for k, v in rows.items() if v[0] > 0}
        tot = sum(g for g, _ in rows.values())
        if not tot:
            continue
        mean = sum(w for _, w in rows.values()) / tot
        out[c] = {k: (w / g - mean, max(w / g * (1 - w / g), 0.05) / g, g) for k, (g, w) in rows.items()}
    return out


def true_spread(xs, vs):
    if not xs:
        return 1e-4
    m = sum(xs) / len(xs)
    total = sum((x - m) ** 2 for x in xs) / len(xs)
    return max(total - sum(vs) / len(vs), 1e-5)


def pooled(hist, decay, z):
    """hist: list of {key:(lead,var,n)} newest first. Returns {key: (lead, var, n_now, n_eff)}."""
    now = hist[0]
    out = {}
    for k, (x0, v0, n0) in now.items():
        ws, xs, vs = [1 / v0], [x0], [v0]
        for age, older in enumerate(hist[1:], 1):
            if k not in older or decay == 0:
                break  # a gap breaks the chain: the row wasn't offered or wasn't the same
            x, v, n = older[k]
            if z and abs(x - x0) > z * math.sqrt(v + v0):
                break  # changed: this and older patches are dropped
            ws.append(decay ** age / v)
            xs.append(x)
            vs.append(v)
        W = sum(ws)
        est = sum(w * x for w, x in zip(ws, xs)) / W
        var = sum(w * w * v for w, v in zip(ws, vs)) / W / W
        out[k] = (est, var, n0, (est * (1 - est) if False else 0.25) / var if var else 0)
    return out


def shrink(rows):
    keys = list(rows)
    xs = [rows[k][0] for k in keys]
    vs = [rows[k][1] for k in keys]
    tau2 = true_spread(xs, vs)
    return {k: tau2 / (tau2 + v) * x for k, x, v in zip(keys, xs, vs)}


def evaluate(file, patches, configs, top=5, follow=0.25, small=2000):
    res = defaultdict(lambda: defaultdict(list))
    for i in range(1, len(patches) - 1):
        T, nxt = patches[i], patches[i + 1]
        hist_tables = [leads(load(p, file)) for p in reversed(patches[: i + 1])]  # newest first
        target = leads(load(nxt, file))
        for name, (decay, z, depth) in configs.items():
            for c, rows_now in hist_tables[0].items():
                if c not in target:
                    continue
                hist = [h.get(c, {}) for h in hist_tables[: depth + 1]]
                p = pooled(hist, decay, z)
                s = shrink(p)
                maxn = max(r[2] for r in rows_now.values())
                ok = [k for k in s if rows_now[k][2] >= follow * maxn or rows_now[k][2] >= 2000]
                best = sorted(ok, key=lambda k: -s[k])[:top]
                for k in best:
                    if k in target[c]:
                        res[name][f"top{top} lead {T}->{nxt}"].append((target[c][k][0], target[c][k][2]))
                # prediction error on every row, and on small-sample rows
                for k, est in s.items():
                    if k not in target[c]:
                        continue
                    y, vy, ny = target[c][k]
                    err = (est - y) ** 2 - vy
                    res[name][f"mse {T}->{nxt}"].append((err, ny))
                    if rows_now[k][2] < small:
                        res[name][f"mse small {T}->{nxt}"].append((err, ny))
    return res


def report(res):
    names = list(res)
    keys = sorted({k for r in res.values() for k in r}, key=lambda k: (k.split()[0], k))
    print("metric".ljust(28) + "".join(n.rjust(16) for n in names))
    for k in keys:
        line = k.ljust(28)
        for n in names:
            v = res[n].get(k, [])
            if k.startswith("top"):
                m = sum(x for x, _ in v) / len(v) * 100 if v else float("nan")  # unweighted mean lead, pts
                line += f"{m:+16.2f}"
            else:
                W = sum(w for _, w in v)
                m = sum(e * w for e, w in v) / W * 1e4 if W else float("nan")  # pts^2
                line += f"{m:16.3f}"
        print(line)


if __name__ == "__main__":
    file = sys.argv[1] if len(sys.argv) > 1 else "augments.json"
    pats = [p for p in PATCHES if os.path.exists(os.path.join(ROOT, p, file))]
    configs = {
        "this patch": (0, 0, 0),
        "d0.5 z2": (0.5, 2, 2),
        "d0.5 z3": (0.5, 3, 2),
        "d0.5 z4 (shipped)": (0.5, 4, 2),
        "d0.5 nogate": (0.5, 0, 2),
        "d1.0 z2": (1.0, 2, 2),
        "d0.25 z2": (0.25, 2, 2),
    }
    print(file, pats)
    report(evaluate(file, pats, configs))
