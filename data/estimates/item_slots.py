"""Which legendary slot (1st to 6th) players buy each item in, per champion. Counts from the owner's cached timelines.

The stats feeds list six-item builds as sets (sorted by item id), so they can't say whether an item is usually a 4th,
5th or 6th buy. The purchase timelines can. For every player row (all ten players, no names) this takes the
ITEM_PURCHASED events, keeps the first purchase of each legendary item (an item in any feed core, single-item or
six-item build list under data/cn/builds, boots left out), and counts the order they came in.

Only the slot comes from here; which items to show and their DeepScore still come from the stats feeds (Nico
2026-11-20: the owner's games only where no other data exists). Read by web/src/lib/champion-page.ts.

    python data/estimates/item_slots.py <archive.json> [--timelines <DeepARAM-PC archive/timelines>]

Reads the timeline cache timeline_signals.py keeps (%APPDATA%/Mayhem Stats/timelines); nothing is downloaded.
Writes data/estimates/item_slots.json: {"champions": {champion id: {item id: [count at slot 1..6]}}, "all": {...}}.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BOOTS = {2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158}
REMAKE_SECONDS = 300
SLOTS = 6


def norm(i):
    i = int(i or 0)
    return i % 10000 if i >= 100000 else i


def legendaries():
    out = set()
    for path in glob.glob(os.path.join(ROOT, "data", "cn", "builds", "*.json")):
        with open(path, encoding="utf-8") as f:
            items = (json.load(f).get("items") or {})
        for name in ("core", "other", "full_builds"):
            for row in items.get(name) or []:
                out.update(norm(i) for i in row["items"])
    return out - BOOTS


TIMELINES = None  # --timelines: DeepARAM-PC's archive/timelines (the weekly job); else the app's cache


def cached(game_id):
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(TIMELINES, f"{game_id}.json.gz") if TIMELINES else os.path.join(base, "Mayhem Stats", "timelines", f"{game_id}.json.gz")
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--out", default=os.path.join(HERE, "item_slots.json"))
    ap.add_argument("--timelines", help="folder of <gameId>.json.gz timelines (DeepARAM-PC archive/timelines)")
    args = ap.parse_args()
    global TIMELINES
    TIMELINES = args.timelines
    legend = legendaries()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    per = defaultdict(lambda: defaultdict(lambda: [0] * SLOTS))
    used, rows, dates = 0, 0, []
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        tl = cached(g.get("gameId"))
        if not tl:
            continue
        used += 1
        if g.get("gameCreation"):
            dates.append(g["gameCreation"])
        events = sorted((e for fr in tl.get("frames") or [] for e in fr.get("events") or []
                         if e.get("type") == "ITEM_PURCHASED"), key=lambda e: e.get("timestamp") or 0)
        for p in g.get("participants") or []:
            pid, champ = p["participantId"], str(p.get("championId"))
            order = []
            for e in events:
                i = norm(e.get("itemId"))
                if e.get("participantId") == pid and i in legend and i not in order:
                    order.append(i)
            rows += 1
            for slot, i in enumerate(order[:SLOTS]):
                per[champ][str(i)][slot] += 1
    every = defaultdict(lambda: [0] * SLOTS)
    for items in per.values():
        for i, c in items.items():
            every[i] = [a + b for a, b in zip(every[i], c)]
    import datetime as dt
    span = [dt.datetime.utcfromtimestamp(t / 1000).date().isoformat() for t in (min(dates), max(dates))] if dates else []
    out = {
        "_about": f"Legendary slot (1st to 6th) each item is first bought in, per champion: counts from the purchase "
                  f"timelines of all ten players in the owner's archived Mayhem games ({used:,} games, {rows:,} player "
                  f"rows{', ' + span[0] + ' to ' + span[1] if span else ''}). Legendary = any non-boots item in a feed "
                  f"build list. Only the slot comes from here; item choice and DeepScore come from the stats feeds. "
                  f"Read by web/src/lib/champion-page.ts.",
        "all": {i: c for i, c in sorted(every.items(), key=lambda kv: int(kv[0]))},
        "champions": {ch: {i: c for i, c in sorted(items.items(), key=lambda kv: int(kv[0]))}
                      for ch, items in sorted(per.items(), key=lambda kv: int(kv[0]))},
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{used} games, {rows} player rows, {len(per)} champions -> {args.out}")


if __name__ == "__main__":
    main()
