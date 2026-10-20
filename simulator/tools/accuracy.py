# Accuracy check: runs every champion with its most-played real build (CN full builds plus the
# top augments the simulator models) and compares simulated DPS with the champion's real CN damage
# share. Prints the rank correlation, role averages and the champions that drift most (simulated
# DPS rank far from their real damage-share rank), which are the ones to look at after a patch.
#
# Spearman is a rank correlation: 1 means the simulated order of champions matches the real one
# exactly, 0 no relation. Most of the overall score comes from roles (tanks and supports deal less
# than carries), so it also prints the score within each role, and a role-adjusted fit: real share
# from simulated DPS and role, scored leave-one-out so the fit can't flatter itself. The champions
# furthest from that fit are the likeliest kit bugs.
#
# Fights are one enemy at a time by default, as on the site. XARGS="--set team_size=5" fights the
# whole team, so area damage counts (on the live patch this lowers the score: 0.50 to 0.37).
#
#   python3 tools/accuracy.py ./mayhem_sim out.json [trials]
# SIMDIR picks the folder the simulator runs in; XARGS adds simulator options.
import json, subprocess, sys, os, concurrent.futures as cf, statistics as st
SIM, OUT = os.path.abspath(sys.argv[1]), sys.argv[2]; TR = sys.argv[3] if len(sys.argv) > 3 else "300"
R = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
items = json.load(open(f"{R}/simulator/data/items.json"))["items"]
by_id = {v["id"]: k for k, v in items.items()}
augs = json.load(open(f"{R}/simulator/data/augments.json"))["augments"]
aug_by_id = {v["id"]: k for k, v in augs.items()}
champs = json.load(open(f"{R}/simulator/data/champions.json"))["champions"]
real = {c["champion_id"]: c for c in json.load(open(f"{R}/data/cn/champions.json"))["champions"]}
best = {c["champion"]: c for c in json.load(open(f"{R}/simulator/viewer/replay-data/best-builds.json"))["champions"]}
def real_build(c):
    f = f"{R}/data/cn/builds/{c["champion_id"]}.json"
    if not os.path.exists(f): return None
    b = json.load(open(f))
    picks = []
    for fb in b["items"].get("full_builds", []):
        ks = [by_id[i] for i in fb["items"] if i in by_id]
        if len(ks) >= 4: picks = ks; break
    if not picks:
        for grp in ("boots", "core", "other"):
            for e in b["items"].get(grp, []):
                for i in e["items"]:
                    if i in by_id and by_id[i] not in picks: picks.append(by_id[i])
    picks = picks[:6]
    a = [aug_by_id[x["id"]] for x in sorted(b["augments"]["all"], key=lambda x: -x["pick_rate"]) if x["id"] in aug_by_id][:4]
    return picks, a
def run(c):
    rb = real_build(c)
    if not rb or not rb[0]: return None
    it, a = rb
    args = [SIM, "--champ", c["id"], "--items", ",".join(it), "--json", "--trials", TR, "--threads", "1"] + os.environ.get("XARGS", "").split()
    if a: args += ["--augs", ",".join(a)]
    r = subprocess.run(args, capture_output=True, text=True, cwd=os.environ.get("SIMDIR", f"{R}/simulator"))
    try: s = json.loads(r.stdout)["builds"][0]["summary"]
    except Exception: print(c["id"], r.stderr[:200], file=sys.stderr); return None
    bb = best.get(c["id"], {})
    return dict(champ=c["id"], role=bb.get("role"), cn=bb.get("cn_damage_share"), dps=s["mean_dps"], st=s["single_target_dps"],
                surv=s["survival_rate"], alive=s["time_alive"], taken=s.get("damage_taken"), healing=s.get("healing"),
                cc=s.get("cc_seconds"), tank=real.get(c["champion_id"], {}).get("avg_tank_ratio"), items=it, augs=a)
with cf.ThreadPoolExecutor(8) as ex: res = [r for r in ex.map(run, champs) if r]
json.dump(res, open(OUT, "w"))
def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
    for k, i in enumerate(o): r[i] = k
    return r
def sp(a, b):
    a, b = rank(a), rank(b); n = len(a); return 1 - 6 * sum((p - q) ** 2 for p, q in zip(a, b)) / (n * (n * n - 1))
x = [r for r in res if r["cn"]]
print("n", len(x), "spearman dps", round(sp([r["dps"] for r in x], [r["cn"] for r in x]), 3),
      "single-target", round(sp([r["st"] for r in x], [r["cn"] for r in x]), 3))
# Damage taken against the real share of the team's damage taken (tankiness), both per champion.
t = [r for r in res if r.get("tank") and r.get("taken") is not None]
if t: print("n", len(t), "spearman damage taken vs real tank share", round(sp([r["taken"] for r in t], [r["tank"] for r in t]), 3))
for role in sorted(set(r["role"] for r in x)):
    rr = [r for r in x if r["role"] == role]
    print(role, len(rr), "dps", round(st.mean(r["dps"] for r in rr)), "cn", round(st.mean(r["cn"] for r in rr), 3))
# The champions whose simulated DPS rank is furthest from their real damage-share rank.
ra, rb = rank([r["dps"] for r in x]), rank([r["cn"] for r in x])
drift = sorted(((ra[i] - rb[i], x[i]["champ"]) for i in range(len(x))), key=lambda d: -abs(d[0]))
print("drift (sim rank minus real rank; + overrated, - underrated):")
for d, c in drift[:15]: print(f"  {c:14s} {d:+d}")
for role in sorted(set(r["role"] for r in x)):
    rr = [r for r in x if r["role"] == role]
    if len(rr) > 5: print(f"within {role}: spearman {sp([r['dps'] for r in rr], [r['cn'] for r in rr]):.2f} (n {len(rr)})")
# Role-adjusted fit: log(real share) = a + b log(DPS) + one term per role, least squares.
import math
roles = sorted(set(r["role"] for r in x))
def feats(r): return [1.0, math.log(max(r["dps"], 1.0))] + [1.0 if r["role"] == ro else 0.0 for ro in roles[1:]]
def fit(rows):
    k = len(feats(rows[0])); A = [[0.0] * k for _ in range(k)]; v = [0.0] * k
    for r in rows:
        f, t = feats(r), math.log(r["cn"])
        for i in range(k):
            v[i] += f[i] * t
            for j in range(k): A[i][j] += f[i] * f[j]
    for i in range(k): A[i][i] += 1e-6
    for i in range(k):  # Gaussian elimination
        p = max(range(i, k), key=lambda q: abs(A[q][i])); A[i], A[p] = A[p], A[i]; v[i], v[p] = v[p], v[i]
        for q in range(k):
            if q != i and A[i][i]:
                m = A[q][i] / A[i][i]; v[q] -= m * v[i]
                for j in range(k): A[q][j] -= m * A[i][j]
    return [v[i] / A[i][i] for i in range(k)]
pred = [sum(a * b for a, b in zip(fit(x[:i] + x[i + 1:]), feats(r))) for i, r in enumerate(x)]
print("role-adjusted fit, leave-one-out: spearman", round(sp(pred, [r["cn"] for r in x]), 3))
res = sorted(((math.log(r["cn"]) - p, r["champ"], r["role"]) for p, r in zip(pred, x)), key=lambda d: -abs(d[0]))
print("furthest from the fit (+ the sim underrates them, - overrates; log real share minus predicted):")
for d, c, ro in res[:20]: print(f"  {c:14s} {ro:9s} {d:+.2f}")
