#!/usr/bin/env python3
"""TEMPORARY: fill Mayhem summoner spells and game counts from ARAMKit (China-server games).

Tencent's open feeds (data/cn) have no summoner spells and no game counts. Until a direct
Tencent source turns up, Nico allowed (2026-10-18) filling just those two from a third-party
site. Everything lives in data/fill/ and web/src/lib/fill.ts so it comes out in one step.

Polite by design: does nothing while config.json has "enabled": false, reads versions.json first
and stops when ARAMKit hasn't published a new build since the last run, waits between requests,
and keeps only spells and counts (no other ARAMKit numbers are stored).

Writes data/fill/spells_games.json:
  {patch, data_date, build, fetched, total_games,
   champions: {"<champion id>": {games, spells: [{ids: [a, b], games, pick_rate, win_rate}]}}}

Usage: python3 data/fill/fetch_fill.py [--force]   (standard library only)
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.request

BASE = "https://data.aramkit.com"
HEADERS = {"User-Agent": "deeparam.com daily refresh (admin@deeparam.com)", "Accept": "application/json"}
OUT = os.path.dirname(os.path.abspath(__file__))
DELAY = 2.0  # seconds between requests
SPELL_ROWS = 6


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def load(name, default):
    try:
        with open(os.path.join(OUT, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="refetch even if the build hasn't changed")
    args = ap.parse_args()

    if not load("config.json", {}).get("enabled"):
        print("data/fill is switched off (config.json); nothing fetched")
        return 0

    versions = get("data/versions.json")
    latest = next((v for v in versions.get("versions", []) if v.get("version") == versions.get("latest")), None)
    if not latest:
        print("no latest version listed", file=sys.stderr)
        return 1
    prev = load("spells_games.json", {})
    if prev.get("build") == latest["dataPath"] and not args.force:
        print(f"unchanged ({latest['dataPath']}); nothing fetched")
        return 0

    stats = f"{latest['dataPath']}/stats/all"
    time.sleep(DELAY)
    ranking = get(f"{stats}/champion-rankings.json").get("rows", [])
    champs = {}
    for row in ranking:
        cid = int(row["id"])
        time.sleep(DELAY)
        try:
            detail = get(f"{stats}/champion-details/{cid}.json")
        except Exception as e:  # one missing champion shouldn't sink the rest
            print(f"champion {cid}: {e}", file=sys.stderr)
            detail = {}
        spells = sorted(detail.get("summoners") or [], key=lambda s: -s.get("sampleCount", 0))[:SPELL_ROWS]
        champs[str(cid)] = {
            "games": int(row.get("sampleCount") or 0),
            "spells": [
                {
                    "ids": sorted(int(s["id"]) for s in sp["spells"]),
                    "games": int(sp.get("sampleCount") or 0),
                    "pick_rate": sp.get("pickRate"),
                    "win_rate": sp.get("winRate"),
                }
                for sp in spells
                if len(sp.get("spells") or []) == 2
            ],
        }

    out = {
        "patch": latest["version"],
        "data_date": latest.get("dataDate"),
        "build": latest["dataPath"],
        "fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_games": int(latest.get("allMatches") or 0),
        "champions": champs,
    }
    with open(os.path.join(OUT, "spells_games.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"patch {out['patch']}: {len(champs)} champions, {out['total_games']:,} games")
    return 0


if __name__ == "__main__":
    sys.exit(main())
