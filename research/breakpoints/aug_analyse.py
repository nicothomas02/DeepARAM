"""Summarise augment stat breakpoint flips (aug_sweep.jsonl) and check each against the archive: do real holders of
that augment build the winning item more, or the losing one less (web/src/data/augment-item-shift.json, pooled over
champions, EB-shrunk z of build share)? agrees: z(win) >= 2 or z(lose) <= -2 in the flip's direction; contradicts:
the reverse; else no signal.
    python3 research/breakpoints/aug_analyse.py [research/breakpoints/aug_sweep.jsonl]
"""
import json, sys, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "aug_sweep.jsonl")
shift = json.load(open(os.path.join(ROOT, "web/src/data/augment-item-shift.json")))["pairs"]
AUG = {}
for a in json.load(open(os.path.join(ROOT, "simulator/data/augments.json")))["augments"].values(): AUG[str(a["id"])] = a["name"]
ITEM = {}
for i in json.load(open(os.path.join(ROOT, "simulator/data/items.json")))["items"].values(): ITEM[i["id"]] = i["name"]

def z(aug, item):
    v = (shift.get(str(aug)) or {}).get(str(item))
    return v[4] if v else None

rows = [json.loads(l) for l in open(path)]
flips, verdict = [], collections.Counter()
for r in rows:
    for aid in map(str, r["flips"]):
        w = r["with"][aid]
        win, lose = (r["item"], r["vs"]) if w > 0 else (r["vs"], r["item"])
        zw, zl = z(aid, win), z(aid, lose)
        if (zw is not None and zw >= 2) or (zl is not None and zl <= -2): v = "agrees"
        elif (zw is not None and zw <= -2) or (zl is not None and zl >= 2): v = "contradicts"
        else: v = "no signal"
        verdict[v] += 1
        flips.append((r["champ"], r["slot"], AUG.get(aid, aid), ITEM.get(win, win), ITEM.get(lose, lose), r["none"], w, zw, zl, v))
print(f"{len(rows)} comparisons, {len(flips)} flips; archive: {dict(verdict)}")
by_aug = collections.Counter(f[2] for f in flips)
print("flips by augment:", by_aug.most_common())
for f in sorted(flips, key=lambda f: (f[2], f[0], f[1])):
    print(f"{f[0]:<14} {f[1]}  {f[2]:<20} {f[3]} over {f[4]}: {f[5]:+.1f}% -> {f[6]:+.1f}%  z(win)={f[7]} z(lose)={f[8]}  {f[9]}")
