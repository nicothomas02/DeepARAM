"""web/src/data/pen-breakpoints.json from pen_breakpoints.json: clear breakpoints only (Nico 2026-11-28).

Kept when the core's planned 2nd item is the same damage type as the pen or shred item, the item loses to it at the
typical resist (44 MR / 53 armor at the 2nd-item decision) and wins at some resist above it. Read by the engine
(penSecond). Run after pen_breakpoints.py; the breakpoints workflow does both on each new patch.
    python3 research/item-timing/make_pen_data.py
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STAT = {3135: "mr", 3137: "mr", 8010: "mr", 3036: "armor", 3033: "armor", 6694: "armor", 3302: "armor", 3071: "armor"}
TYPICAL = {"mr": 44, "armor": 53}
AP, AD = {"ap"}, {"ad", "crit", "lethality", "ability_ad", "onhit"}

lst = json.loads(subprocess.run([os.path.join(ROOT, "simulator", "mayhem_sim"), "--list", "--json"], capture_output=True, text=True, cwd=os.path.join(ROOT, "simulator")).stdout)
role = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
rows = json.load(open(os.path.join(HERE, "pen_breakpoints.json")))["rows"]
out = {}
for r in rows:
    st = STAT.get(r["pen"])
    second = r["core"][1] if len(r["core"]) > 1 else None
    s2, w = r["slots"].get("2"), r.get("wins_2nd_from_resist")
    if not st or second is None or not (role.get(second, set()) & (AP if st == "mr" else AD)):
        continue
    if s2 is None or s2 >= 0 or w is None or w <= TYPICAL[st]:
        continue
    out.setdefault(r["champ"].lower(), {})[str(r["pen"])] = w
path = os.path.join(ROOT, "web", "src", "data", "pen-breakpoints.json")
d = json.load(open(path))
d["champions"] = {k: out[k] for k in sorted(out)}
json.dump(d, open(path, "w"), indent=0)
print(len(out), "champions with a clear breakpoint")
