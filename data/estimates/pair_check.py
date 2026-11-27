#!/usr/bin/env python3
"""Re-test of the curated augment synergy pairs (augment_synergy_rules.json) on Mayhem games: pair_check.json.

The pairs come from confirmed mechanics (Ethereal Weapon + Mystic Punch...), not from game results. Nico approved
2026-11-25: prune the pairs that show no lift as data grows.

Test per pair, on every archived player (the owner's games included; augments are the game's, not a habit): an
interaction contrast within champions, I = both - A only - B only + neither, on one performance score per player.
The score is the mean of post-game stats, each standardised within the champion, chosen by the champion's role:

  supports (Riot's Enchanter or Catcher subclass, champions/classes.py): the win, share of the team's healing,
            units healed, assists per minute, kill participation, share of the team's crowd-control time, and
            deaths per minute (flipped)
  everyone else: the win, share of the team's damage to champions, and deaths per minute (flipped)

A pair that feeds itself should land above what its two augments add alone. Correlational and estimated: players
who hold both may differ in other ways.

Why these (research/calibration, 2026-11-27): on 4,707 champion x augment and champion x item cells of the archive,
the holders' mean score tracks the public win-rate lead of that choice on that champion with r 0.30, against 0.15 for
the win alone. Damage share is the wrong signal on supports: a good augment or item on an enchanter goes with LESS
damage (r -0.20 / -0.37); the support score reads enchanters at r 0.60 (damage-based score 0.05), catchers at 0.34
(0.29). A generic grade-style score (KDA, damage, damage taken, KP, CS, gold, objectives, like Riot's S grades)
scores 0.16 overall and -0.19 on supports, so it isn't used. Tank- and fighter-specific scores (damage taken,
mitigated, CC) did no better than the damage-based score for them.

Verdict per pair:
  prune     >= MIN_BOTH holders of both and the interaction clearly the wrong way (score contrast z <= Z_PRUNE for a
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


SUPPORT_SUBCLASSES = {"Enchanter", "Catcher"}
SUPPORT_STATS = (("win", 1), ("heal_share", 1), ("units_healed", 1), ("assists", 1), ("kp", 1), ("cc_share", 1), ("deaths", -1))
CORE_STATS = (("win", 1), ("dmg_share", 1), ("deaths", -1))


def supports():
    """Champion ids played as supports: Riot's Enchanter or Catcher as the main subclass, or Enchanter anywhere."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("champion_classes", os.path.join(cm.REPO, "champions", "classes.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ids = cm.load(os.path.join(cm.REPO, "web", "src", "data", "champion-ids.json"))
    out = set()
    for alias, sub in mod.SUBCLASS.items():
        subs = sub if isinstance(sub, tuple) else (sub,)
        if alias in ids and (subs[0] in SUPPORT_SUBCLASSES or "Enchanter" in subs):
            out.add(int(ids[alias]))
    return out


def rows(archive):
    gdir = os.path.join(archive, "games")
    out = []
    for f in sorted(os.listdir(gdir)):
        try:
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        mins = max(1.0, g.get("gameDuration", 0) / 60)
        team = collections.defaultdict(collections.Counter)
        for p in g["participants"]:
            for key in ("totalDamageDealtToChampions", "totalHeal", "timeCCingOthers", "kills"):
                team[p["teamId"]][key] += p["stats"].get(key, 0)
        for p in g["participants"]:
            s = p["stats"]
            tm = team[p["teamId"]]
            out.append({"champ": p["championId"], "augs": {s.get(f"playerAugment{i}") for i in range(1, 7)} - {0, None},
                        "win": 1 if s.get("win") else 0,
                        "dmg_share": s.get("totalDamageDealtToChampions", 0) / (tm["totalDamageDealtToChampions"] or 1),
                        "deaths": s.get("deaths", 0) / mins,
                        "heal_share": s.get("totalHeal", 0) / (tm["totalHeal"] or 1),
                        "units_healed": s.get("totalUnitsHealed", 0),
                        "assists": s.get("assists", 0) / mins,
                        "kp": (s.get("kills", 0) + s.get("assists", 0)) / (tm["kills"] or 1),
                        "cc_share": s.get("timeCCingOthers", 0) / (tm["timeCCingOthers"] or 1)})
    return out


def score_rows(data, support_ids):
    """Each row's performance score: its role's stats, standardised within the champion, averaged (sign-flipped
    where lower is better)."""
    by = collections.defaultdict(list)
    for r in data:
        by[r["champ"]].append(r)
    for champ, rs in by.items():
        stats = SUPPORT_STATS if champ in support_ids else CORE_STATS
        zs = {}
        for key, _ in stats:
            m = sum(r[key] for r in rs) / len(rs)
            sd = math.sqrt(sum((r[key] - m) ** 2 for r in rs) / max(1, len(rs) - 1)) or 1
            zs[key] = (m, sd)
        for r in rs:
            r["score"] = sum(sign * (r[key] - zs[key][0]) / zs[key][1] for key, sign in stats) / len(stats)
            r["win_z"] = (r["win"] - zs["win"][0]) / zs["win"][1]


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


def a_support(champs, support_ids):
    """Share of the champions that took the pair that are scored as supports."""
    return round(len(champs & support_ids) / len(champs), 2) if champs else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    archive = args[0] if args else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    keys = {k: v["id"] for k, v in cm.load(os.path.join(cm.REPO, "simulator", "data", "augments.json"))["augments"].items()}
    rules = cm.load(RULES)
    data = rows(archive)
    support_ids = supports()
    score_rows(data, support_ids)
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
        lead, n = contrast(rs, a, b, "score")
        zw, _ = contrast(rs, a, b, "win_z")
        if n < MIN_BOTH or lead is None:
            verdict = "too few"
        elif sign * lead <= Z_PRUNE:
            verdict = "prune"
        else:
            verdict = "keep"
        out.append({"a": p["a"], "b": p["b"], "ids": [a, b], "points": p.get("points"), "both": n, "z_win": zw, "support": a_support(champs, support_ids),
                    "z_lead": lead, "verdict": verdict})
    res = {"min_both": MIN_BOTH, "z_prune": Z_PRUNE, "players": len(data), "support_champions": len(support_ids), "pairs": out}
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
