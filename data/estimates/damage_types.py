#!/usr/bin/env python3
"""Damage type split per champion (Nico 2026-11-24, from the ARAMKit comparison: helps decide armor vs magic resist).

No source we may reuse publishes it, so it comes from the owner's archived Mayhem games, all ten players per game
(the PC app thread exports archive-damage.json: {game, patch, champion_id, physical, magic, true} per player, no
names). Labelled estimated on the site. Pooled over every archived patch: 16.23 alone has 25 games.

Checked, not assumed (2026-11-24, against ARAMKit's public 16.22 numbers, cross-check only): the median champion's
largest share differs by 3 pts; 6 of 173 differ by more than 10 pts in physical share, mostly champions played both
AD and AP (Kai'Sa, Miss Fortune, Ashe, Nasus; also Leona and Swain by 11). Those split widely game to game, so a
champion whose per-game physical share has a standard deviation of at least VARIES (the top tenth) is marked "depends
on build" instead of showing one confident split; it marks 4 of the 6.

Writes data/estimates/damage_types.json. Usage: python3 data/estimates/damage_types.py <archive-damage.json>
"""
import json
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "damage_types.json")
MIN_GAMES = 20
VARIES = 0.17


def main(path):
    rows = json.load(open(path, encoding="utf-8"))
    rows = rows["rows"] if isinstance(rows, dict) else rows
    tot = defaultdict(lambda: [0, 0, 0])
    share = defaultdict(list)
    for r in rows:
        t = r["physical"] + r["magic"] + r["true"]
        if t <= 0:
            continue
        c = str(r["champion_id"])
        for i, k in enumerate(("physical", "magic", "true")):
            tot[c][i] += r[k]
        share[c].append(r["physical"] / t)
    champs = {}
    for c, (p, m, t) in tot.items():
        n = len(share[c])
        if n < MIN_GAMES:
            continue
        s = p + m + t
        sd = statistics.pstdev(share[c])
        champs[c] = {"physical": round(p / s, 3), "magic": round(m / s, 3), "true": round(t / s, 3), "games": n,
                     "depends_on_build": sd >= VARIES}
    out = {"estimated": True, "about": "Share of damage to champions by type, from archived games (all ten players), "
           "pooled over patches. depends_on_build: the split varies widely game to game.", "games": len({r["game"] for r in rows}),
           "champions": dict(sorted(champs.items(), key=lambda kv: int(kv[0])))}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"{len(champs)} champions from {out['games']} games; {sum(v['depends_on_build'] for v in champs.values())} depend on build")


if __name__ == "__main__":
    main(sys.argv[1])
