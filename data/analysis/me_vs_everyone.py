"""How the archive's owner plays compared with everyone else in the same games, and which playstyles the owner wins
with more than other players do. Counts and rates only; private (the owner's own archive and timeline cache).

Comparing with the other nine players of the owner's own games keeps the lobby the same (same patches, same skill
band). For each player row it measures:

  per game   kills, deaths, assists per 10 min, kill participation, share of the team's champion damage, damage
             taken and healing, gold per minute, game length, win
  timeline   first legendary finished (minute), share of deaths "caught" (no damage dealt back worth half of what was
             taken and no kill joined within 10 s), deaths ahead of the team (1,500+ map units), boots never bought
  champion   Riot class and subclass (champions/tags.json)

and reports: the owner's average against everyone else's; the owner's win rate by class, subclass and by playstyle
buckets (damage share, kill participation, deaths, tank share) next to everyone else's in the same bucket, so a
bucket where the owner wins more than others do is a style to lean into. Buckets with fewer than MIN_N owner games are
marked few_games.

    python data/analysis/me_vs_everyone.py <archive.json> --tags champions/tags.json [--json out.json]
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import math
import os
import statistics as st

REMAKE_SECONDS = 300
MIN_N = 30
BOOTS = {2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158}
FORWARD = 1500


def norm(i):
    i = int(i or 0)
    return i % 10000 if i >= 100000 else i


def cached(game_id):
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    try:
        with gzip.open(os.path.join(base, "Mayhem Stats", "timelines", f"{game_id}.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def dmg(entries):
    return sum((e.get("physicalDamage") or 0) + (e.get("magicDamage") or 0) + (e.get("trueDamage") or 0)
               for e in entries or [])


def timeline_rows(tl, team):
    """{participantId: {first_item, deaths, caught, forward, boots}} from one timeline."""
    frames = tl.get("frames") or []
    events = [e for f in frames for e in f.get("events") or []]
    kills = [e for e in events if e.get("type") == "CHAMPION_KILL"]
    out = collections.defaultdict(lambda: {"first_item": None, "deaths": 0, "caught": 0, "forward": 0, "boots": False})
    for e in events:
        pid = e.get("participantId")
        if e.get("type") == "ITEM_PURCHASED" and pid:
            if norm(e.get("itemId")) in BOOTS:
                out[pid]["boots"] = True
    # first legendary: the first purchase of an item that costs 2,500+ is not in the timeline; use the archive's
    # completed items instead: the first purchase of any of the player's final non-boots items with id >= 3000
    for k in kills:
        v, t = k.get("victimId"), k.get("timestamp") or 0
        r = out[v]
        r["deaths"] += 1
        received, dealt = dmg(k.get("victimDamageReceived")), dmg(k.get("victimDamageDealt"))
        joined = any(o is not k and abs((o.get("timestamp") or 0) - t) <= 10_000 and
                     (o.get("killerId") == v or v in (o.get("assistingParticipantIds") or [])) for o in kills)
        if not joined and not (received and dealt >= 0.5 * received):
            r["caught"] += 1
        minute = max(0, min(len(frames) - 1, int(round(t / 60000))))
        pfs = frames[minute].get("participantFrames") or {} if frames else {}

        def progress(pos, tm):
            d = ((pos.get("x") or 0) + (pos.get("y") or 0)) / 2
            return d if tm == 100 else 13000 - d
        mates = [progress(pf.get("position") or {}, team.get(v)) for q, pf in pfs.items()
                 if str(q).isdigit() and int(q) != v and team.get(int(q)) == team.get(v) and pf.get("position")]
        if mates and k.get("position") and progress(k["position"], team.get(v)) - st.mean(mates) > FORWARD:
            r["forward"] += 1
    return out, events


def first_legendary_minute(events, pid, final_items):
    finals = {norm(i) for i in final_items if norm(i) >= 3000 and norm(i) not in BOOTS}
    times = [e.get("timestamp") or 0 for e in events
             if e.get("type") == "ITEM_PURCHASED" and e.get("participantId") == pid and norm(e.get("itemId")) in finals]
    return round(min(times) / 60000, 1) if times else None


def rows_of(games, owner):
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        me = next((pi["participantId"] for pi in g.get("participantIdentities") or []
                   if (pi.get("player") or {}).get("puuid") == owner), None)
        if me is None:
            continue
        parts = g.get("participants") or []
        team = {p["participantId"]: p["teamId"] for p in parts}
        tk = collections.Counter()
        tdmg = collections.Counter()
        ttaken = collections.Counter()
        for p in parts:
            s = p["stats"]
            tk[p["teamId"]] += s.get("kills", 0)
            tdmg[p["teamId"]] += s.get("totalDamageDealtToChampions", 0)
            ttaken[p["teamId"]] += s.get("totalDamageTaken", 0)
        tl = cached(g.get("gameId"))
        tlr, events = timeline_rows(tl, team) if tl else ({}, [])
        m10 = dur / 600
        for p in parts:
            s, pid, t = p["stats"], p["participantId"], p["teamId"]
            r = tlr.get(pid) if tl else None
            yield {
                "me": pid == me, "champ": p.get("championId"), "win": bool(s.get("win")), "minutes": dur / 60,
                "kills10": s.get("kills", 0) / m10, "deaths10": s.get("deaths", 0) / m10, "assists10": s.get("assists", 0) / m10,
                "kp": (s.get("kills", 0) + s.get("assists", 0)) / tk[t] if tk[t] else 0,
                "dmg_share": s.get("totalDamageDealtToChampions", 0) / tdmg[t] if tdmg[t] else 0,
                "tank_share": s.get("totalDamageTaken", 0) / ttaken[t] if ttaken[t] else 0,
                "heal10": s.get("totalHeal", 0) / m10, "gold_min": s.get("goldEarned", 0) / (dur / 60),
                "cc10": s.get("timeCCingOthers", 0) / m10,
                **({"caught": r["caught"] / r["deaths"] if r["deaths"] else 0,
                    "forward": r["forward"] / r["deaths"] if r["deaths"] else 0,
                    "no_boots": not r["boots"],
                    "first_item": first_legendary_minute(events, pid, [s.get(f"item{i}") for i in range(7)])} if r else {}),
            }


METRICS = ("win", "kills10", "deaths10", "assists10", "kp", "dmg_share", "tank_share", "heal10", "gold_min", "cc10",
           "minutes", "caught", "forward", "no_boots", "first_item")


def mean(rows, k):
    vals = [float(r[k]) for r in rows if r.get(k) is not None]
    return round(st.mean(vals), 3) if vals else None


def wr(rows):
    if not rows:
        return {"n": 0}
    p = sum(r["win"] for r in rows) / len(rows)
    half = 1.96 * math.sqrt(p * (1 - p) / len(rows))
    return {"n": len(rows), "win_rate": round(p, 3), "ci": [round(p - half, 3), round(p + half, 3)],
            **({"few_games": True} if len(rows) < MIN_N else {})}


def compare(mine, others, key_fn):
    a, b = collections.defaultdict(list), collections.defaultdict(list)
    for r in mine:
        for k in key_fn(r):
            a[k].append(r)
    for r in others:
        for k in key_fn(r):
            b[k].append(r)
    out = {}
    for k in sorted(set(a) | set(b), key=lambda k: -len(a.get(k, []))):
        m, o = wr(a.get(k, [])), wr(b.get(k, []))
        out[k] = {"me": m, "everyone_else": o,
                  **({"edge": round(m["win_rate"] - o["win_rate"], 3)} if m["n"] and o["n"] else {})}
    return out


def tercile_fn(rows, key, labels=("low", "mid", "high")):
    vals = sorted(r[key] for r in rows if r.get(key) is not None)
    if len(vals) < 3:
        return lambda r: []
    lo, hi = vals[len(vals) // 3], vals[2 * len(vals) // 3]
    return lambda r: [] if r.get(key) is None else [labels[0] if r[key] < lo else labels[1] if r[key] < hi else labels[2]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
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
    with open(args.tags, encoding="utf-8") as f:
        tags = {v["id"]: v for v in json.load(f)["champions"].values()}
    rows = list(rows_of(games, owner))
    mine = [r for r in rows if r["me"]]
    others = [r for r in rows if not r["me"]]
    cls = lambda r: (tags.get(r["champ"]) or {}).get("classes") or ["?"]
    sub = lambda r: (tags.get(r["champ"]) or {}).get("subclasses") or ["?"]
    out = {
        "my_games": len(mine), "other_player_rows": len(others),
        "averages": {k: {"me": mean(mine, k), "everyone_else": mean(others, k)} for k in METRICS},
        "by_class": compare(mine, others, cls),
        "by_subclass": compare(mine, others, sub),
        # Buckets cut on everyone's rows, so "high damage share" means the same for the owner and the others.
        **{f"by_{k}": compare(mine, others, tercile_fn(rows, k)) for k in
           ("dmg_share", "kp", "deaths10", "tank_share", "caught", "first_item", "gold_min", "cc10")},
        "most_played": sorted(((tags.get(c, {}).get("name", str(c)), wr([r for r in mine if r["champ"] == c]))
                               for c in {r["champ"] for r in mine}), key=lambda kv: -kv[1]["n"])[:15],
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
