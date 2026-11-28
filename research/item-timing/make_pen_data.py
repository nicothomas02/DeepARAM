"""web/src/data/pen-breakpoints.json from pen_breakpoints.json: clear breakpoints only (Nico 2026-11-28).

Kept when the core's planned 2nd item is the same damage type as the pen or shred item, the item loses to it at the
typical resist of that slot and wins at some resist above it, per slot 1st to 6th. Read by the engine
(penSecond). Run after pen_breakpoints.py; the breakpoints workflow does both on each new patch.
    python3 research/item-timing/make_pen_data.py
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STAT = {3135: "mr", 3137: "mr", 8010: "mr", 3036: "armor", 3033: "armor", 6694: "armor", 3302: "armor", 3071: "armor"}
AP, AD = {"ap"}, {"ad", "crit", "lethality", "ability_ad", "onhit"}

lst = json.loads(subprocess.run([os.path.join(ROOT, "simulator", "mayhem_sim"), "--list", "--json"], capture_output=True, text=True, cwd=os.path.join(ROOT, "simulator")).stdout)
role = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
src = json.load(open(os.path.join(HERE, "pen_breakpoints.json")))
state = {int(k): v for k, v in src["state"].items()}
SLOTS = sorted(state)
typical = {"armor": [state[s][2] for s in SLOTS], "mr": [state[s][3] for s in SLOTS]}
out, clear = {}, 0
for r in src["rows"]:
    st = STAT.get(r["pen"])
    if not st:
        continue
    row = []
    for s in SLOTS:
        planned = r["core"][s - 1] if len(r["core"]) >= s else None
        w = (r.get("wins_from") or {}).get(str(s))
        # only vs a planned item of the same damage type (else it's a different build, not a timing call)
        same = planned is not None and bool(role.get(planned, set()) & (AP if st == "mr" else AD))
        row.append(w if same and w is not None else None)
        clear += same and w is not None and w > typical[st][s - 1]
    if any(x is not None for x in row):
        out.setdefault(r["champ"].lower(), {})[str(r["pen"])] = row
path = os.path.join(ROOT, "web", "src", "data", "pen-breakpoints.json")
json.dump({"_about": "Per champion and pen or shred item (MR: Void Staff 3135, Cryptbloom 3137, Bloodletter's 8010; armor: Lord "
                     "Dominik's 3036, Mortal Reminder 3033, Serylda's 6694, Terminus 3302, Black Cleaver 3071): for the 1st to 6th "
                     "legendary, the enemy resist from which it beats the core's planned item of the same damage type there (null: "
                     "never to 250, or a different type). Simulator (research/item-timing/pen_breakpoints.py, fixed dummy at the "
                     "archive's median state per decision; typical = that state's resist). The engine uses a slot only when it is "
                     "a clear breakpoint (above typical). Estimated.",
           "typical": typical, "champions": {k: out[k] for k in sorted(out)}}, open(path, "w"), indent=0)
print(len(out), "champions,", clear, "clear slot breakpoints")
