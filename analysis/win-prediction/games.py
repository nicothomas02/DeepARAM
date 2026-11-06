"""Turns ARAM Mayhem game records into an anonymous draft table for the win-prediction model.

Two inputs are understood:
  * a Mayhem Stats helper archive (the client's match-history JSON, `--out` of importer/mayhem_import.py), and
  * rows of the opt-in shared-games pool (already anonymised by the helper before upload).

Every game becomes one row with only what a draft shows plus the result: patch, date, length, the five champions
on each side, each side's augments, and whether blue won. No game ids, account ids, names or per-player stats are
kept, so the table can't be tied back to a player. It still is personal history, so it is written to a local file
outside git (see DEFAULT_OUT) and never committed. Only aggregate results go in the notebook.

Standard library only, so the repo's test job can check it without installing anything.

    python3 analysis/win-prediction/games.py ARCHIVE.json [POOL.json ...] [-o OUT.json]
"""
import argparse
import hashlib
import json
import os
import sys

MAYHEM_QUEUES = {2400}  # ARAM Mayhem (data/constants/queues.json); 2450 is a one-off event queue
BLUE, RED = 100, 200
MIN_SECONDS = 300  # shorter games are remakes or early surrenders, not decided by the draft
DEFAULT_OUT = os.path.expanduser("~/.cache/deeparam-winmodel/games.json")


def _date(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def _side_win(teams, players, side):
    for t in teams or []:
        if t.get("teamId", t.get("id")) == side and "win" in t:
            return t["win"] in ("Win", True)
    for p in players:
        if p["team"] == side:
            return p["win"]
    return None


def _finish(patch, date, duration, players, teams):
    """One draft row, or None when the game isn't a complete 5v5 with a result, or was a remake."""
    blue = sorted((p for p in players if p["team"] == BLUE), key=lambda p: p["champ"])
    red = sorted((p for p in players if p["team"] == RED), key=lambda p: p["champ"])
    if len(blue) != 5 or len(red) != 5 or not all(p["champ"] for p in blue + red):
        return None
    win = _side_win(teams, players, BLUE)
    if win is None or int(duration or 0) < MIN_SECONDS:
        return None
    return {
        "patch": patch, "date": date, "duration": int(duration or 0),
        "blue": [p["champ"] for p in blue], "red": [p["champ"] for p in red],
        "blue_augs": [list(p["augs"]) for p in blue], "red_augs": [list(p["augs"]) for p in red],
        "blue_win": bool(win),
    }


def from_client(game):
    """A game in the client's match-history shape (what the helper archive keeps)."""
    if game.get("queueId") not in MAYHEM_QUEUES:
        return None
    version = str(game.get("gameVersion") or "").split(".")
    if len(version) < 2 or not game.get("gameCreation"):
        return None
    players = []
    for p in game.get("participants") or []:
        s = p.get("stats") or {}
        players.append({"team": p.get("teamId"), "champ": p.get("championId"), "win": bool(s.get("win")),
                        "augs": [s[f"playerAugment{i}"] for i in range(1, 7) if s.get(f"playerAugment{i}")]})
    duration = game.get("gameDuration") or 0
    if duration > 10_000:  # some client versions report milliseconds
        duration //= 1000
    return _finish(".".join(version[:2]), _date(game["gameCreation"]), duration, players, game.get("teams"))


def from_pool(row):
    """A shared-pool row: the D1 row ({..., "data": "<json>"}) or its decoded data."""
    data = row.get("data", row)
    if isinstance(data, str):
        data = json.loads(data)
    if data.get("queue") not in MAYHEM_QUEUES:
        return None
    players = [{"team": p.get("team"), "champ": p.get("champ"), "win": bool(p.get("win")), "augs": p.get("augs") or []}
               for p in data.get("players") or []]
    return _finish(data.get("patch"), data.get("played"), data.get("duration"), players, data.get("teams"))


def fingerprint(g):
    """Same game seen twice (archive and pool): same day, length and champions on each side."""
    raw = f'{g["date"]}|{g["duration"]}|{",".join(map(str, g["blue"]))}|{",".join(map(str, g["red"]))}'
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def load(path):
    """Draft rows from one file, whichever of the two shapes it has."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        for key in ("games", "matches", "data", "results"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if isinstance(data, list) and data and isinstance(data[0], dict) and "results" in data[0]:
        data = [r for chunk in data for r in chunk["results"]]  # raw D1 query output
    rows = []
    for item in data if isinstance(data, list) else []:
        g = from_client(item) if "participants" in item else from_pool(item)
        if g:
            rows.append(g)
    return rows


def merge(*sources):
    """All rows, each game once, oldest first."""
    seen, out = set(), []
    for rows in sources:
        for g in rows:
            k = fingerprint(g)
            if k not in seen:
                seen.add(k)
                out.append(g)
    out.sort(key=lambda g: (g["date"], g["duration"]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("inputs", nargs="+", help="helper archives and/or shared-pool exports (JSON)")
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    sources = []
    for path in args.inputs:
        rows = load(path)
        print(f"{path}: {len(rows)} Mayhem games", file=sys.stderr)
        sources.append(rows)
    games = merge(*sources)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(games, f, separators=(",", ":"))
    print(f"{len(games)} games after removing duplicates -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
