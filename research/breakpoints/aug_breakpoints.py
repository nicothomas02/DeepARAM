"""Augment stat breakpoints: does holding a stat augment change which item should come next?
Simulator math (Nico 2026-11-28: "keep going with ideas"; idea (a) augment stat breakpoints: crit overcap, haste,
attack speed, AP, pen). Augments are read automatically in game, so a flip here needs no input from the player.

For every champion (data/cn/builds: top core + boots, later slots from its players' most built items of the same damage
type) and every stat augment in its Mayhem pool (simulator/data/augment_pools.json), at each legendary decision 2..6
(archive state per decision, as research/item-timing/pen_breakpoints.py), compare simulated damage per second of
    base + x   vs   base + the planned item y
for every damage item x its players build often (2,000+ games, not already in the path), without and with the augment.
A flip: x loses clearly without the augment and wins clearly with it, or the other way round (MARGIN %).
    python3 research/breakpoints/aug_breakpoints.py [--out research/breakpoints/aug_sweep.jsonl] [--procs 4] [--fresh]
Resumes from the output (champions already there are skipped) unless --fresh. Estimated; the archive check
(aug_analyse.py) compares each flip with how real holders of that augment shift their builds (augment-item-shift.json).
"""
import json, subprocess, sys, os, glob
from multiprocessing import Pool
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM = os.path.join(ROOT, "simulator", "mayhem_sim")
STATE = {2: (6, 1321, 53.0, 44.0), 3: (10, 2068, 75.8, 54.0), 4: (13, 2758, 98.4, 64.0), 5: (16, 3331, 118.4, 73.4), 6: (17, 3725, 132.6, 81.8)}
# augments whose simulator effect is a flat stat (simulator/data/augments.json "stats"); conversions and procs excluded
STAT_AUGS = {1022, 1047, 1048, 1004, 3018, 3048, 1118, 1328, 2010, 3063, 3132, 1388, 3123, 3094, 3134, 1390, 1068, 1373,
             1077, 1080, 1084, 2083, 1415, 1092, 1156, 2009}
MARGIN = 2.0
DMG = {"ap", "ad", "crit", "lethality", "ability_ad", "onhit"}
AP, AD = {"ap"}, {"ad", "crit", "lethality", "ability_ad", "onhit"}
lst = json.loads(subprocess.run([SIM, "--list", "--json"], capture_output=True, text=True, cwd=os.path.dirname(SIM)).stdout)
KEY = {i["id"]: i["key"] for i in lst["items"] if i.get("modeled")}
ROLE = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
AKEY = {a["id"]: a["key"] for a in lst["augments"] if a.get("modeled") and a["id"] in STAT_AUGS}
POOL = json.load(open(os.path.join(ROOT, "simulator/data/augment_pools.json")))["pools"]
DD = sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/champion.json")), key=lambda p: [int(x) for x in p.split("/dd/")[1].split("/")[0].split(".")])[-1]
names = {int(v["key"]): k for k, v in json.load(open(DD))["data"].items()}


def dps(champ, items, st, aug=None):
    lvl, hp, ar, mr = st
    cmd = [SIM, "--champ", champ, "--items", ",".join(KEY[i] for i in items), "--trials", "200", "--seed", "7", "--json",
           "--set", f"level={lvl},enemy_level={lvl},fixed_target=1,target_hp={hp},target_armor={ar},target_mr={mr},until_death=0"]
    if aug: cmd[5:5] = ["--augs", aug]
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=os.path.dirname(SIM))
    try: return json.loads(out.stdout)["builds"][0]["summary"]["mean_dps"]
    except Exception: return None


def rel(champ, base, x, y, st, aug=None):
    a, p = dps(champ, base + [y], st, aug), dps(champ, base + [x], st, aug)
    return round(100 * (p / a - 1), 1) if a and p else None


def job(f):
    b = json.load(open(os.path.join(ROOT, "data/cn/builds", f)))
    it = b.get("items") or {}
    core = ((it.get("core") or [{}])[0].get("items") or [])[:3]
    boots = [r["items"][0] for r in (it.get("boots") or [])[:1]]
    champ = names.get(int(b["id"])) if "id" in b else None
    if not champ or not core or any(i not in KEY for i in core + boots): return []
    pool = set(POOL.get(str(b["id"])) or [])
    augs = [(i, k) for i, k in AKEY.items() if k in pool]
    if not augs: return []
    want = AP if any(ROLE.get(i, set()) & AP for i in core) else AD
    others = [r["items"][0] for r in sorted(it.get("other") or [], key=lambda r: -r.get("games", 0))]
    path = core + [x for x in others if x not in core and x in KEY and ROLE.get(x, set()) & want and x not in boots][:3]
    alts = [r["items"][0] for r in it.get("other") or [] if r.get("games", 0) >= 2000]
    alts = [x for x in alts if x not in path and x in KEY and ROLE.get(x, set()) & DMG and x not in boots]
    rows = []
    for s, st in STATE.items():
        if s - 1 >= len(path): break
        y, base = path[s - 1], boots + path[: s - 1]
        for x in alts:
            r0 = rel(champ, base, x, y, st)
            if r0 is None: continue
            row = {"champ": champ, "slot": s, "item": x, "vs": y, "none": r0, "with": {}}
            for aid, ak in augs:
                row["with"][aid] = rel(champ, base, x, y, st, ak)
            row["flips"] = [aid for aid, v in row["with"].items() if v is not None and
                            ((r0 <= -MARGIN and v >= MARGIN) or (r0 >= MARGIN and v <= -MARGIN))]
            rows.append(row)
    return rows


if __name__ == "__main__":
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "aug_sweep.jsonl")
    procs = int(sys.argv[sys.argv.index("--procs") + 1]) if "--procs" in sys.argv else 4
    files = sorted(os.listdir(os.path.join(ROOT, "data/cn/builds")))
    done = set()
    if os.path.exists(out) and "--fresh" not in sys.argv:
        for line in open(out):
            try: done.add(json.loads(line)["champ"])
            except ValueError: pass
    def todo(f):
        try: b = json.load(open(os.path.join(ROOT, "data/cn/builds", f)))
        except ValueError: return False
        return "id" in b and names.get(int(b["id"])) not in done
    files = [f for f in files if todo(f)]
    with open(out, "a" if done else "w") as fo, Pool(procs) as pool:
        for n, rows in enumerate(pool.imap_unordered(job, files)):
            for r in rows: fo.write(json.dumps(r) + "\n")
            fo.flush(); print(n, len(files), len(rows), flush=True)
