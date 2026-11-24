#!/usr/bin/env python3
"""Starts that include boots, per champion (boot_starts.json), from the other players in the owner's archived lobbies.

The stats feed lists each champion's top five starts only, and boots almost never make its list, though many players
start with them: Dagger + Berserker's Greaves is the most common start of Yasuo, Kayle, Yone, Vayne and Kog'Maw in the
archive. Nico 2026-11-24: "Allow boots to be purchased for starting items." The site adds these starts to the
champion's starter list, marked estimated, ranked by DeepScore on their lead over the same champion's archive average.

Starts are the first minute's purchases (consumables and trinkets left out, undone buys removed), as in
augment_starts.py. The owner's own games are left out. Rerun after the archive grows:

    python3 data/estimates/boot_starts.py /path/to/DeepARAM-PC/archive

Standard library only.
"""

import collections
import gzip
import json
import os
import sys

import augment_starts as AS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(HERE, "boot_starts.json")
MIN_PLAYERS = 5  # a boot start needs this many players to be listed
TOP = 3  # boot starts kept per champion


def main(archive):
    items = json.load(open(AS.ITEMS))
    skip = {r["id"] for r in items if AS.SKIP & set(r.get("categories") or [])}
    boots = {r["id"] for r in items if "Boots" in (r.get("categories") or [])}
    players, wins = collections.Counter(), collections.Counter()
    starts = collections.defaultdict(collections.Counter)
    start_wins = collections.defaultdict(collections.Counter)
    for f in sorted(os.listdir(os.path.join(archive, "games"))):
        tp = os.path.join(archive, "timelines", f)
        if not os.path.exists(tp):
            continue
        g = json.load(gzip.open(os.path.join(archive, "games", f)))
        t = json.load(gzip.open(tp))
        owner = next((pi["participantId"] for pi in g.get("participantIdentities", [])
                      if pi.get("player", {}).get("puuid") == g.get("_ownerPuuid")), None)
        bought = collections.defaultdict(list)
        for fr in t.get("info", t)["frames"]:
            for e in fr["events"]:
                pid = e.get("participantId")
                if e["type"] == "ITEM_PURCHASED" and e["timestamp"] < AS.START_MS:
                    bought[pid].append(e["itemId"])
                elif e["type"] == "ITEM_UNDO" and e["timestamp"] < AS.START_MS and e.get("beforeId") in bought[pid]:
                    bought[pid].remove(e["beforeId"])
        for p in g["participants"]:
            pid, c = p["participantId"], str(p["championId"])
            if pid == owner:
                continue
            w = 1 if p["stats"].get("win") else 0
            players[c] += 1
            wins[c] += w
            key = tuple(sorted(i for i in bought[pid] if i not in skip))
            if any(i in boots for i in key):
                starts[c][key] += 1
                start_wins[c][key] += w
    out = {}
    for c, cnt in sorted(starts.items(), key=lambda kv: int(kv[0])):
        kept = [[list(k), n, start_wins[c][k]] for k, n in cnt.most_common(TOP) if n >= MIN_PLAYERS]
        if kept:
            out[c] = {"players": players[c], "wins": wins[c], "starts": kept}
    with open(OUT, "w") as f:
        json.dump({"note": "Boot starts of the other players in the owner's archived Mayhem lobbies: per champion, players and wins, and [items, players, wins] per start. Built by boot_starts.py.",
                   "champions": out}, f, separators=(",", ":"))
        f.write("\n")
    print(f"{sum(len(v['starts']) for v in out.values())} boot starts for {len(out)} champions -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "deeparam-pc", "archive"))
