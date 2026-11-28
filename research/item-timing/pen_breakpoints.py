"""Which legendary slot should a % pen or shred item take? Simulator math (Nico 2026-11-27: back build timing with
math; 2026-11-28: not only 2nd, it could be 1st, 3rd or later depending on the game).

For each champion whose builds include a pen or shred item (data/cn/builds 'other' list, 2,000+ games), take its top
core (data/cn/builds core[0]) and boots. At each decision (choosing the 1st to 4th legendary) compare the simulated
damage per second of
  base + pen item   vs   base + the core's planned item at that slot
on a dummy with the enemy team's typical level, health, armor and MR at that moment (archive medians, all players:
STATE), then sweep the dummy's resist (20 to 250) to find the resist from which the pen item wins at that slot.
Needs the native simulator: make -C simulator mayhem_sim.
    python3 research/item-timing/pen_breakpoints.py [--out research/item-timing/pen_breakpoints.json] [--procs 4]
Resumes from a partial run (pen_breakpoints.partial.jsonl next to the output) unless --fresh.
"""
import json, subprocess, sys, os, glob
from multiprocessing import Pool
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM = os.path.join(ROOT, "simulator", "mayhem_sim")
# Archive medians at each legendary decision (owner archive, all ten players, 12k player rows per slot; 2026-11-28):
# decision for the Nth legendary -> (your level, enemy health, armor, MR)
STATE = {1: (1, 621, 29.6, 36.4), 2: (6, 1321, 53.0, 44.0), 3: (10, 2068, 75.8, 54.0), 4: (13, 2758, 98.4, 64.0), 5: (16, 3331, 118.4, 73.4), 6: (17, 3725, 132.6, 81.8)}
PEN = {3135: "mr", 3137: "mr", 8010: "mr", 3036: "armor", 3033: "armor", 6694: "armor", 3302: "armor", 3071: "armor"}  # % pen, plus resist shred (Bloodletter's, Black Cleaver; Nico 2026-11-28)
lst = json.loads(subprocess.run([SIM, "--list", "--json"], capture_output=True, text=True, cwd=os.path.dirname(SIM)).stdout)
KEY = {i["id"]: i["key"] for i in lst["items"] if i.get("modeled")}
ROLE = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
AP, AD = {"ap"}, {"ad", "crit", "lethality", "ability_ad", "onhit"}
DD = sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/champion.json")), key=lambda p: [int(x) for x in p.split("/dd/")[1].split("/")[0].split(".")])[-1]
names = {int(v["key"]): k for k, v in json.load(open(DD))["data"].items()}


def dps(champ, items, lvl, hp, ar, mr):
    out = subprocess.run([SIM, "--champ", champ, "--items", ",".join(KEY[i] for i in items), "--trials", "300", "--seed", "7", "--json",
                          "--set", f"level={lvl},enemy_level={lvl},fixed_target=1,target_hp={hp},target_armor={ar},target_mr={mr},until_death=0"],
                         capture_output=True, text=True, cwd=os.path.dirname(SIM))
    try: return json.loads(out.stdout)["builds"][0]["summary"]["mean_dps"]
    except Exception: return None


def pairs():
    for f in sorted(os.listdir(os.path.join(ROOT, "data/cn/builds"))):
        b = json.load(open(os.path.join(ROOT, "data/cn/builds", f)))
        it = b.get("items") or {}
        core = (it.get("core") or [{}])[0].get("items") or []
        boots = [r["items"][0] for r in (it.get("boots") or [])[:1]]
        other = {r["items"][0]: r.get("games", 0) for r in it.get("other") or []}
        champ = names.get(int(b["id"])) if "id" in b else None
        # the 4th to 6th decisions: the core has 3 items, so the planned 4th, 5th and 6th are the champion's most built
        # other items of the pen item's damage type (data/cn/builds 'other', by games; Nico 2026-11-28: "What about
        # 5th and 6th?")
        def later(pen, base):
            want = AP if PEN[pen] == "mr" else AD
            out = []
            for r in sorted(it.get("other") or [], key=lambda r: -r.get("games", 0)):
                x = r["items"][0]
                if x not in base and x not in out and x not in PEN and x in KEY and ROLE.get(x, set()) & want and x not in boots:
                    out.append(x)
            return out[:6 - len(base)]
        for pen in PEN:
            if other.get(pen, 0) < 2000 or pen in core or not core or not champ: continue
            core = core[:3] + (later(pen, core[:3]) if len(core) >= 3 else [])
            if any(i not in KEY for i in core + boots + [pen]): continue
            yield champ, pen, core, boots


def job(args):
    champ, pen, core, boots = args[:4]
    old = args[4] if len(args) > 4 else None
    stat = PEN[pen]
    r = {"champ": champ, "pen": pen, "core": core, "slots": dict(old["slots"]) if old else {}, "wins_from": dict(old["wins_from"]) if old else {}}
    for s, (lvl, hp, ar, mr) in STATE.items():
        if s - 1 >= len(core): break
        if old and str(s) in {str(k) for k in old["wins_from"]}: continue
        base = boots + core[: s - 1]
        a, p = dps(champ, base + [core[s - 1]], lvl, hp, ar, mr), dps(champ, base + [pen], lvl, hp, ar, mr)
        if a and p: r["slots"][s] = round(100 * (p / a - 1), 1)
        win = None
        for x in range(20, 260, 10):
            ar2, mr2 = (x, mr) if stat == "armor" else (ar, x)
            a, p = dps(champ, base + [core[s - 1]], lvl, hp, ar2, mr2), dps(champ, base + [pen], lvl, hp, ar2, mr2)
            if a and p and p >= a: win = x; break
        r["wins_from"][s] = win
    r["wins_2nd_from_resist"] = r["wins_from"].get(2)
    return r


if __name__ == "__main__":
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "pen_breakpoints.json")
    procs = int(sys.argv[sys.argv.index("--procs") + 1]) if "--procs" in sys.argv else 4
    part = out.replace(".json", ".partial.jsonl")
    done = {}
    if os.path.exists(part) and "--fresh" not in sys.argv:
        for line in open(part):
            try: r = json.loads(line); done[(r["champ"], r["pen"])] = r
            except ValueError: pass
    # --extend: an earlier run's rows keep their slots and get only the ones they lack
    if "--extend" in sys.argv and os.path.exists(out):
        for r in json.load(open(out))["rows"]:
            done.setdefault((r["champ"], r["pen"]), r)
    todo = [p for p in pairs() if (p[0], p[1]) not in done or ("--extend" in sys.argv and any(str(k) not in {str(x) for x in done[(p[0], p[1])].get("wins_from", {})} for k in range(1, len(p[2]) + 1)))]
    with open(part, "a") as fo, Pool(procs) as pool:
        for r in pool.imap_unordered(job, [p + ((done[(p[0], p[1])],) if (p[0], p[1]) in done else ()) for p in todo]):
            done[(r["champ"], r["pen"])] = r
            fo.write(json.dumps(r) + "\n"); fo.flush()
            print(r["champ"], r["pen"], r["slots"], "wins from", PEN[r["pen"]], r["wins_from"], flush=True)
    rows = sorted(done.values(), key=lambda r: (r["champ"], r["pen"]))
    json.dump({"state": STATE, "rows": rows}, open(out, "w"), indent=1)
    os.remove(part)
