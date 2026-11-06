# Tuning-sensitivity curves: how far the simulated fight moves when one number is nudged.
#
# For every champion (with its most-played real build, as in tools/accuracy.py) each lever below is scaled by
# -10%, -5%, 0, +5% and +10% and the same fights are replayed. "Same fights" matters: every run uses the same
# seeds (common random numbers), so the noise in each fight is shared across the steps and the difference
# between steps is mostly the change itself, not luck. The same is done for every legendary item's stat line,
# on the champions that build it.
#
# For each curve the script fits log(metric) = a + e * log(1 + change) per seed and reports the elasticity e
# (a 1% change moves the metric by e%), its spread across seeds, how bent the curve is (a quadratic term) and
# whether it is monotone. An elasticity of 1.0 for ability damage means damage per second moves one-for-one
# with the tooltip numbers; 0.6 means part of the gain is lost (overkill, fights ending sooner, time spent
# walking). Survival levers (health, resists, damage taken) show up in time alive and damage per fight.
#
#   python3 tools/sensitivity.py ./mayhem_sim analysis/tuning-sensitivity.json [trials] [seeds]
#   SENS_CHAMPS=Ahri,Garen limits the champions; SENS_ITEMS=0 skips items.
import json, math, os, shutil, statistics as st, subprocess, sys, tempfile, concurrent.futures as cf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from real_builds import R, load as load_ids, real_build

SIM, OUT = os.path.abspath(sys.argv[1]), sys.argv[2]
TRIALS = sys.argv[3] if len(sys.argv) > 3 else "300"
SEEDS = [11, 23, 37, 41, 53][: int(sys.argv[4]) if len(sys.argv) > 4 else 3]
STEPS = [-0.10, -0.05, 0.0, 0.05, 0.10]
GAME = f"{R}/simulator/data"
CHAMPS_RAW = open(f"{GAME}/champions.json").read()
ITEMS_RAW = open(f"{GAME}/items.json").read()
champs = json.loads(CHAMPS_RAW)["champions"]
items = json.loads(ITEMS_RAW)["items"]
by_id, aug_by_id = load_ids()
best = {c["champion"]: c for c in json.load(open(f"{R}/simulator/viewer/replay-data/best-builds.json"))["champions"]}
patch = open(f"{GAME}/tuned_patch.txt").read().strip()


def scale_keys(d, keys, f):
    for k in keys:
        if isinstance(d.get(k), (int, float)): d[k] = d[k] * f


def lever_ability(c, f):
    for a in c.get("abilities", []):
        for h in a.get("hits", []):
            for k, v in list(h.get("scaling", {}).items()):
                if isinstance(v, (int, float)): h["scaling"][k] = v * f


# Champion levers: what a balance patch actually changes. The Mayhem modifiers are the mode's own tuning knobs.
LEVERS = {
    "damage_dealt": ("Damage dealt modifier", lambda c, f: scale_keys(c["mayhem"], ["damage_dealt"], f)),
    "damage_taken": ("Damage taken modifier", lambda c, f: scale_keys(c["mayhem"], ["damage_taken"], f)),
    "ability_damage": ("Ability damage", lever_ability),
    "base_ad": ("Base attack damage", lambda c, f: scale_keys(c["stats"], ["ad", "ad_per_level"], f)),
    "attack_speed": ("Base attack speed", lambda c, f: scale_keys(c["stats"], ["attack_speed", "attack_speed_per_level"], f)),
    "base_hp": ("Base health", lambda c, f: scale_keys(c["stats"], ["hp", "hp_per_level"], f)),
    "base_resists": ("Base armor and magic resist", lambda c, f: scale_keys(c["stats"], ["armor", "armor_per_level", "mr", "mr_per_level"], f)),
}
METRICS = ["dps", "alive", "per_fight", "taken"]


