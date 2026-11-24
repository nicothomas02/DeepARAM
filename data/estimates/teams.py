#!/usr/bin/env python3
"""Best full teams (Nico 2026-11-24: "add best full teams list, even if it's mostly projected/extrapolated from data").

No source publishes five-champion team results, so every team here is PROJECTED from two things the live stats do
publish (data/cn/champions.json, one snapshot):
  - each champion's win rate, and
  - each champion's 50 most played-with teammates and the pair's win rate (best_partners).

Model, on the log-odds scale (the same one lib/synergy.ts uses for the Duos tab):
  team edge = sum of the five champions' edges over 50%  +  carry * sum of the ten pairs' synergies
where a pair's synergy is its win rate minus what the two champions' own win rates predict. Pairs that aren't
listed (outside both champions' top 50 teammates) count as 0 synergy and are reported per team.

Checked on data, not assumed:
  - carry: how much of a pair's synergy on one patch shows up again on the next (regression slope of 16.23's
    synergy on 16.22's, same pairs). It scales every synergy, so one-patch luck is discounted by the measured amount.
  - additivity: the games-weighted average pair synergy. Near 0 means champion edges add up for pairs, the
    assumption the team sum extends to five champions. ASSUMPTION THAT CAN'T BE CHECKED: that it still holds for five
    (no team data exists); the page labels every number Projected.

Writes data/estimates/teams.json. Usage: python3 data/estimates/teams.py [--before <git rev>]
"""

import argparse
import itertools
import json
import math
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "teams.json")
SIZE = 5
TOP = 20
BEAM = 400
# Teams in the list differ by at least this many champions, so it isn't one core with every fifth member swapped.
MIN_DIFFERENT = 2


def logit(p):
    p = min(0.99, max(0.01, p))
    return math.log(p / (1 - p))


def inv(x):
    return 1 / (1 + math.exp(-x))


def pairs(snapshot):
    """{(a, b): (synergy in log-odds, pair pick weight)} with a < b, averaging the two directions when both list it."""
    wr = {c["champion_id"]: c["win_rate"] for c in snapshot["champions"]}
    pick = {c["champion_id"]: c["pick_rate"] for c in snapshot["champions"]}
    acc = {}
    for c in snapshot["champions"]:
        a = c["champion_id"]
        for p in c.get("best_partners") or []:
            b = p["champion_id"]
            if b not in wr or a == b:
                continue
            s = logit(p["win_rate"]) - logit(wr[a]) - logit(wr[b])
            k = (min(a, b), max(a, b))
            acc.setdefault(k, []).append((s, p["pick_rate"] * pick[a]))
    return {k: (sum(s for s, _ in v) / len(v), sum(w for _, w in v)) for k, v in acc.items()}


def carry_over(old, new):
    """Slope of new synergy on old over pairs listed in both (weighted by games), clamped to [0, 1]."""
    ks = [k for k in old if k in new]
    w = [old[k][1] + new[k][1] for k in ks]
    x = [old[k][0] for k in ks]
    y = [new[k][0] for k in ks]
    W = sum(w)
    mx = sum(a * b for a, b in zip(w, x)) / W
    my = sum(a * b for a, b in zip(w, y)) / W
    cov = sum(a * (b - mx) * (c - my) for a, b, c in zip(w, x, y)) / W
    var = sum(a * (b - mx) ** 2 for a, b in zip(w, x)) / W
    return max(0.0, min(1.0, cov / var if var else 0.0)), len(ks)


def git_json(rev, path):
    return json.loads(subprocess.run(["git", "-C", ROOT, "show", f"{rev}:{path}"], capture_output=True, text=True, check=True).stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", help="git revision of data/cn/champions.json from the previous patch, for the carry-over")
    args = ap.parse_args()
    now = json.load(open(os.path.join(ROOT, "data", "cn", "champions.json"), encoding="utf-8"))
    P = pairs(now)
    names = {c["champion_id"]: c["name"] for c in now["champions"]}
    edge = {c["champion_id"]: logit(c["win_rate"]) for c in now["champions"]}

    # Without --before, keep the last measured carry-over (teams.json), so the daily refresh needs no git history.
    prev = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    carry, checked = prev.get("carry_over"), prev.get("carry_over_pairs", 0)
    if args.before:
        carry, checked = carry_over(pairs(git_json(args.before, "data/cn/champions.json")), P)
    if carry is None:
        raise SystemExit("no measured carry-over yet: run once with --before <rev of the previous patch's champions.json>")
    W = sum(w for _, w in P.values())
    additivity = sum(s * w for s, w in P.values()) / W

    syn = {k: carry * s for k, (s, _) in P.items()}

    def score(team):
        e = sum(edge[c] for c in team)
        s = sum(syn.get((min(a, b), max(a, b)), 0.0) for a, b in itertools.combinations(team, 2))
        return e + s

    champs = sorted(edge, key=lambda c: -edge[c])
    beam = [((c,), score((c,))) for c in champs]
    for _ in range(SIZE - 1):
        nxt = {}
        for team, _ in beam:
            for c in champs:
                if c in team:
                    continue
                t = tuple(sorted(team + (c,)))
                if t not in nxt:
                    nxt[t] = score(t)
        beam = sorted(nxt.items(), key=lambda kv: -kv[1])[:BEAM]

    picked = []
    for team, sc in beam:
        if all(len(set(team) - set(p)) >= MIN_DIFFERENT for p, _ in picked):
            picked.append((team, sc))
        if len(picked) >= TOP:
            break

    def row(team, sc):
        ps = list(itertools.combinations(team, 2))
        known = [(a, b) for a, b in ps if (min(a, b), max(a, b)) in P]
        best = sorted(known, key=lambda p: -syn[(min(p), max(p))])[:2]
        return {
            "champions": sorted(team, key=lambda c: -edge[c]),
            "names": [names[c] for c in sorted(team, key=lambda c: -edge[c])],
            "projected_win_rate": round(inv(sc), 4),
            "from_champions": round(inv(sum(edge[c] for c in team)), 4),
            "synergy_pts": round((inv(sc) - inv(sum(edge[c] for c in team))) * 100, 2),
            "pairs_known": len(known),
            "best_pairs": [[names[a], names[b]] for a, b in best],
        }

    out = {
        "projected": True,
        "about": "Five-champion teams projected from champion win rates and two-champion synergies (data/estimates/teams.py). "
        "No source publishes full-team results.",
        "snapshot": now.get("meta", {}),
        "carry_over": round(carry, 3),
        "carry_over_pairs": checked,
        "pair_additivity_pts": round(additivity * 25, 3),  # log-odds near 50% x 25 ~ percentage points
        "pairs": len(P),
        "teams": [row(t, s) for t, s in picked],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"carry-over {carry:.3f} on {checked} pairs; average pair synergy {additivity * 25:+.2f} pts; {len(P)} pairs")
    for r in out["teams"][:10]:
        print(f"{r['projected_win_rate']:.3f} ({r['from_champions']:.3f} + {r['synergy_pts']:+.2f}) {', '.join(r['names'])} [{r['pairs_known']}/10 pairs]")


if __name__ == "__main__":
    main()
