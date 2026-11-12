# Simulator validation report: how well simulated fights line up with real games, with uncertainty.
#
# Extends tools/accuracy.py (which prints the numbers for a quick look) into a report the site reads:
#   - rank correlation (Spearman) of simulated damage per second with each champion's real damage share, and of
#     simulated damage taken with the real share of damage taken, each with a 95% bootstrap interval
#     (champions resampled 2,000 times), overall and within each role;
#   - a role-adjusted model, log(real share) = a + b log(simulated DPS) + one term per role, scored leave-one-out
#     so it can't flatter itself, with its calibration (predicted vs real share in five bins), calibration slope,
#     R squared and mean absolute error in share points;
#   - residuals by role (does the simulator over- or underrate a whole role?) and the champions furthest off;
#   - history: the same check replayed on earlier versions of the simulator (`history` mode), so the accuracy
#     trend is measured with one fixed yardstick: today's real builds and today's real shares.
#
#   python3 tools/validation.py report ./mayhem_sim analysis/validation.json [trials]
#   python3 tools/validation.py history analysis/validation-history.json [commit ...]
# history checks out each commit into a scratch work tree, builds its simulator and scores it; with no commits it
# replays the milestones listed in MILESTONES. Results are merged into the history file by commit.
import json, math, os, random, statistics as st, subprocess, sys, tempfile, concurrent.futures as cf, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from real_builds import R, load as load_ids, real_build, spearman

TARGET_CHAMPS = json.load(open(f"{R}/simulator/data/champions.json"))["champions"]
REAL = {c["champion_id"]: c for c in json.load(open(f"{R}/data/cn/champions.json"))["champions"]}
BOOT = 2000


def evaluate(sim, game_dir, trials="200", simdir=f"{R}/simulator", threads=None):
    """Each champion's most-played real build in the simulator at `sim` with game data `game_dir`."""
    by_id, aug_by_id = load_ids(game_dir)
    known = {c["id"] for c in json.load(open(f"{game_dir}/champions.json"))["champions"]}

    def run(c):
        if c["id"] not in known: return None
        b = real_build(c, by_id, aug_by_id)
        if not b: return None
        it, au = b
        args = [sim, "--champ", c["id"], "--items", ",".join(it), "--json", "--trials", str(trials), "--threads", "1", "--seed", "7"]
        if au: args += ["--augs", ",".join(au)]
        r = subprocess.run(args, capture_output=True, text=True, cwd=simdir)
        try: s = json.loads(r.stdout)["builds"][0]["summary"]
        except Exception: return None
        cn = c.get("cn") or {}
        return dict(champ=c["id"], role=c.get("role"), cn=cn.get("damage_share"),
                    tank=REAL.get(c["champion_id"], {}).get("avg_tank_ratio"),
                    dps=s["mean_dps"], taken=s.get("damage_taken"), alive=s.get("time_alive"))

    with cf.ThreadPoolExecutor(threads or os.cpu_count() or 4) as ex:
        return [r for r in ex.map(run, TARGET_CHAMPS) if r]


def boot_ci(xs, ys, seed=1):
    rng = random.Random(seed); n = len(xs); vals = []
    for _ in range(BOOT):
        idx = [rng.randrange(n) for _ in range(n)]
        vals.append(spearman([xs[i] for i in idx], [ys[i] for i in idx]))
    vals.sort()
    return [round(vals[int(0.025 * BOOT)], 3), round(vals[int(0.975 * BOOT) - 1], 3)]


def corr(xs, ys, ci=True):
    out = {"rho": round(spearman(xs, ys), 3), "n": len(xs)}
    if ci and len(xs) > 4: out["ci95"] = boot_ci(xs, ys)
    return out


def solve(A, v):
    k = len(v); A = [row[:] for row in A]; v = v[:]
    for i in range(k): A[i][i] += 1e-9
    for i in range(k):
        p = max(range(i, k), key=lambda q: abs(A[q][i])); A[i], A[p] = A[p], A[i]; v[i], v[p] = v[p], v[i]
        for q in range(k):
            if q != i and A[i][i]:
                m = A[q][i] / A[i][i]; v[q] -= m * v[i]
                for j in range(k): A[q][j] -= m * A[i][j]
    return [v[i] / A[i][i] if A[i][i] else 0.0 for i in range(k)]


