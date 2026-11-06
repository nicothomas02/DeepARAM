#!/usr/bin/env python3
"""Simulated item builds for a champion with a given augment (or pair of augments) taken.

For the champion page's augment selector. For every champion, the Simulator searches the best five
legendary items (on top of the champion's most-played boots) with:
  - no augments (the reference build),
  - each build-changing augment the champion can be offered (ADAPt, escAPADe, Ethereal Weapon, ...),
  - each of the champion's five most-picked augments,
  - each pair of its three most-picked augments.
The search is greedy: one slot at a time, it adds the item that raises the champion's output the most, where
output is damage dealt over a fight plus healing and shielding. Items come from what players really build on
the champion, plus the items that suit the augment (AP items for ADAPt, on-hit items for Ethereal Weapon, ...).

A build counts as augment-dependent ("changes your build") when two or more of its five items differ from the
no-augment build.

Needs the native simulator: `make -C simulator mayhem_sim`.
Writes data/estimates/augment_builds.json. Run from the repo root:
    python3 data/estimates/augment_builds.py [champion ...]
"""

import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIM = ROOT / "simulator" / "mayhem_sim"
OUT = ROOT / "data" / "estimates" / "augment_builds.json"
TRIALS = "60"
SEED = "7"
SLOTS = 5
POOL = 14  # most-built items per champion
TOP_AUGS = 5
PAIR_FROM = 3

# Augments that change what a champion should build, and the item roles (simulator item data) they favour.
BUILD_CHANGERS = {
    "adapt": ["ap"],
    "escapade": ["ad"],
    "ethereal_weapon": ["onhit"],
    "purist_caster": ["ap", "haste"],
    "armored_impact": ["tank"],
    "protein_shake": ["tank", "enchanter"],
}


def load(path):
    return json.loads((ROOT / path).read_text())


def run(champ, items, augs):
    out = subprocess.run(
        [str(SIM), "--champ", champ, "--items", ",".join(items), "--augs", ",".join(augs),
         "--trials", TRIALS, "--seed", SEED, "--threads", "1", "--json"],
        capture_output=True, text=True, cwd=SIM.parent,
    )
    if out.returncode:
        return None
    s = json.loads(out.stdout)["builds"][0]["summary"]
    return s["mean_dps"] * s["time_alive"] + s.get("healing", 0) + s.get("shielding", 0)


def search(champ, boots, pool, augs):
    build = [boots] if boots else []
    best = run(champ, build, augs) or 0
    for _ in range(SLOTS):
        cand = [(run(champ, build + [i], augs), i) for i in pool if i not in build]
        cand = [c for c in cand if c[0] is not None]
        if not cand:
            break
        score, item = max(cand)
        build.append(item)
        best = score
    return build, best


def champion(job):
    c, boots, pool, extra_by_role, tests = job
    base, base_score = search(c, boots, pool, [])
    out = {"base": {"items": base, "score": round(base_score, 1)}, "builds": []}
    for augs in tests:
        roles = {r for a in augs for r in BUILD_CHANGERS.get(a, [])}
        p = list(dict.fromkeys(pool + [i for r in roles for i in extra_by_role.get(r, [])]))
        items, score = search(c, boots, p, list(augs))
        out["builds"].append({
            "augments": list(augs),
            "items": items,
            "score": round(score, 1),
            "changed": len(set(items) - set(base)),
        })
    return c, out


def main():
    listing = json.loads(subprocess.run([str(SIM), "--list", "--json"], capture_output=True, text=True,
                                        cwd=SIM.parent, check=True).stdout)
    item_key = {i["id"]: i["key"] for i in listing["items"] if i.get("modeled")}
    aug_key = {a["id"]: a["key"] for a in listing["augments"] if a.get("modeled")}
    sim_items = {i["key"]: i for i in listing["items"]}
    legendary = [i for i in listing["items"] if i["slot"] == "legendary" and i.get("modeled")]
    # Items that suit each role, cheapest family first so the pool stays small.
    extra_by_role = {}
    for role in {r for rs in BUILD_CHANGERS.values() for r in rs}:
        extra_by_role[role] = [i["key"] for i in legendary if role in i.get("roles", [])][:14]

    only = set(sys.argv[1:])
    jobs = []
    for ch in listing["champions"]:
        if only and ch["id"] not in only:
            continue
        f = ROOT / "data" / "cn" / "builds" / f"{ch['key']}.json"
        if not f.exists():
            continue
        b = json.loads(f.read_text())
        boots = next((item_key[x["items"][0]] for x in b["items"].get("boots", []) if x["items"][0] in item_key), None)
        pool = []
        for x in sorted(b["items"].get("other", []), key=lambda x: -x["pick_rate"]):
            k = item_key.get(x["items"][0])
            if k and sim_items[k]["slot"] == "legendary" and k not in pool:
                pool.append(k)
            if len(pool) >= POOL:
                break
        allowed = set(ch.get("augments", []))
        top = [aug_key[a["id"]] for a in sorted(b["augments"].get("all", []), key=lambda a: -a["pick_rate"])
               if a["id"] in aug_key and aug_key[a["id"]] in allowed][:TOP_AUGS]
        changers = [a for a in BUILD_CHANGERS if a in allowed]
        tests = [(a,) for a in dict.fromkeys(changers + top)]
        tests += list(combinations(top[:PAIR_FROM], 2))
        jobs.append((ch["id"], boots, pool, extra_by_role, tests))

    result = load("data/estimates/augment_builds.json") if (only and OUT.exists()) else {}
    result.setdefault("champions", {})
    done = 0
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        for c, out in ex.map(champion, jobs):
            result["champions"][c] = out
            done += 1
            print(f"\r{done}/{len(jobs)} {c:<14}", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    result["patch"] = (ROOT / "simulator" / "data" / "tuned_patch.txt").read_text().strip()
    result["about"] = "Simulated best 5 items (plus boots) per champion with each augment or pair taken; see augment_builds.py."
    OUT.write_text(json.dumps(result, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
