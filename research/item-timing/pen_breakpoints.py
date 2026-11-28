"""When does % penetration beat the next damage item? Simulator math (Nico 2026-11-27: back build timing with math).

For each champion whose builds include a % pen item (data/cn/builds 'other' list), take its top core (data/cn/builds
core[0]) and boots. At each decision (choosing the 2nd, 3rd, 4th legendary) compare the simulated damage per second of
  base + pen item   vs   base + the core's planned item at that slot
against a dummy with the enemy team's typical level, health, armor and MR at that moment (archive medians, all players:
see STATE). Also sweep the dummy's resist at the 2nd-item decision to find the resist where the pen item wins.
Needs the native simulator: make -C simulator mayhem_sim.
    python3 research/item-timing/pen_breakpoints.py [--out research/item-timing/pen_breakpoints.json]
"""
import json, subprocess, sys, os, statistics as st
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM = os.path.join(ROOT, "simulator", "mayhem_sim")
# Archive medians at each legendary decision (owner archive, all ten players, 12k player rows; 2026-11-27):
# decision for the Nth legendary -> (your level, enemy health, armor, MR)
STATE = {2: (6, 1321, 53.0, 44.0), 3: (10, 2068, 75.8, 54.0), 4: (13, 2758, 98.4, 64.0)}
PEN = {3135: "mr", 3137: "mr", 8010: "mr", 3036: "armor", 3033: "armor", 6694: "armor", 3302: "armor", 3071: "armor"}  # % pen, plus resist shred (Bloodletter's, Black Cleaver; Nico 2026-11-28)
lst = json.loads(subprocess.run([SIM, "--list", "--json"], capture_output=True, text=True, cwd=os.path.dirname(SIM)).stdout)
KEY = {i["id"]: i["key"] for i in lst["items"] if i.get("modeled")}
CH = {c.get("id") or c.get("key"): c for c in lst["champions"]} if isinstance(lst["champions"], list) else lst["champions"]
names = {int(v["key"]): k for k, v in json.load(open(sorted(__import__("glob").glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/champion.json")), key=lambda p: [int(x) for x in p.split("/dd/")[1].split("/")[0].split(".")])[-1]))["data"].items()}

def dps(champ, items, lvl, hp, ar, mr):
    out = subprocess.run([SIM, "--champ", champ, "--items", ",".join(KEY[i] for i in items), "--trials", "300", "--seed", "7", "--json",
                          "--set", f"level={lvl},enemy_level={lvl},fixed_target=1,target_hp={hp},target_armor={ar},target_mr={mr},until_death=0"],
                         capture_output=True, text=True, cwd=os.path.dirname(SIM))
    try: return json.loads(out.stdout)["builds"][0]["summary"]["mean_dps"]
    except Exception: return None

rows = []
for f in sorted(os.listdir(os.path.join(ROOT, "data/cn/builds"))):
    b = json.load(open(os.path.join(ROOT, "data/cn/builds", f)))
    it = b.get("items") or {}
    core = (it.get("core") or [{}])[0].get("items") or []
    boots = [r["items"][0] for r in (it.get("boots") or [])[:1]]
    other = {r["items"][0]: r.get("games", 0) for r in it.get("other") or []}
    champ = names.get(int(b["id"])) if "id" in b else None
    for pen, stat in PEN.items():
        if other.get(pen, 0) < 2000 or pen in core or not core or not champ: continue
        if any(i not in KEY for i in core + boots + [pen]): continue
        r = {"champ": champ, "pen": pen, "core": core, "slots": {}}
        for s, (lvl, hp, ar, mr) in STATE.items():
            if s - 1 >= len(core): break
            base = boots + core[: s - 1]
            a, p = dps(champ, base + [core[s - 1]], lvl, hp, ar, mr), dps(champ, base + [pen], lvl, hp, ar, mr)
            if a and p: r["slots"][s] = round(100 * (p / a - 1), 1)
        # resist sweep at the 2nd-item decision
        lvl, hp, ar, mr = STATE[2]; base = boots + core[:1]; win = None
        for x in range(20, 260, 10):
            ar2, mr2 = (x, mr) if stat == "armor" else (ar, x)
            a, p = dps(champ, base + [core[1]], lvl, hp, ar2, mr2), dps(champ, base + [pen], lvl, hp, ar2, mr2)
            if a and p and p >= a: win = x; break
        r["wins_2nd_from_resist"] = win
        rows.append(r); print(champ, pen, r["slots"], "2nd wins from", stat, win, flush=True)
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(__file__), "pen_breakpoints.json")
json.dump({"state": STATE, "rows": rows}, open(out, "w"), indent=1)
