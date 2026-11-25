#!/usr/bin/env python3
"""Re-test of the Duos tab's "why it works" lines (web/src/lib/duos.ts duoWhy) on each saved patch: duo_why_check.json.

Each line comes from a rule on the two kits' tags (champions/tags.json), not from results. Nico approved 2026-11-25:
re-test the lines on the newest patch and drop the ones whose boost faded.

Per rule and patch: the mean teammate synergy (data/cn/history/partners/<patch>.json: pair win rate minus what the
two champions' own rates predict) of the pairs the rule labels, against the pairs no rule labels. A rule holds on a
patch when its pairs beat the unlabelled ones; it has faded when, on the newest patch, they don't (z <= 0) with at
least MIN_PAIRS pairs. Pairs whose own boost is no longer above zero lose their line on the page (duos.ts), so
this file is for the rules.

Usage: python3 data/cn/duo_why_check.py   (standard library only)
"""

import glob
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "duo_why_check.json")
MIN_PAIRS = 20

RULES = [
    "Knock-ups set up Yasuo's ultimate.",
    "Heals and shields keep the carry fighting.",
    "Hooks and traps catch targets for burst.",
    "Engage locks enemies down for burst damage.",
    "A frontline peels for the carry.",
    "Crowd control groups enemies for area damage.",
]


def why(tags, x, y):
    """Same rules, same order as duos.ts duoWhy; returns the rule's index or None."""
    def t(c):
        d = tags.get(c, {})
        return set(d.get("classes", []) + d.get("subclasses", []) + d.get("playstyles", []))

    def airborne(c):
        return any(k in ("knockup", "knockback") for k in (tags.get(c, {}).get("cc") or {}).values())

    def hard(c):
        return bool(tags.get(c, {}).get("hardCC"))

    A, B = t(x), t(y)

    def either(f):
        return f(A, B, x, y) or f(B, A, y, x)

    def has(s, *k):
        return any(v in s for v in k)

    if either(lambda p, q, pc, qc: pc == "Yasuo" and airborne(qc)):
        return 0
    if either(lambda p, q, pc, qc: has(p, "Enchanter", "Ally Protection") and has(q, "Hypercarry", "Marksman")):
        return 1
    if either(lambda p, q, pc, qc: has(p, "Catcher") and has(q, "Burst", "Assassin", "Artillery")):
        return 2
    if either(lambda p, q, pc, qc: has(p, "Initiator", "Vanguard") and hard(pc) and has(q, "Burst", "Assassin", "Artillery")):
        return 3
    if either(lambda p, q, pc, qc: has(p, "Warden", "Tank") and has(q, "Marksman", "Hypercarry")):
        return 4
    if "AoE" in A and "AoE" in B and (hard(x) or hard(y)):
        return 5
    return None


def stats(xs):
    n = len(xs)
    if n < 2:
        return n, None, None
    m = sum(xs) / n
    v = sum((x - m) ** 2 for x in xs) / (n - 1)
    return n, m, v / n


def main():
    tags = json.load(open(os.path.join(REPO, "champions", "tags.json")))["champions"]
    by_id = {v["id"]: k for k, v in tags.items() if "id" in v}
    vkey = lambda p: tuple(int(x) for x in p.split("."))
    files = sorted(glob.glob(os.path.join(HERE, "history", "partners", "*.json")), key=lambda f: vkey(os.path.basename(f)[:-5]))
    patches = {}
    for f in files:
        d = json.load(open(f))
        groups = {i: [] for i in range(len(RULES))}
        none = []
        for key, s in d["pairs"].items():
            a, b = (int(x) for x in key.split("-"))
            if a not in by_id or b not in by_id:
                continue
            r = why(tags, by_id[a], by_id[b])
            (none if r is None else groups[r]).append(s)
        n0, m0, v0 = stats(none)
        rows = {}
        for i, xs in groups.items():
            n, m, v = stats(xs)
            z = round((m - m0) / math.sqrt(v + v0), 2) if m is not None and (v + v0) > 0 else None
            rows[RULES[i]] = {"pairs": n, "mean": round(m * 100, 2) if m is not None else None,
                              "positive": round(sum(1 for x in xs if x > 0) / n, 3) if n else None, "z_vs_unlabelled": z}
        patches[d["patch"]] = {"unlabelled": {"pairs": n0, "mean": round(m0 * 100, 2)}, "rules": rows}
    newest = max(patches, key=vkey)
    verdict = {}
    for rule in RULES:
        r = patches[newest]["rules"][rule]
        if r["pairs"] < MIN_PAIRS or r["z_vs_unlabelled"] is None:
            verdict[rule] = "too few"
        elif r["z_vs_unlabelled"] <= 0:
            verdict[rule] = "faded"
        else:
            verdict[rule] = "holds"
    res = {"newest": newest, "min_pairs": MIN_PAIRS, "verdict": verdict, "patches": patches}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    for p, v in patches.items():
        print(p, "unlabelled mean", v["unlabelled"]["mean"])
        for rule, r in v["rules"].items():
            print(f"   {rule[:44]:44} pairs {r['pairs']:4} mean {r['mean']} pts  z {r['z_vs_unlabelled']}")
    print("newest", newest, verdict)


if __name__ == "__main__":
    main()
