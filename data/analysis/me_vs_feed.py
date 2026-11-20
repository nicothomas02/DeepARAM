"""The archive owner's games against the public 101.qq.com numbers for the same champion on the same patch.
Private: reads the owner's own archive; prints rates only.

For each of the owner's games it looks up the champion's row for that game's patch in data/cn/history/by_patch.json
(the 101.qq.com feed, all players): win rate, share of the team's damage, share of damage taken, kill participation.
The owner's own value minus the feed's is the owner's edge on that champion, so a champion that wins a lot for
everyone doesn't count as the owner's strength. Reported overall, by Riot class and subclass, and per champion.

    python data/analysis/me_vs_feed.py <archive.json> --feed data/cn/history/by_patch.json --tags champions/tags.json
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import statistics as st

REMAKE_SECONDS = 300
MIN_N = 10


def patch_key(version, known):
    parts = str(version or "").split(".")
    if len(parts) < 2:
        return None
    major, minor = int(parts[0]), int(parts[1])
    # The client says 16.x where the feed may say 26.x or 16.x; take the latest feed patch at or before this one.
    cands = [p for p in known if tuple(map(int, p.split("."))) <= (major, minor)]
    return max(cands, key=lambda p: tuple(map(int, p.split(".")))) if cands else None


def summary(rows):
    if not rows:
        return {"n": 0}
    n = len(rows)
    edge = [r["win"] - r["exp_win"] for r in rows]
    se = math.sqrt(sum(r["exp_win"] * (1 - r["exp_win"]) for r in rows)) / n
    out = {"n": n, "win_rate": round(sum(r["win"] for r in rows) / n, 3),
           "feed_win_rate": round(st.mean(r["exp_win"] for r in rows), 3),
           "edge": round(st.mean(edge), 3), "edge_ci": [round(st.mean(edge) - 1.96 * se, 3), round(st.mean(edge) + 1.96 * se, 3)]}
    for k in ("dmg_share", "tank_share", "kp"):
        mine = [r[k] for r in rows if r.get(k) is not None]
        feed = [r["feed_" + k] for r in rows if r.get("feed_" + k) is not None]
        if mine and feed:
            out[k] = {"me": round(st.mean(mine), 3), "feed": round(st.mean(feed), 3)}
    if n < MIN_N:
        out["few_games"] = True
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--feed", required=True)
    ap.add_argument("--tags", required=True)
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
    with open(args.feed, encoding="utf-8") as f:
        feed = json.load(f)["champions"]
    feed = {p: {r["id"]: r for r in rows} for p, rows in feed.items()}
    with open(args.tags, encoding="utf-8") as f:
        tags = {v["id"]: v for v in json.load(f)["champions"].values()}

    rows, unmatched = [], 0
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        me = next((pi["participantId"] for pi in g.get("participantIdentities") or []
                   if (pi.get("player") or {}).get("puuid") == owner), None)
        p = next((x for x in g.get("participants") or [] if x["participantId"] == me), None)
        patch = patch_key(g.get("gameVersion"), feed)
        f_row = (feed.get(patch) or {}).get(p.get("championId")) if p else None
        if not p or not f_row:
            unmatched += 1
            continue
        team = [x for x in g["participants"] if x["teamId"] == p["teamId"]]
        s = p["stats"]
        tk = sum(x["stats"].get("kills", 0) for x in team)
        td = sum(x["stats"].get("totalDamageDealtToChampions", 0) for x in team)
        tt = sum(x["stats"].get("totalDamageTaken", 0) for x in team)
        rows.append({
            "champ": p["championId"], "patch": patch, "win": 1 if s.get("win") else 0, "exp_win": f_row["win_rate"],
            "dmg_share": s.get("totalDamageDealtToChampions", 0) / td if td else None,
            "tank_share": s.get("totalDamageTaken", 0) / tt if tt else None,
            "kp": (s.get("kills", 0) + s.get("assists", 0)) / tk if tk else None,
            "feed_dmg_share": f_row.get("avg_damage_ratio"), "feed_tank_share": f_row.get("avg_tank_ratio"),
            "feed_kp": f_row.get("avg_participation_rate"),
        })

    def group(key):
        g = collections.defaultdict(list)
        for r in rows:
            for k in key(r):
                g[k].append(r)
        return {k: summary(v) for k, v in sorted(g.items(), key=lambda kv: -len(kv[1]))}

    name = lambda r: [(tags.get(r["champ"]) or {}).get("name", str(r["champ"]))]
    per_champ = {k: v for k, v in group(name).items() if v["n"] >= MIN_N}
    ranked = sorted(per_champ.items(), key=lambda kv: -kv[1]["edge"])
    out = {
        "games_matched": len(rows), "games_without_feed_row": unmatched,
        "overall": summary(rows),
        "by_class": group(lambda r: (tags.get(r["champ"]) or {}).get("classes") or ["?"]),
        "by_subclass": group(lambda r: (tags.get(r["champ"]) or {}).get("subclasses") or ["?"]),
        "champions_best_edge": dict(ranked[:12]),
        "champions_worst_edge": dict(ranked[-12:]),
        "by_patch": group(lambda r: [r["patch"]]),
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
