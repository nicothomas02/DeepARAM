#!/usr/bin/env python3
"""Write viewer/replay-data/team-pairs.json: how often two champions play on the same team in Mayhem.

The teamfight page starts both teams as the most commonly seen lineups, grown from these pairs (the
champions most often played together). Each pair is [champion key, champion key, share of games]; the
shipped file carries nothing else.

    python3 tools/build_team_pairs.py [--duos ../data/cn/duos.json] [--out viewer/replay-data/team-pairs.json]
"""
import argparse
import json
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duos", default=SIM.parent / "data" / "cn" / "duos.json", type=Path)
    ap.add_argument("--out", default=SIM / "viewer" / "replay-data" / "team-pairs.json", type=Path)
    a = ap.parse_args()
    rows = json.loads(a.duos.read_text())["duos"]
    pairs = sorted(([*sorted(r["champion_ids"]), round(r["pick_rate"], 5)] for r in rows if len(r["champion_ids"]) == 2),
                   key=lambda p: (-p[2], p[0], p[1]))
    a.out.write_text(json.dumps({"pairs": pairs}, separators=(",", ":")) + "\n")
    print(f"{len(pairs)} pairs -> {a.out}")


if __name__ == "__main__":
    main()
