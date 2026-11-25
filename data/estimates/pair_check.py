#!/usr/bin/env python3
"""Re-test of the curated augment synergy pairs (augment_synergy_rules.json) on Mayhem games: pair_check.json.

The pairs come from confirmed mechanics (Ethereal Weapon + Mystic Punch...), not from game results. Nico approved
2026-11-25: prune the pairs that show no lift as data grows.

Test per pair, on every archived player (the owner's games included; augments are the game's, not a habit): an
interaction contrast within champions, I = both - A only - B only + neither, on damage to champions per minute and
on wins, each standardised within the champion. A pair that feeds itself should land above what its two augments
add alone. Correlational and estimated: players who hold both may differ in other ways.

Verdict per pair:
  prune     >= MIN_BOTH holders of both and the interaction clearly the wrong way (mean of the two z <= Z_PRUNE for a
            pair that helps; >= -Z_PRUNE for a pair marked as clashing)
  keep      enough holders and not clearly the wrong way

Why "clearly the wrong way" and not "no lift": a pair worth 1-2 win-rate points is far below what a few dozen holders
can show (the contrast's noise is about a third of a standard deviation at 35 holders), so "no visible lift" would
prune good pairs at random. A pair whose holders do clearly worse than its two augments alone is a real sign.
  too few   fewer than MIN_BOTH holders of both: the pair stays on its mechanics source

Usage: python3 data/estimates/pair_check.py /path/to/DeepARAM-PC/archive [--apply]
--apply removes pruned pairs from augment_synergy_rules.json (rerun augment_synergy.py afterwards).
Standard library only. Only aggregates are written.
"""

import collections
import gzip
import json
import math
import os
import sys

import common as cm

OUT = os.path.join(cm.HERE, "pair_check.json")
RULES = os.path.join(cm.HERE, "augment_synergy_rules.json")
MIN_BOTH = 30
Z_PRUNE = -2.0


def rows(archive):
    gdir = os.path.join(archive, "games")
    out = []
    for f in sorted(os.listdir(gdir)):
        try:
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        mins = max(1.0, g.get("gameDuration", 0) / 60)
        for p in g["participants"]:
            s = p["stats"]
            out.append({"champ": p["championId"], "augs": {s.get(f"playerAugment{i}") for i in range(1, 7)} - {0, None},
                        "win": 1 if s.get("win") else 0, "dpm": s.get("totalDamageDealtToChampions", 0) / mins})
    return out


def contrast(rs, a, b, key):
    cells = collections.defaultdict(list)
    for r in rs:
        cells[(a in r["augs"], b in r["augs"])].append(r[key])
    if any(len(cells[k]) < 2 for k in ((True, True), (True, False), (False, True), (False, False))):
        return None, len(cells[(True, True)])
    est, var = 0.0, 0.0
    for k, sign in (((True, True), 1), ((True, False), -1), ((False, True), -1), ((False, False), 1)):
        xs = cells[k]
        m = sum(xs) / len(xs)
        est += sign * m
        var += sum((x - m) ** 2 for x in xs) / (len(xs) - 1) / len(xs)
    return (round(est / math.sqrt(var), 2) if var > 0 else None), len(cells[(True, True)])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    archive = args[0] if args else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    keys = {k: v["id"] for k, v in cm.load(os.path.join(cm.REPO, "simulator", "data", "augments.json"))["augments"].items()}
    rules = cm.load(RULES)
    data = rows(archive)
    by = collections.defaultdict(list)
    for r in data:
        by[r["champ"]].append(r)
    for rs in by.values():
        for key in ("dpm", "win"):
            m = sum(r[key] for r in rs) / len(rs)
            sd = math.sqrt(sum((r[key] - m) ** 2 for r in rs) / max(1, len(rs) - 1)) or 1
            for r in rs:
                r[key + "_z"] = (r[key] - m) / sd
    out = []
    for p in rules["pairs"]:
        a, b = keys.get(p["a"]), keys.get(p["b"])
        sign = -1 if (p.get("points", 1) < 0) else 1
        if a is None or b is None:
            out.append({"a": p["a"], "b": p["b"], "both": 0, "verdict": "too few", "note": "augment not in the pool"})
            continue
        # only the champions that ever took both, so the contrast compares like with like
        champs = {r["champ"] for r in data if a in r["augs"] and b in r["augs"]}
        rs = [r for r in data if r["champ"] in champs]
        zd, n = contrast(rs, a, b, "dpm_z")
        zw, _ = contrast(rs, a, b, "win_z")
        lead = round((zd + zw) / 2, 2) if zd is not None and zw is not None else None
        if n < MIN_BOTH or lead is None:
            verdict = "too few"
        elif sign * lead <= Z_PRUNE:
            verdict = "prune"
        else:
            verdict = "keep"
        out.append({"a": p["a"], "b": p["b"], "ids": [a, b], "points": p.get("points"), "both": n, "z_dpm": zd, "z_win": zw,
                    "z_lead": lead, "verdict": verdict})
    res = {"min_both": MIN_BOTH, "z_prune": Z_PRUNE, "players": len(data), "pairs": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    for r in sorted(out, key=lambda r: -r["both"]):
        print(f"{r['a']:28} {r['b']:28} both {r['both']:4} lead z {r.get('z_lead')} -> {r['verdict']}")
    pruned = {(r["a"], r["b"]) for r in out if r["verdict"] == "prune"}
    if "--apply" in sys.argv and pruned:
        rules["pairs"] = [p for p in rules["pairs"] if (p["a"], p["b"]) not in pruned]
        with open(RULES, "w", encoding="utf-8") as f:
            json.dump(rules, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"removed {len(pruned)} pairs from {os.path.relpath(RULES, cm.REPO)}")


if __name__ == "__main__":
    main()