def simulate(champ, build, seed, champs_json=None, items_json=None):
    """One run; game data is written to a private folder when a lever changes it."""
    tmp = None
    gd = GAME
    if champs_json or items_json:
        tmp = tempfile.mkdtemp(prefix="sens-")
        gd = tmp
        for f in ("augments.json", "augment_pools.json"):
            os.symlink(f"{GAME}/{f}", f"{tmp}/{f}")
        open(f"{tmp}/champions.json", "w").write(champs_json or CHAMPS_RAW)
        open(f"{tmp}/items.json", "w").write(items_json or ITEMS_RAW)
    it, au = build
    args = [SIM, "--champ", champ, "--items", ",".join(it), "--json", "--trials", TRIALS, "--threads", "1",
            "--seed", str(seed), "--game-data", gd]
    if au: args += ["--augs", ",".join(au)]
    try:
        r = subprocess.run(args, capture_output=True, text=True, cwd=f"{R}/simulator")
        s = json.loads(r.stdout)["builds"][0]["summary"]
    except Exception:
        return None
    finally:
        if tmp: shutil.rmtree(tmp, ignore_errors=True)
    return {"dps": s["mean_dps"], "alive": s["time_alive"], "per_fight": s["mean_dps"] * s["time_alive"],
            "taken": s.get("damage_taken") or 0}


def champ_variant(cid, lever, f):
    data = json.loads(CHAMPS_RAW)
    for c in data["champions"]:
        if c["id"] == cid: LEVERS[lever][1](c, f)
    return json.dumps(data)


def item_variant(key, f):
    data = json.loads(ITEMS_RAW)
    scale_keys(data["items"][key]["stats"], list(data["items"][key]["stats"]), f)
    return json.dumps(data)


def fit(points):
    """points: [(step, value)] for one seed. Returns slope of log value on log(1+step) and the quadratic term."""
    pts = [(math.log(1 + s), math.log(v)) for s, v in points if v and v > 0]
    if len(pts) < 3: return None, None
    n = len(pts); mx = sum(x for x, _ in pts) / n; my = sum(y for _, y in pts) / n
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    slope = sum((x - mx) * (y - my) for x, y in pts) / sxx
    # Quadratic term from the second difference at the ends: (v(+10) - 2 v(0) + v(-10)) / v(0).
    d = {s: v for s, v in points}
    curv = (d[0.10] - 2 * d[0.0] + d[-0.10]) / d[0.0] if d.get(0.0) and 0.10 in d and -0.10 in d else None
    return slope, curv


def summarise(runs):
    """runs: {seed: {step: metrics}} -> per-metric curve, elasticity and spread."""
    out = {}
    for m in METRICS:
        slopes, curvs = [], []
        for seed, by_step in runs.items():
            pts = [(s, by_step[s][m]) for s in STEPS if s in by_step and by_step[s]]
            e, c = fit(pts)
            if e is not None: slopes.append(e)
            if c is not None: curvs.append(c)
        if not slopes: continue
        # The curve: the mean over seeds of the metric relative to the unchanged run, in percent.
        curve = []
        for s in STEPS:
            rel = [by_step[s][m] / by_step[0.0][m] - 1 for by_step in runs.values()
                   if by_step.get(s) and by_step.get(0.0) and by_step[0.0][m]]
            curve.append(round(100 * st.mean(rel), 2) if rel else None)
        mono = all(a is not None and b is not None and a <= b for a, b in zip(curve, curve[1:])) or \
            all(a is not None and b is not None and a >= b for a, b in zip(curve, curve[1:]))
        e = st.mean(slopes); se = st.stdev(slopes) / math.sqrt(len(slopes)) if len(slopes) > 1 else None
        out[m] = {"e": round(e, 3), "se": round(se, 3) if se is not None else None,
                  "curve": curve, "curvature": round(st.mean(curvs), 4) if curvs else None, "monotone": mono}
    return out


