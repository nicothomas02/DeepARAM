"""When players buy finished boots: how many legendary items come before them (0-3), per champion.

For every player row in the owner's archived Mayhem lobbies (all ten players, no names) this takes the ITEM_PURCHASED
events, counts the legendary items (any non-boots item in a feed build list, first purchase only) bought before the
first finished boots, capped at 3, and keeps each champion's most common count. Habit only, on purpose: with about 50
buyers per champion and ~170 champions times several slots, a "this slot wins more" move is often chance (2026-11-23,
e.g. Kai'Sa moved to the 2nd item). Under 20 buyers: null, and the card uses the overall most common slot.

    python data/estimates/boots_slot.py <games dir> <timelines dir>

Reads DeepARAM-PC's archive/games and archive/timelines (*.json.gz); nothing is downloaded.
Writes data/estimates/boots_slot.json: {"all": slot, "champions": {champion id: [slot or null, boots buyers]}}.
Read by web/src/lib/champion-page.ts and champion-history.ts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import gzip
import json
import os
from collections import Counter, defaultdict

from item_slots import BOOTS, REMAKE_SECONDS, legendaries, norm

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_BUYERS = 20
MAX_BEFORE = 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("games")
    ap.add_argument("timelines")
    ap.add_argument("--out", default=os.path.join(HERE, "boots_slot.json"))
    args = ap.parse_args()
    legend = legendaries()
    per, every, used, dates = defaultdict(Counter), Counter(), 0, []
    for path in sorted(glob.glob(os.path.join(args.games, "*.json.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            g = json.load(f)
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        try:
            with gzip.open(os.path.join(args.timelines, os.path.basename(path)), "rt", encoding="utf-8") as f:
                tl = json.load(f)
        except (OSError, ValueError):
            continue
        used += 1
        if g.get("gameCreation"):
            dates.append(g["gameCreation"])
        events = sorted((e for fr in tl.get("frames") or [] for e in fr.get("events") or []
                         if e.get("type") == "ITEM_PURCHASED"), key=lambda e: e.get("timestamp") or 0)
        for p in g.get("participants") or []:
            pid, champ = p["participantId"], str(p.get("championId"))
            seen = set()
            for e in events:
                if e.get("participantId") != pid:
                    continue
                i = norm(e.get("itemId"))
                if i in BOOTS:
                    n = min(len(seen), MAX_BEFORE)
                    per[champ][n] += 1
                    every[n] += 1
                    break
                if i in legend:
                    seen.add(i)
    mode = lambda c: max(sorted(c), key=lambda k: c[k])
    span = [dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).date().isoformat() for t in (min(dates), max(dates))] if dates else []
    out = {
        "_about": f"When players buy finished boots: legendary items bought before them (0-3), per champion, with the "
                  f"number of boots buyers. From purchase timelines of all ten players in the owner's archived Mayhem "
                  f"games ({used:,} games{', ' + span[0] + ' to ' + span[1] if span else ''}). Slot = the most common "
                  f"one (2026-11-23: no outcome-based moves, too few buyers per champion). null = under {MIN_BUYERS} "
                  f"buyers. Made by boots_slot.py; read by web/src/lib/champion-page.ts.",
        "all": mode(every),
        "champions": {ch: [mode(c) if sum(c.values()) >= MIN_BUYERS else None, sum(c.values())]
                      for ch, c in sorted(per.items(), key=lambda kv: int(kv[0]))},
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"{used} games, {sum(every.values())} boots buyers, {len(per)} champions -> {args.out}")


if __name__ == "__main__":
    main()
