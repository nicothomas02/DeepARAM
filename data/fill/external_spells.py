#!/usr/bin/env python3
"""Summoner spell pairs per champion from a public Mayhem stats site, for the spell estimate (Nico, 2026-11-20:
spells only, combine his games with outside sites; the Mayhem stats feed has no spells at all).

Writes external_spells.json: {"fetched", "version", "champions": {"<champion id>": [{"ids": [a, b], "games",
"pick_rate", "win_rate"}]}}. build_estimates.py pools these with the model's estimate. The site never names the
source; its spell rows stay labelled Estimated. Standard library only.

Usage: python3 data/fill/external_spells.py
"""

import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "external_spells.json")
PAGE = "https://aramkit.com/en-US/champions/ahri"
DETAILS = "https://data.aramkit.com/data/{version}/stats/all/champion-details/{cid}.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; stats-fetch)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8")


def main():
    html = get(PAGE)
    versions = sorted(set(re.findall(r"data/(\d+\.\d+-\d{8}-[0-9a-f]+)", html)), key=lambda v: v.split("-")[1])
    if not versions:
        print("no data version found", file=sys.stderr)
        return 1
    version = versions[-1]
    ids = json.load(open(os.path.join(HERE, "..", "..", "web", "src", "data", "champion-ids.json"), encoding="utf-8"))
    out = {}
    for cid in sorted(i for i in set(ids.values()) if i < 10000):  # 60000+ ids aren't champions
        try:
            d = json.loads(get(DETAILS.format(version=version, cid=cid)))
        except Exception as e:  # noqa: BLE001 - a champion it lacks is skipped
            print(f"{cid}: {e}", file=sys.stderr)
            continue
        rows = [{"ids": sorted(s["id"] for s in r["spells"]), "games": r.get("sampleCount") or 0,
                 "pick_rate": r.get("pickRate"), "win_rate": r.get("winRate")} for r in d.get("summoners") or []]
        if rows:
            out[str(cid)] = rows
        time.sleep(0.25)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "version": version,
                   "champions": out}, f, separators=(",", ":"))
        f.write("\n")
    print(f"external spells: {len(out)} champions ({version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