def main():
    only = set(filter(None, os.environ.get("SENS_CHAMPS", "").split(",")))
    builds = {}
    for c in champs:
        if only and c["id"] not in only: continue
        b = real_build(c, by_id, aug_by_id)
        src = "real"
        if not b and c["id"] in best:
            bb = best[c["id"]]["build"]; b = (bb["items"], bb["augments"]); src = "simulated"
        if b: builds[c["id"]] = (b, src, c)
    jobs = []
    for cid in builds:
        for seed in SEEDS:
            jobs.append(("base", cid, None, 0.0, seed))
            for lever in LEVERS:
                for s in STEPS:
                    if s: jobs.append(("champ", cid, lever, s, seed))
    item_users = {}
    if os.environ.get("SENS_ITEMS", "1") != "0":
        for cid, (b, _, c) in builds.items():
            for it in b[0]:
                if items.get(it, {}).get("slot") == "legendary" and items[it].get("stats"):
                    item_users.setdefault(it, []).append((c.get("cn", {}).get("weight") or 0, cid))
        for it in item_users:
            # The twelve most-played champions that build it keep the run count down.
            item_users[it] = [cid for _, cid in sorted(item_users[it], reverse=True)[:12]]
            for cid in item_users[it]:
                for seed in SEEDS:
                    for s in STEPS:
                        if s: jobs.append(("item", cid, it, s, seed))
    print(f"{len(builds)} champions, {len(item_users)} items, {len(jobs)} runs", file=sys.stderr)

    def work(j):
        kind, cid, key, s, seed = j
        b = builds[cid][0]
        if kind == "base": return j, simulate(cid, b, seed)
        if kind == "champ": return j, simulate(cid, b, seed, champs_json=champ_variant(cid, key, 1 + s))
        return j, simulate(cid, b, seed, items_json=item_variant(key, 1 + s))

    res = {}
    done = 0
    with cf.ThreadPoolExecutor(int(os.environ.get("SENS_THREADS", os.cpu_count() or 4))) as ex:
        for j, r in ex.map(work, jobs):
            res[j] = r; done += 1
            if done % 500 == 0: print(f"  {done}/{len(jobs)}", file=sys.stderr)

    def runs_for(cid, kind, key):
        out = {}
        for seed in SEEDS:
            by = {0.0: res.get(("base", cid, None, 0.0, seed))}
            for s in STEPS:
                if s: by[s] = res.get((kind, cid, key, s, seed))
            if by[0.0]: out[seed] = by
        return out

    champ_out = []
    for cid, (b, src, c) in builds.items():
        base = [res.get(("base", cid, None, 0.0, sd)) for sd in SEEDS]
        base = [x for x in base if x]
        if not base: continue
        champ_out.append({
            "champion": cid, "name": c.get("name", cid), "role": c.get("role"), "build_source": src,
            "items": b[0], "augments": b[1],
            "base": {m: round(st.mean(x[m] for x in base), 1) for m in METRICS},
            "levers": {lv: summarise(runs_for(cid, "champ", lv)) for lv in LEVERS},
        })
    item_out = []
    for it, users in item_users.items():
        per = []
        for cid in users:
            sm = summarise(runs_for(cid, "item", it))
            if "dps" in sm: per.append({"champion": cid, **{m: sm[m]["e"] for m in sm}, "curve": sm["dps"]["curve"]})
        if not per: continue
        item_out.append({"item": it, "name": items[it]["name"], "id": items[it]["id"], "stats": list(items[it]["stats"]),
                         "champions": per,
                         "median": {m: round(st.median(p[m] for p in per if m in p), 3) for m in METRICS if any(m in p for p in per)}})

    # Role summaries: the median elasticity per lever and metric, with the spread between champions.
    roles = {}
    for role in sorted({c["role"] for c in champ_out if c["role"]}):
        rr = [c for c in champ_out if c["role"] == role]
        roles[role] = {"n": len(rr), "levers": {}}
        for lv in LEVERS:
            roles[role]["levers"][lv] = {}
            for m in METRICS:
                es = sorted(c["levers"][lv][m]["e"] for c in rr if m in c["levers"][lv])
                if es:
                    q = lambda p: es[min(len(es) - 1, int(p * (len(es) - 1) + 0.5))]
                    roles[role]["levers"][lv][m] = {"median": round(st.median(es), 3), "p25": round(q(0.25), 3), "p75": round(q(0.75), 3)}

    # Exchange rates: how many percent of each lever buy the same damage per fight as +1% damage dealt.
    for c in champ_out:
        ref = c["levers"]["damage_dealt"].get("per_fight", {}).get("e")
        c["exchange"] = {lv: (round(ref / c["levers"][lv]["per_fight"]["e"], 2)
                              if ref and c["levers"][lv].get("per_fight", {}).get("e") and abs(c["levers"][lv]["per_fight"]["e"]) > 0.05 else None)
                         for lv in LEVERS}
    json.dump({"patch": patch, "steps": [round(100 * s) for s in STEPS], "seeds": len(SEEDS), "trials": int(TRIALS),
               "levers": {k: v[0] for k, v in LEVERS.items()},
               "metrics": {"dps": "Damage per second", "alive": "Time alive (s)", "per_fight": "Damage per fight", "taken": "Damage taken"},
               "roles": roles, "champions": sorted(champ_out, key=lambda c: c["champion"]),
               "items": sorted(item_out, key=lambda i: -i["median"].get("dps", 0))},
              open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}: {len(champ_out)} champions, {len(item_out)} items", file=sys.stderr)


if __name__ == "__main__":
    main()
