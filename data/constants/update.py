#!/usr/bin/env python3
"""Refresh Riot's official game constants (queues, maps, game modes, game types,
seasons) from the developer portal, and write the compact name tables the My Stats
dashboard reads (dashboard/constants.json).

    python3 data/constants/update.py
"""

import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
SOURCE = "https://static.developer.riotgames.com/docs/lol/{}.json"
FILES = ["queues", "maps", "gameModes", "gameTypes", "seasons"]
HOWLING_ABYSS = 12


def fetch(name):
    with urllib.request.urlopen(SOURCE.format(name), timeout=30) as r:
        return json.load(r)


def queue_names(queues, maps):
    """{queueId: name} for every queue played on the Howling Abyss, for the dashboard's queue filter."""
    abyss = next(m["mapName"] for m in maps if m["mapId"] == HOWLING_ABYSS)
    out = {}
    for q in queues:
        if q.get("map") == abyss and q.get("description"):
            name = q["description"].replace("5v5 ", "").replace(" games", "")
            out[str(q["queueId"])] = name.replace("ARAM: Mayhem", "ARAM Mayhem")
    return out


def main():
    data = {n: fetch(n) for n in FILES}
    for name, rows in data.items():
        with open(os.path.join(HERE, name + ".json"), "w") as f:
            json.dump(rows, f, indent=1, ensure_ascii=False)
            f.write("\n")
    names = {"queues": queue_names(data["queues"], data["maps"]),
             "maps": {str(m["mapId"]): m["mapName"] for m in data["maps"]}}
    with open(os.path.join(ROOT, "dashboard", "constants.json"), "w") as f:
        json.dump(names, f, indent=1, sort_keys=True)
        f.write("\n")
    print("updated", ", ".join(FILES))


if __name__ == "__main__":
    main()
