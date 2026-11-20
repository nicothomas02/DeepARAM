"""Do "no boots" builds win more only because boots get sold at the end? Counts from the owner's cached timelines.

End-of-game inventories (what full-build win rates are made of) can't tell "never bought boots" from "sold boots
late for a last item", and the second mostly happens in long games the team is winning. The timelines' ITEM_PURCHASED
and ITEM_SOLD events can. For every player row (all ten players, no names) this splits:

  never   never bought finished boots
  kept    bought them and still had them at the end
  sold    bought them, sold them, and ended without boots

and reports each group's win rate, game length and when boots were sold, plus the win rate of "no boots at the end"
(what an end-of-game inventory sees) against "never bought boots" (what a build choice means).

    python data/analysis/boots_sold.py <archive.json> [--json out.json]

Reads the timeline cache timeline_signals.py keeps (%APPDATA%/Mayhem Stats/timelines); nothing is downloaded.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import statistics as st

# Finished boots (data/cn/builds.py BOOTS, without the basic Boots 1001), and Mayhem/ARAM copies (22xxxx, 32xxxx...).
BOOTS = {2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158}
REMAKE_SECONDS = 300


def norm(i):
    i = int(i or 0)
    return i % 10000 if i >= 100000 else i


def cached(game_id):
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    try:
        with gzip.open(os.path.join(base, "Mayhem Stats", "timelines", f"{game_id}.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def rate(rows):
    if not rows:
        return {"n": 0}
    return {"n": len(rows), "win_rate": round(sum(r["win"] for r in rows) / len(rows), 3),
            "median_minutes": round(st.median(r["minutes"] for r in rows), 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--json")
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    rows, sold_minutes, missing = [], [], 0
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        tl = cached(g.get("gameId"))
        if not tl:
            missing += 1
            continue
        events = [e for f in tl.get("frames") or [] for e in f.get("events") or []]
        for p in g.get("participants") or []:
            pid, s = p["participantId"], p["stats"]
            bought = [e for e in events if e.get("type") == "ITEM_PURCHASED" and e.get("participantId") == pid
                      and norm(e.get("itemId")) in BOOTS]
            sold = [e for e in events if e.get("type") == "ITEM_SOLD" and e.get("participantId") == pid
                    and norm(e.get("itemId")) in BOOTS]
            final = any(norm(s.get(f"item{i}")) in BOOTS for i in range(7))
            group = "never" if not bought else ("kept" if final else ("sold" if sold else "kept_or_swapped"))
            rows.append({"group": group, "final_boots": final, "win": bool(s.get("win")), "minutes": dur / 60})
            if group == "sold":
                sold_minutes.append((sold[-1].get("timestamp") or 0) / 60000)
    by = {k: rate([r for r in rows if r["group"] == k]) for k in ("never", "kept", "sold", "kept_or_swapped")}
    out = {
        "player_rows": len(rows), "games_without_timeline": missing, "groups": by,
        "no_boots_at_end": rate([r for r in rows if not r["final_boots"]]),
        "boots_at_end": rate([r for r in rows if r["final_boots"]]),
        "share_of_no_boots_at_end_that_sold_them": round(
            by["sold"]["n"] / max(1, sum(1 for r in rows if not r["final_boots"])), 3),
        "sold_at_minute": {"median": round(st.median(sold_minutes), 1) if sold_minutes else None,
                           "p25": round(st.quantiles(sold_minutes, n=4)[0], 1) if len(sold_minutes) >= 4 else None,
                           "p75": round(st.quantiles(sold_minutes, n=4)[2], 1) if len(sold_minutes) >= 4 else None},
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
