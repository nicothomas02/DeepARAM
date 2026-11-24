#!/usr/bin/env python3
"""Starting items that an augment on the first screen makes players buy (augment_starts.json).

Mayhem offers the first augment at the start of the game, before the first shop (research/mayhem-wiki). An Upgrade
augment (Upgrade Stormsurge, Upgrade Infinity Edge...) then has players start toward that item: of the other players
in the owner's archived lobbies who took Upgrade Stormsurge first, 65% started Hextech Alternator, against 6% of the
same champions' players otherwise. The feeds' starting items can't be split by augment, so a start like Ahri's
Hextech Alternator can win on the augment's games. Nico 2026-11-24: "make sure starting item default isn't based on
an augment like upgrade stormsurge making them rush it".

Not only Upgrade augments: Ethereal Weapon first raises Sheen starts (17% vs 7%), Wooglet's Witchcap first
Needlessly Large Rod (40% vs 1%), Big Brain Guardian's Orb, Ultra Hydra Tiamat (Nico 2026-11-24: "some might be
harder to detect like ethereal/bees making Ekko want to rush dusk and dawn").

Written here, per augment with at least MIN_FIRST first picks: first_share, the share of its picks made on the first
screen, and starts, what its first-pickers bought in the first minute (consumables and trinkets left out) as
[items, count, expected] (exact sets; merge.py sums the sets holding a row's items), expected being the count if each first-picker had started like the same champion's other
players (who didn't take that augment first). Comparing within champions matters: Steel Your Heart's first-pickers
are mostly tanks, who start Giant's Belt anyway. merge.py then estimates, for each champion's starting
row, the games the champion's first-screen picks of each augment add to it (data/aramhex/merge.py augment_starts).

The archive lives in the private owner repo; only these aggregates are written here (the owner's own games are left
out). Rerun after the archive grows:

    python3 data/estimates/augment_starts.py /path/to/DeepARAM-PC/archive

Standard library only.
"""

import collections
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(HERE, "augment_starts.json")
ITEMS = os.path.join(ROOT, "web", "public", "assets", "cd", "latest", "plugins", "rcp-be-lol-game-data", "global",
                     "default", "v1", "items.json")
NAMES = os.path.join(ROOT, "web", "src", "data", "augment-names.json")

START_MS = 60_000  # purchases in the first minute
MIN_FIRST = 15
SKIP = {"Consumable", "Trinket"}


def players(archive):
    for f in sorted(os.listdir(os.path.join(archive, "games"))):
        tp = os.path.join(archive, "timelines", f)
        if not os.path.exists(tp):
            continue
        g = json.load(gzip.open(os.path.join(archive, "games", f)))
        t = json.load(gzip.open(tp))
        owner = next((pi["participantId"] for pi in g.get("participantIdentities", [])
                      if pi.get("player", {}).get("puuid") == g.get("_ownerPuuid")), None)
        buys = collections.defaultdict(list)
        for fr in t.get("info", t)["frames"]:
            for e in fr["events"]:
                if e["timestamp"] >= START_MS:
                    continue
                if e["type"] == "ITEM_PURCHASED":
                    buys[e["participantId"]].append(e["itemId"])
                elif e["type"] == "ITEM_UNDO" and e.get("beforeId") in buys[e["participantId"]]:
                    buys[e["participantId"]].remove(e["beforeId"])
        for p in g["participants"]:
            if p["participantId"] == owner:
                continue
            s = p["stats"]
            yield p["championId"], [s.get(f"playerAugment{i}") for i in range(1, 7)], set(buys[p["participantId"]])


def main(archive):
    skip = {r["id"] for r in json.load(open(ITEMS)) if SKIP & set(r.get("categories") or [])}
    key = lambda s: tuple(sorted(i for i in s if i not in skip))
    names = json.load(open(NAMES))
    rows = [(c, a, key(s)) for c, a, s in players(archive)]
    picks = collections.Counter(x for _, a, _ in rows for x in a if x)
    first = collections.Counter(a[0] for _, a, _ in rows if a[0])
    by_champ = collections.defaultdict(list)
    for c, a, s in rows:
        by_champ[c].append((a[0], s))
    out = {}
    for aid, n in sorted(first.items()):
        if n < MIN_FIRST:
            continue
        hit = collections.Counter(s for _, a, s in rows if a[0] == aid)
        expected = collections.Counter()
        for c, a, _ in rows:
            if a[0] != aid:
                continue
            rest = [s for f, s in by_champ[c] if f != aid]
            for s, v in collections.Counter(rest).items():
                expected[s] += v / len(rest)
        starts = sorted(set(hit) | {s for s, v in expected.items() if v >= 0.2}, key=lambda s: -hit[s])
        out[str(aid)] = {"name": names.get(str(aid), ""), "first_share": round(n / picks[aid], 3), "first_pickers": n,
                         "starts": [[list(s), hit[s], round(expected[s], 2)] for s in starts]}
    data = {"players": len(rows), "augments": out}
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(rows)} players, {len(out)} augments with {MIN_FIRST}+ first picks -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "deeparam-pc", "archive"))