def ols(X, y):
    k = len(X[0]); A = [[sum(r[i] * r[j] for r in X) for j in range(k)] for i in range(k)]
    return solve(A, [sum(r[i] * t for r, t in zip(X, y)) for i in range(k)])


def role_model(x, with_dps=True):
    roles = sorted({r["role"] for r in x})
    dps = (lambda r: [math.log(max(r["dps"], 1.0))]) if with_dps else (lambda r: [])
    feats = lambda r: [1.0] + dps(r) + [1.0 if r["role"] == ro else 0.0 for ro in roles[1:]]
    X = [feats(r) for r in x]; y = [math.log(r["cn"]) for r in x]
    pred = []
    for i in range(len(x)):
        b = ols(X[:i] + X[i + 1:], y[:i] + y[i + 1:])
        pred.append(sum(p * q for p, q in zip(b, X[i])))
    full = ols(X, y)
    my = st.mean(y)
    r2 = 1 - sum((a - b) ** 2 for a, b in zip(y, pred)) / sum((a - my) ** 2 for a in y)
    # Calibration slope: regress real on predicted (1 = predictions are spread right; below 1 = too spread out).
    cal = ols([[1.0, p] for p in pred], y)[1]
    share_pred = [math.exp(p) for p in pred]
    mae = st.mean(abs(a - r["cn"]) for a, r in zip(share_pred, x))
    order = sorted(range(len(x)), key=lambda i: share_pred[i])
    bins = []
    for k in range(5):
        idx = order[k * len(x) // 5:(k + 1) * len(x) // 5]
        real = [x[i]["cn"] for i in idx]
        se = st.stdev(real) / math.sqrt(len(real)) if len(real) > 1 else 0
        bins.append({"n": len(idx), "predicted": round(100 * st.mean(share_pred[i] for i in idx), 2),
                     "real": round(100 * st.mean(real), 2), "real_ci95": [round(100 * (st.mean(real) - 1.96 * se), 2), round(100 * (st.mean(real) + 1.96 * se), 2)]})
    resid = [(y[i] - pred[i], x[i]) for i in range(len(x))]
    return {
        "spearman": corr(pred, [r["cn"] for r in x]),
        "r2_log": round(r2, 3), "calibration_slope": round(cal, 3), "mae_points": round(100 * mae, 2),
        "dps_coefficient": round(full[1], 3) if with_dps else None, "bins": bins,
    }, resid


def report(rows):
    x = [r for r in rows if r["cn"] and r["dps"] > 0]
    t = [r for r in rows if r.get("tank") and r.get("taken") is not None]
    out = {
        "n": len(x),
        "dps_vs_damage_share": corr([r["dps"] for r in x], [r["cn"] for r in x]),
        "taken_vs_tank_share": corr([r["taken"] for r in t], [r["tank"] for r in t]) if t else None,
    }
    roles = sorted({r["role"] for r in x})
    model, resid = role_model(x)
    out["role_adjusted"] = model
    # Baseline: role alone, no simulation. What the simulator adds is the gap between the two.
    base, _ = role_model(x, with_dps=False)
    out["role_only"] = {k: base[k] for k in ("spearman", "r2_log", "mae_points")}
    # Raw bias per role: simulated DPS relative to the median, against real share relative to the median.
    md, mc = st.median(r["dps"] for r in x), st.median(r["cn"] for r in x)
    out["roles"] = []
    for ro in roles:
        rr = [r for r in x if r["role"] == ro]
        rs = [d for d, r in resid if r["role"] == ro]
        ratio = [math.log((r["dps"] / md) / (r["cn"] / mc)) for r in rr]
        out["roles"].append({
            "role": ro, "n": len(rr),
            "within": corr([r["dps"] for r in rr], [r["cn"] for r in rr]) if len(rr) > 5 else None,
            # Above 0: the simulator rates the role higher than real games do (before the role term).
            "raw_bias": round(st.mean(ratio), 3), "raw_bias_se": round(st.stdev(ratio) / math.sqrt(len(ratio)), 3) if len(ratio) > 1 else None,
            "resid_sd": round(st.stdev(rs), 3) if len(rs) > 1 else None,
        })
    resid.sort(key=lambda d: d[0])
    pick = lambda d, r: {"champion": r["champ"], "role": r["role"], "residual": round(d, 2),
                         "factor": round(math.exp(d), 2), "real_share": round(100 * r["cn"], 1), "sim_dps": round(r["dps"])}
    # + the simulator underrates them (real share above the fit), - overrates them.
    out["underrated"] = [pick(d, r) for d, r in resid[::-1][:10] if d > 0]
    out["overrated"] = [pick(d, r) for d, r in resid[:10] if d < 0]
    return out


def summary_row(rep):
    return {"spearman": rep["dps_vs_damage_share"]["rho"], "ci95": rep["dps_vs_damage_share"].get("ci95"),
            "role_adjusted": rep["role_adjusted"]["spearman"]["rho"],
            "taken": rep["taken_vs_tank_share"]["rho"] if rep.get("taken_vs_tank_share") else None, "n": rep["n"]}


# Simulator versions worth scoring: one per change that moved accuracy (see the simulator README).
MILESTONES = ["0f77831d", "378cfd6b", "0c2d746c", "598ce192", "f1d9139b", "7c1afa8c", "397c228c", "4be94a36",
              "b57dfd39", "5e71f86c", "d220978b", "38e72538", "89fb3ef5", "bfb7b8d1", "be0a5787"]


def history(out, commits):
    hist = json.load(open(out)) if os.path.exists(out) else {"points": []}
    have = {p["commit"] for p in hist["points"]}
    for h in commits:
        if h[:8] in have: continue
        wt = tempfile.mkdtemp(prefix="simhist-")
        try:
            subprocess.run(["git", "-C", R, "worktree", "add", "--detach", wt, h], check=True, capture_output=True)
            b = subprocess.run(["make", "-C", f"{wt}/simulator", "mayhem_sim"], capture_output=True, text=True)
            if b.returncode: print(h, "build failed", b.stderr[-300:], file=sys.stderr); continue
            rows = evaluate(f"{wt}/simulator/mayhem_sim", f"{wt}/simulator/data", "200", f"{wt}/simulator")
            if len(rows) < 100: print(h, "only", len(rows), "champions ran", file=sys.stderr); continue
            rep = report(rows)
            meta = subprocess.run(["git", "-C", R, "log", "-1", "--format=%ad%x09%s", "--date=short", h], capture_output=True, text=True).stdout.strip().split("\t")
            pr = meta[1].rsplit("(#", 1)[1].rstrip(")") if "(#" in meta[1] else None
            hist["points"].append({"commit": h[:8], "date": meta[0], "pr": int(pr) if pr and pr.isdigit() else None,
                                   "title": meta[1].split(" (#")[0], **summary_row(rep)})
            print(h, meta[0], summary_row(rep), file=sys.stderr)
        finally:
            subprocess.run(["git", "-C", R, "worktree", "remove", "--force", wt], capture_output=True)
    hist["points"].sort(key=lambda p: (p["date"], p["commit"]))
    hist["note"] = "Each simulator version scored with the same yardstick: today's most-played real builds and real damage shares."
    json.dump(hist, open(out, "w"), indent=1)


def main():
    mode = sys.argv[1]
    if mode == "history":
        history(sys.argv[2], sys.argv[3:] or MILESTONES); return
    sim, out = os.path.abspath(sys.argv[2]), sys.argv[3]
    trials = sys.argv[4] if len(sys.argv) > 4 else "300"
    rows = evaluate(sim, f"{R}/simulator/data", trials)
    rep = report(rows)
    rep["patch"] = open(f"{R}/simulator/data/tuned_patch.txt").read().strip()
    rep["date"] = datetime.date.today().isoformat()
    rep["trials"] = int(trials); rep["bootstrap"] = BOOT
    hp = os.path.join(os.path.dirname(out), "validation-history.json")
    rep["history"] = json.load(open(hp))["points"] if os.path.exists(hp) else []
    rep["history_current"] = summary_row(rep)
    json.dump(rep, open(out, "w"), indent=1)
    print(json.dumps(summary_row(rep)), file=sys.stderr)


if __name__ == "__main__":
    main()
