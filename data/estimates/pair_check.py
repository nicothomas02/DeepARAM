#!/usr/bin/env python3
"""Re-test of the curated augment synergy pairs (augment_synergy_rules.json) on Mayhem games: pair_check.json.

The pairs come from confirmed mechanics (Ethereal Weapon + Mystic Punch...), not from game results. Nico approved
2026-11-25: prune the pairs that show no lift as data grows.

Test per pair, on every archived player (the owner's games included; augments are the game's, not a habit): an
interaction contrast within champions, I = both - A only - B only + neither, on one performance score per player.
The score is each champion's validated post-game score from role_scores.py (role_scores.json): the mean of post-game
stats standardised within the champion, picked by Riot's subclass (Enchanter -> support score: healing, units healed,
assists, kill participation, CC share, deaths; Specialist -> bruiser score; everyone else -> win + damage share -
deaths) and switched per champion only where its own cells clearly track public results better (Blitzcrank, Shaco,
Zeri -> support; Jayce -> frontline on 2026-11-27). A pair that feeds itself should land above what its two augments
add alone. Correlational and estimated: players who hold both may differ in other ways.

Why (research/calibration, 2026-11-27, 4,708 champion x augment and champion x item cells): the holders' mean score
tracks the public win-rate lead of that choice with r 0.33 (subclass defaults 0.315, damage for everyone 0.25, the win
alone 0.15). On enchanters damage share is the wrong signal (good choices go with LESS damage). A generic grade-style
score (KDA, damage, taken, KP, CS, gold, objectives, like Riot's S grades) scores 0.16 and is not used.

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
import json
import math
import os
import sys

import common as cm
import role_scores

OUT = os.path.join(cm.HERE, "pair_check.json")
RULES = os.path.join(cm.HERE, "augment_synergy_rules.json")
MIN_BOTH = 30
Z_PRUNE = -2.0


def score_rows(data, picks):
    """Each row's performance score (r["score"]) on its champion's pick from role_scores.json, plus r["win_z"]."""
    role_scores.standardise(data)
    for r in data:
        r["score"] = role_scores.score(r, picks.get(r["champ"]) or "damage")


def score_picks(subs=None):
    """{champion id: score name}: role_scores.json where present, else the subclass default."""
    subs = subs if subs is not None else role_scores.subclasses()
    saved = cm.load(role_scores.OUT)["champions"] if os.path.exists(role_scores.OUT) else {}
    out = {c: role_scores.default_score(c, subs) for c in subs}
    out.update({int(c): v["score"] for c, v in saved.items()})
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


def role_mix(champs, picks):
    """How the champions that took the pair are scored: {score name: count}."""
    return dict(collections.Counter(picks.get(c) or "damage" for c in champs)) if champs else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    archive = args[0] if args else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    keys = {k: v["id"] for k, v in cm.load(os.path.join(cm.REPO, "simulator", "data", "augments.json"))["augments"].items()}
    rules = cm.load(RULES)
    data = role_scores.player_rows(archive)
    picks = score_picks()
    score_rows(data, picks)
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
        out.append({"a": p["a"], "b": p["b"], "ids": [a, b], "points": p.get("points"), "both": n, "z_win": zw, "scores": role_mix(champs, picks),
                    "z_lead": lead, "verdict": verdict})
    res = {"min_both": MIN_BOTH, "z_prune": Z_PRUNE, "players": len(data), "non_damage_scores": sum(v != "damage" for v in picks.values()), "pairs": out}
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
