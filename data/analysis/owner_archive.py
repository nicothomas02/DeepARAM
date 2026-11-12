"""Aggregates from the site owner's own Mayhem game archive, as counts only.

The archive itself (every game the owner played, with items and durations) is private and never enters the
repo. This script reads an export of it from a path given on the command line, keeps nothing per game, and
writes data/analysis/archive_aggregates.json: how many games ended in each minute (all, by result, by side)
and how often games with 0..6 completed legendary items were won. game_length.py and item_lift.py read that
file; build.py leaves it alone, so it only changes when this script is run by hand against a fresh export.

    python3 data/analysis/owner_archive.py <export.json>

The export is a JSON list of rows {dur: seconds, team: 100|200, win: 0|1, i0..i5: item ids}; any other
field is ignored. Games under 5 minutes count as remakes and are left out of the duration curves.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c  # noqa: E402

LEGENDARY = 5  # `e` in web/src/data/item-groups.json
REMAKE_SECONDS = 300
MAX_MINUTE = 60


def legendary_ids() -> set[int]:
    with open(c.ROOT / "web" / "src" / "data" / "item-groups.json", encoding="utf-8") as f:
        groups = json.load(f)
    return {int(k) for k, v in groups.items() if v.get("e") == LEGENDARY}


def aggregate(rows: list[dict]) -> dict:
    legendary = legendary_ids()
    minutes = {k: Counter() for k in ("all", "win", "loss", "blue", "red")}
    by_items: dict[int, list[int]] = {k: [0, 0] for k in range(7)}
    remakes = 0
    for r in rows:
        win = int(r.get("win") or 0)
        done = sum(1 for k in ("i0", "i1", "i2", "i3", "i4", "i5") if int(r.get(k) or 0) in legendary)
        by_items[min(6, done)][0] += 1
        by_items[min(6, done)][1] += win
        dur = int(r.get("dur") or 0)
        if dur < REMAKE_SECONDS:
            remakes += 1
            continue
        m = min(MAX_MINUTE, dur // 60)
        minutes["all"][m] += 1
        minutes["win" if win else "loss"][m] += 1
        minutes["blue" if int(r.get("team") or 0) == 100 else "red"][m] += 1
    return {
        "built": c.now_iso(),
        "source": "the site owner's own game archive, counts only",
        "games": len(rows),
        "remakes_excluded": remakes,
        "max_minute": MAX_MINUTE,
        "ended_in_minute": {k: {str(m): n for m, n in sorted(v.items())} for k, v in minutes.items()},
        "by_completed_legendary": {str(k): {"games": g, "wins": w} for k, (g, w) in by_items.items()},
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        rows = json.load(f)
    c.write_json(c.OUT / "archive_aggregates.json", aggregate(rows))
    print(f"archive_aggregates.json: {len(rows)} games aggregated")
