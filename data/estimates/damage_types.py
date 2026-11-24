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

By build (coordinator 2026-11-24: "everything switches with build"): with the PC app's archive-players.json, each
player's first three completed items get a style the way the champion page's builds do (build_archetypes.style_of:
crit, onhit, ap, lethality, fighter, tank, enchanter), and a champion's split is also given per style with at least
MIN_STYLE_GAMES games. Within one style the split is steady (Ashe crit 83% physical, sd 0.10; Ashe AP 42%, sd 0.14),
which is what the build toggle should show.

Writes data/estimates/damage_types.json.
Usage: python3 data/estimates/damage_types.py <archive-damage.json> [<archive-players.json>]
"""
import json
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "damage_types.json")
MIN_GAMES = 20
MIN_STYLE_GAMES = 10
VARIES = 0.17


def split(p, m, t):
    s = p + m + t
    return {"physical": round(p / s, 3), "magic": round(m / s, 3), "true": round(t / s, 3)}


def by_style(rows, players_path):
    """{champion id: {style: [physical, magic, true, games]}} from each player's first three completed items."""
    sys.path.insert(0, HERE)
    import build_archetypes as ba
    styles = ba.item_styles()
    players = json.load(open(players_path, encoding="utf-8"))
    players = players["rows"] if isinstance(players, dict) else players
    style = {}
    for r in players:
        items = r.get("items_in_order") or []
        if len(items) >= 2:
            s = ba.style_of(items[:3], styles)
            if s:
                style[(r["game"], r["champion_id"])] = s
    acc = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))
    for r in rows:
        s = style.get((r["game"], r["champion_id"]))
        if not s or r["physical"] + r["magic"] + r["true"] <= 0:
            continue
        a = acc[str(r["champion_id"])][s]
        a[0] += r["physical"]
        a[1] += r["magic"]
        a[2] += r["true"]
        a[3] += 1
    return acc


def main(path, players_path=None):
    rows = json.load(open(path, encoding="utf-8"))
    rows = rows["rows"] if isinstance(rows, dict) else rows
    styled = by_style(rows, players_path) if players_path else {}
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
        champs[c] = {**split(p, m, t), "games": n, "depends_on_build": sd >= VARIES}
        builds = {k: {**split(*v[:3]), "games": v[3]} for k, v in (styled.get(c) or {}).items() if v[3] >= MIN_STYLE_GAMES}
        if builds:
            champs[c]["by_build"] = dict(sorted(builds.items(), key=lambda kv: -kv[1]["games"]))
    out = {"estimated": True, "about": "Share of damage to champions by type, from archived games (all ten players), "
           "pooled over patches. depends_on_build: the split varies widely game to game; by_build: the split per build "
           "style (first three completed items) with enough games.", "games": len({r["game"] for r in rows}),
           "champions": dict(sorted(champs.items(), key=lambda kv: int(kv[0])))}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"{len(champs)} champions from {out['games']} games; {sum(v['depends_on_build'] for v in champs.values())} depend on build")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
