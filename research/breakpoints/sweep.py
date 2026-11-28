"""Item breakpoints beyond resist: where does an item beat the build's planned item, as a function of the game?
Simulator math (Nico 2026-11-28: "extensively find even more breakpoints to evaluate").

For every champion (data/cn/builds: top core + boots) and every damage item its players build often ('other' list,
2,000+ games, not in the core), at the 2nd and 3rd legendary decision, compare simulated damage per second of
    base + item   vs   base + the core's planned item at that slot
on a fixed dummy at the archive's typical state for that decision (STATE), then sweep one thing at a time:
enemy health, armor, MR and fight length. A row keeps the whole curve; analyse.py picks clear breakpoints (loses at
typical, wins inside the range real games reach) and checks them against the archive.
    python3 research/breakpoints/sweep.py [--out research/breakpoints/sweep.jsonl] [--procs 4]
"""
import json, subprocess, sys, os
from multiprocessing import Pool
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM = os.path.join(ROOT, "simulator", "mayhem_sim")
# archive medians at each legendary decision (all ten players, 12k player rows; research/item-timing)
STATE = {2: dict(level=6, hp=1321, armor=53.0, mr=44.0), 3: dict(level=10, hp=2068, armor=75.8, mr=54.0)}
FIGHT = 18  # simulator default average fight length (data/mayhem_rules.json)
SWEEP = {"hp": list(range(600, 6001, 600)), "armor": list(range(20, 261, 30)), "mr": list(range(20, 261, 30)), "fight": [4, 7, 10, 14, 22, 30]}
DMG = {"ap", "ad", "crit", "lethality", "ability_ad", "onhit"}
lst = json.loads(subprocess.run([SIM, "--list", "--json"], capture_output=True, text=True, cwd=os.path.dirname(SIM)).stdout)
KEY = {i["id"]: i["key"] for i in lst["items"] if i.get("modeled")}
ROLE = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
names = {int(v["key"]): k for k, v in json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/champion.json")))["data"].items()}

def dps(champ, items, st, **over):
    s = {**st, **over}
    out = subprocess.run([SIM, "--champ", champ, "--items", ",".join(KEY[i] for i in items), "--trials", "150", "--seed", "7", "--json",
                          "--set", f"level={s['level']},enemy_level={s['level']},fixed_target=1,target_hp={s['hp']},target_armor={s['armor']},"
                                   f"target_mr={s['mr']},until_death=0,fight_mean={s.get('fight', FIGHT)},fight_sd=0,fight_min=1"],
                         capture_output=True, text=True, cwd=os.path.dirname(SIM))
    try: return json.loads(out.stdout)["builds"][0]["summary"]["mean_dps"]
    except Exception: return None

def rel(champ, base, x, y, st, **over):
    a, p = dps(champ, base + [y], st, **over), dps(champ, base + [x], st, **over)
    return round(100 * (p / a - 1), 1) if a and p else None

def job(f):
    b = json.load(open(os.path.join(ROOT, "data/cn/builds", f)))
    it = b.get("items") or {}
    core = (it.get("core") or [{}])[0].get("items") or []
    boots = [r["items"][0] for r in (it.get("boots") or [])[:1]]
    champ = names.get(int(b["id"])) if "id" in b else None
    rows = []
    if not champ or not core or any(i not in KEY for i in core + boots): return rows
    for r in it.get("other") or []:
        x = r["items"][0]
        if r.get("games", 0) < 2000 or x in core or x not in KEY or not (ROLE.get(x, set()) & DMG): continue
        for s, st in STATE.items():
            if s - 1 >= len(core): continue
            y = core[s - 1]
            if not (ROLE.get(y, set()) & DMG): continue
            base = boots + core[: s - 1]
            row = {"champ": champ, "item": x, "slot": s, "vs": y, "typical": rel(champ, base, x, y, st), "curves": {}}
            for var, vals in SWEEP.items():
                row["curves"][var] = [[v, rel(champ, base, x, y, st, **{var: v})] for v in vals]
            rows.append(row)
    return rows

if __name__ == "__main__":
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "sweep.jsonl")
    procs = int(sys.argv[sys.argv.index("--procs") + 1]) if "--procs" in sys.argv else 4
    files = sorted(os.listdir(os.path.join(ROOT, "data/cn/builds")))
    with open(out, "w") as fo, Pool(procs) as pool:
        for n, rows in enumerate(pool.imap_unordered(job, files)):
            for r in rows: fo.write(json.dumps(r) + "\n")
            fo.flush(); print(n, len(files), len(rows), flush=True)
