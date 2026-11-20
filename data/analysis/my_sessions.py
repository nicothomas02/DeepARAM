"""When the archive's owner wins: sessions, streaks, time of day, and learning a champion. Private; rates only.

Only the owner's own game list can show these (the public feed has no sessions). From the start times:

  session      games less than 30 minutes apart (end to next start) form one sitting; win rate by game number in
               the sitting and by sitting length
  streaks      win rate after 1, 2, 3+ straight losses or wins
  clock        win rate by local hour band and by weekday (times as the archive stores them, UTC unless --tz-hours)
  learning     win rate by how many times the owner had played that champion before (1st, 2nd-3rd, 4th-10th, 11th+)
  length       win rate by game length

    python data/analysis/my_sessions.py <archive.json> [--tz-hours -5] [--json out.json]
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math

REMAKE_SECONDS = 300
GAP_MS = 30 * 60_000
MIN_N = 30


def rate(wins):
    n = len(wins)
    if not n:
        return {"n": 0}
    p = sum(wins) / n
    h = 1.96 * math.sqrt(p * (1 - p) / n)
    return {"n": n, "win_rate": round(p, 3), "ci": [round(p - h, 3), round(p + h, 3)],
            **({"few_games": True} if n < MIN_N else {})}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--tz-hours", type=float, default=0)
    ap.add_argument("--json")
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    owner = data.get("puuid") if isinstance(data, dict) else None
    if not owner:
        c = collections.Counter((pi.get("player") or {}).get("puuid") for g in games for pi in g.get("participantIdentities") or [])
        c.pop(None, None)
        owner = c.most_common(1)[0][0]

    rows = []
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        me = next((pi["participantId"] for pi in g.get("participantIdentities") or []
                   if (pi.get("player") or {}).get("puuid") == owner), None)
        p = next((x for x in g.get("participants") or [] if x["participantId"] == me), None)
        if not p or not g.get("gameCreation"):
            continue
        rows.append({"start": g["gameCreation"], "end": g["gameCreation"] + dur * 1000, "remake": dur < REMAKE_SECONDS,
                     "win": 1 if p["stats"].get("win") else 0, "champ": p.get("championId"), "minutes": dur / 60})
    rows.sort(key=lambda r: r["start"])

    # Sessions (remakes count for the sitting but not for rates).
    sessions, cur = [], []
    for r in rows:
        if cur and r["start"] - cur[-1]["end"] > GAP_MS:
            sessions.append(cur)
            cur = []
        cur.append(r)
    if cur:
        sessions.append(cur)
    by_index, by_len = collections.defaultdict(list), collections.defaultdict(list)
    for s in sessions:
        played = [r for r in s if not r["remake"]]
        for i, r in enumerate(played, 1):
            by_index["1" if i == 1 else "2-3" if i <= 3 else "4-6" if i <= 6 else "7-10" if i <= 10 else "11+"].append(r["win"])
        if played:
            by_len["1-2 games" if len(played) <= 2 else "3-5" if len(played) <= 5 else "6-9" if len(played) <= 9 else "10+"] \
                += [r["win"] for r in played]

    played = [r for r in rows if not r["remake"]]
    streak = collections.defaultdict(list)
    run_kind, run = None, 0
    for r in played:
        if run_kind is not None:
            streak[f"after_{min(run, 3)}{'+' if run >= 3 else ''}_{'wins' if run_kind else 'losses'}"].append(r["win"])
        if r["win"] == run_kind:
            run += 1
        else:
            run_kind, run = r["win"], 1

    clock, weekday = collections.defaultdict(list), collections.defaultdict(list)
    tz = dt.timezone(dt.timedelta(hours=args.tz_hours))
    for r in played:
        t = dt.datetime.fromtimestamp(r["start"] / 1000, tz)
        clock[f"{t.hour // 3 * 3:02d}-{t.hour // 3 * 3 + 3:02d}h"].append(r["win"])
        weekday[t.strftime("%a")].append(r["win"])

    seen = collections.Counter()
    learning = collections.defaultdict(list)
    for r in played:
        k = seen[r["champ"]]
        learning["1st game" if k == 0 else "2nd-3rd" if k <= 2 else "4th-10th" if k <= 9 else "11th+"].append(r["win"])
        seen[r["champ"]] += 1

    length = collections.defaultdict(list)
    for r in played:
        m = r["minutes"]
        length["<15 min" if m < 15 else "15-20" if m < 20 else "20-25" if m < 25 else "25+"].append(r["win"])

    out = {
        "games": len(played), "remakes": len(rows) - len(played), "sessions": len(sessions),
        "by_game_number_in_session": {k: rate(v) for k, v in sorted(by_index.items())},
        "by_session_length": {k: rate(v) for k, v in sorted(by_len.items())},
        "after_streak": {k: rate(v) for k, v in sorted(streak.items())},
        "by_hour": {k: rate(v) for k, v in sorted(clock.items())},
        "by_weekday": {k: rate(v) for k, v in weekday.items()},
        "by_times_played_champion_before": {k: rate(v) for k, v in learning.items()},
        "by_game_length": {k: rate(v) for k, v in sorted(length.items())},
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
