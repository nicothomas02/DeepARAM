#!/usr/bin/env python3
"""Purchase order and starting items per build (Nico 2026-11-24: add the ARAMKit features we lack, where a source
allows). No reusable source has either per build (AramHex cores are unordered sets and have no starters), so this
counts the owner's archived games, all ten players, no names (the PC app thread's archive-players.json). Estimated.

A player's build style is that of their first three completed items (build_archetypes.style_of, the champion page's
build styles). Per champion and style with at least MIN_GAMES games:
  orders    the most common first three completed items, in the order bought, with games
  starters  the most common starting buys (first ~minute), with games
Games only, no win rates: at tens of games per build a win rate is mostly noise.

Writes data/estimates/build_routes.json. Usage: python3 data/estimates/build_routes.py <archive-players.json>
"""
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_archetypes as ba  # noqa: E402

OUT = os.path.join(HERE, "build_routes.json")
MIN_GAMES = 10
TOP = 3


def main(path):
    rows = json.load(open(path, encoding="utf-8"))
    rows = rows["rows"] if isinstance(rows, dict) else rows
    styles = ba.item_styles()
    orders = defaultdict(lambda: defaultdict(Counter))
    starts = defaultdict(lambda: defaultdict(Counter))
    games = defaultdict(Counter)
    for r in rows:
        items = r.get("items_in_order") or []
        if len(items) < 2:
            continue
        s = ba.style_of(items[:3], styles)
        if not s:
            continue
        c = str(r["champion_id"])
        games[c][s] += 1
        if len(items) >= 3:
            orders[c][s][tuple(items[:3])] += 1
        if r.get("starting_items"):
            starts[c][s][tuple(sorted(r["starting_items"]))] += 1
    out = {}
    for c, by in games.items():
        builds = {}
        for s, n in by.most_common():
            if n < MIN_GAMES:
                continue
            builds[s] = {"games": n,
                         "orders": [[list(k), v] for k, v in orders[c][s].most_common(TOP)],
                         "starters": [[list(k), v] for k, v in starts[c][s].most_common(TOP)]}
        if builds:
            out[c] = builds
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"estimated": True, "about": "Purchase order of the first three completed items and starting buys per "
                   "build style, counted in archived games (all ten players). Games only.",
                   "champions": dict(sorted(out.items(), key=lambda kv: int(kv[0])))}, f, indent=1)
        f.write("\n")
    print(f"{len(out)} champions, {sum(len(v) for v in out.values())} builds")


if __name__ == "__main__":
    main(sys.argv[1])
