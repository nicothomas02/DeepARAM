"""Item lift without the full-build bonus.

The item lists in data/cn/builds come from the six-item builds players finished, so every item's win rate
carries the same "the game went long enough to finish a build" effect as every other item's. Measuring an
item against its champion's overall win rate (the raw lift on the item pages) mixes that effect in; here
each item is measured against the champion's pick-weighted average over all finished builds instead, so the
number says how the item did among builds that were completed. The premium itself (finished-build average
minus champion win rate) is reported per champion and overall, and checked against the owner's own archive
(win rate by number of completed legendary items, counts in archive_aggregates.json).

Output data/analysis/item_lift.json:
  premium   {mean, sd, share_positive, champions: n}  the finished-build bonus across champions, in win-rate points
  items     id -> {raw, adjusted, premium, builders, rank_raw, rank_adjusted}  lifts as fractions, ranks among legendaries
  moved     items whose rank changed most between the two lifts (biggest first)
  archive   win rate (with Wilson ranges) by completed legendary items from the owner's archive, or null
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c  # noqa: E402

MIN_WEIGHT = 0.002  # summed champion pick x item pick below which an item isn't ranked


def legendaries() -> set[int]:
    with open(c.ROOT / "web" / "src" / "data" / "item-groups.json", encoding="utf-8") as f:
        return {int(k) for k, v in json.load(f).items() if v.get("e") == 5}


def wilson(wins: float, n: float, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 0.0)
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (round(centre - half, 4), round(centre + half, 4))


def champion_builds() -> list[tuple[str, dict, dict]]:
    """(alias, feed row for the live patch, builds file) for every champion with finished builds."""
    live = c.by_patch()[c.patches()[-1]["patch"]]
    names = c.id_to_alias()
    out = []
    for path in (c.ROOT / "data" / "cn" / "builds").glob("*.json"):
        if path.name == "index.json":
            continue
        with open(path, encoding="utf-8") as f:
            b = json.load(f)
        alias = names.get(str(b.get("id")))
        row = live.get(alias) if alias else None
        if row and b.get("items", {}).get("full_builds"):
            out.append((alias, row, b))
    return out


def build() -> dict:
    leg = legendaries()
    premiums = []
    acc = defaultdict(lambda: {"w": 0.0, "raw": 0.0, "adj": 0.0, "prem": 0.0})
    for alias, row, b in champion_builds():
        full = b["items"]["full_builds"]
        w_full = sum(r["pick_rate"] for r in full)
        if w_full <= 0:
            continue
        full_mean = sum(r["pick_rate"] * r["win_rate"] for r in full) / w_full
        prem = full_mean - row["win_rate"]
        premiums.append(prem)
        for item_row in b["items"].get("other", []):
            for i in set(item_row["items"]):
                w = row["pick_rate"] * min(1.0, item_row["pick_rate"])
                a = acc[i]
                a["w"] += w
                a["raw"] += w * (item_row["win_rate"] - row["win_rate"])
                a["adj"] += w * (item_row["win_rate"] - full_mean)
                a["prem"] += w * prem
    items = {}
    for i, a in acc.items():
        if a["w"] < MIN_WEIGHT:
            continue
        items[i] = {"raw": round(a["raw"] / a["w"], 4), "adjusted": round(a["adj"] / a["w"], 4),
                    "premium": round(a["prem"] / a["w"], 4), "weight": round(a["w"], 4)}
    ranked = [i for i in items if i in leg]
    for key, rank in (("raw", "rank_raw"), ("adjusted", "rank_adjusted")):
        for pos, i in enumerate(sorted(ranked, key=lambda x: -items[x][key]), 1):
            items[i][rank] = pos
    moved = sorted(ranked, key=lambda i: -abs(items[i]["rank_raw"] - items[i]["rank_adjusted"]))
    archive = None
    path = c.OUT / "archive_aggregates.json"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            agg = json.load(f)
        rows = []
        for k, v in sorted(agg["by_completed_legendary"].items(), key=lambda kv: int(kv[0])):
            if v["games"]:
                rows.append({"completed": int(k), "games": v["games"], "win_rate": round(v["wins"] / v["games"], 4),
                             "ci": wilson(v["wins"], v["games"])})
        total = sum(r["games"] for r in rows)
        wins = sum(v["wins"] for v in agg["by_completed_legendary"].values())
        archive = {"games": total, "win_rate": round(wins / total, 4) if total else None, "rows": rows}
    return {
        "built": c.now_iso(),
        "method": "adjusted lift = item win rate minus the champion's pick-weighted finished-build win rate; raw lift = minus the champion's win rate; ranks among legendary items by pick-weighted lift",
        "premium": {"champions": len(premiums), "mean": round(100 * c.mean(premiums), 2), "sd": round(100 * c.sd(premiums), 2),
                    "share_positive": round(sum(1 for p in premiums if p > 0) / len(premiums), 3) if premiums else None},
        "ranked": len(ranked),
        "items": {str(i): v for i, v in sorted(items.items())},
        "moved": [{"id": i, "from": items[i]["rank_raw"], "to": items[i]["rank_adjusted"]} for i in moved[:12]],
        "archive": archive,
    }


if __name__ == "__main__":
    c.write_json(c.OUT / "item_lift.json", build())
