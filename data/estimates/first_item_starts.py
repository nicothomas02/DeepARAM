#!/usr/bin/env python3
"""What players start with, by the first Legendary item they finish (first_item_starts.json).

The feeds list starting items per champion, not per build, so a champion's less played build can have no start that
builds into it: AP Amumu (the feed's starts are all Giant's Belt), crit Shaco, Gnar once its only AD start turned out
to be half Weapon of Destiny's (Nico 2026-11-24: "find solutions for missing/empty data"). The site then shows, marked
estimated, the most common start among players whose first Legendary is that build's first item, when it fits.

From the other players in the owner's archived lobbies (the owner's own games are left out): starts are the first
minute's purchases (consumables and trinkets left out, undone buys removed), the first Legendary is the first
finished item of epicness 5 that isn't boots (web/src/data/item-groups.json). A player whose start is one their first
augment makes players buy (augment_starts.json: 95% lower bound of the rise above the same champions' other players)
is left out, so Upgrade Stormsurge's Alternator doesn't count as everyone's Stormsurge start.

Rerun after the archive grows (after augment_starts.py):

    python3 data/estimates/first_item_starts.py /path/to/DeepARAM-PC/archive

Standard library only.
"""

import collections
import json
import math
import os
import sys

import augment_starts as AS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(HERE, "first_item_starts.json")
GROUPS = os.path.join(ROOT, "web", "src", "data", "item-groups.json")
TOP = 8  # starts kept per item


def wilson_low(k, n, z=1.96):
    if not n:
        return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def first_legendaries(archive, legendary):
    """(first augment, start ids, first Legendary) per other player, in the archive's order."""
    import gzip

    for f in sorted(os.listdir(os.path.join(archive, "games"))):
        tp = os.path.join(archive, "timelines", f)
        if not os.path.exists(tp):
            continue
        g = json.load(gzip.open(os.path.join(archive, "games", f)))
        t = json.load(gzip.open(tp))
        owner = next((pi["participantId"] for pi in g.get("participantIdentities", [])
                      if pi.get("player", {}).get("puuid") == g.get("_ownerPuuid")), None)
        start = collections.defaultdict(list)
        first = {}
        for fr in t.get("info", t)["frames"]:
            for e in fr["events"]:
                pid = e.get("participantId")
                if e["type"] == "ITEM_PURCHASED":
                    i = e["itemId"] % 10000 if e["itemId"] >= 100000 else e["itemId"]
                    if e["timestamp"] < AS.START_MS:
                        start[pid].append(e["itemId"])
                    if i in legendary and pid not in first:
                        first[pid] = i
                elif e["type"] == "ITEM_UNDO" and e["timestamp"] < AS.START_MS and e.get("beforeId") in start[pid]:
                    start[pid].remove(e["beforeId"])
        for p in g["participants"]:
            pid = p["participantId"]
            if pid == owner or pid not in first:
                continue
            yield p["stats"].get("playerAugment1"), start[pid], first[pid]


def main(archive):
    skip = {r["id"] for r in json.load(open(AS.ITEMS)) if AS.SKIP & set(r.get("categories") or [])}
    groups = json.load(open(GROUPS))
    legendary = {int(i) for i, v in groups.items() if v.get("e") == 5 and "Boots" not in (v.get("g") or [])}
    est = json.load(open(AS.OUT))["augments"]
    risen = {int(a): {tuple(s) for s, h, x in v["starts"] if wilson_low(h, v["first_pickers"]) > x / v["first_pickers"]}
             for a, v in est.items()}
    by_item = collections.defaultdict(collections.Counter)
    left_out = 0
    for aug, s, item in first_legendaries(archive, legendary):
        key = tuple(sorted(i for i in s if i not in skip))
        if key in risen.get(aug, ()):
            left_out += 1
            continue
        by_item[item][key] += 1
    out = {str(i): {"players": sum(c.values()), "starts": [[list(k), v] for k, v in c.most_common(TOP) if k]}
           for i, c in sorted(by_item.items())}
    with open(OUT, "w") as f:
        json.dump({"left_out": left_out, "items": out}, f, separators=(",", ":"))
        f.write("\n")
    print(f"{sum(v['players'] for v in out.values())} players over {len(out)} first items ({left_out} augment starts left out) -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "deeparam-pc", "archive"))
