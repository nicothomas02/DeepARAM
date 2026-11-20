"""Caught or traded? Every death in the owner's past Mayhem games, from the match-history timelines. Counts only.

death_signals.py showed that dying often goes with losing whatever the kill participation, so kill participation
can't tell "traded my life for kills" from "got caught". The timeline's CHAMPION_KILL events can: each says how
much damage the victim took (victimDamageReceived) and dealt (victimDamageDealt) in that fight, and the frames
before it give the victim's max health. A death is

  traded  the victim dealt at least half as much damage as they took, or took part in a kill within 10 s
          before or after dying;
  caught  otherwise.
  burst   (any death) the damage taken was at least the victim's max health within that fight, from one or
          two enemies.

For each player row (all ten players, no names) it reports win rates by deaths per 10 minutes and by the share
of their deaths that were "caught". Timelines come from the match-history service (League open and signed in);
nothing per game is kept or printed.

    python importer-dir/death_details.py <archive.json> [--json out.json] [--limit N]

Run with the helper's importer folder on the path (it reuses mayhem_import's client and service calls).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "importer"))

REMAKE_SECONDS = 300
TRADE_RATIO = 0.5
KILL_WINDOW_MS = 10_000
DEATH_BINS = [(0, 3, "under 3"), (3, 4.5, "3-4.5"), (4.5, 6, "4.5-6"), (6, 99, "6+")]
CAUGHT_BINS = [(0, 0.34, "under 1/3 caught"), (0.34, 0.67, "1/3-2/3 caught"), (0.67, 1.01, "2/3+ caught")]


def binned(v, bins):
    return next(label for lo, hi, label in bins if lo <= v < hi)


def dmg(entries):
    return sum((e.get("physicalDamage") or 0) + (e.get("magicDamage") or 0) + (e.get("trueDamage") or 0)
               for e in entries or [])


def deaths_in(timeline):
    """[(victim, traded, burst)] for every champion kill, plus each participant's death count."""
    frames = timeline.get("frames") or []
    kills = [e for f in frames for e in f.get("events") or [] if e.get("type") == "CHAMPION_KILL"]
    out = []
    for k in kills:
        v, t = k.get("victimId"), k.get("timestamp") or 0
        minute = min(len(frames) - 1, int(t // 60000))
        pf = (frames[minute].get("participantFrames") or {}).get(str(v)) or {}
        hp_max = (pf.get("championStats") or {}).get("healthMax") or 0
        received, dealt = dmg(k.get("victimDamageReceived")), dmg(k.get("victimDamageDealt"))
        enemies = {e.get("participantId") for e in k.get("victimDamageReceived") or []
                   if 1 <= (e.get("participantId") or 0) <= 10}
        joined = any(abs((o.get("timestamp") or 0) - t) <= KILL_WINDOW_MS and o is not k and
                     (o.get("killerId") == v or v in (o.get("assistingParticipantIds") or [])) for o in kills)
        traded = joined or (received and dealt >= TRADE_RATIO * received)
        burst = bool(hp_max) and received >= hp_max and len(enemies) <= 2
        out.append((v, bool(traded), burst))
    return out


def player_rows(game, timeline):
    dur = game.get("gameDuration") or 0
    if dur > 10_000:
        dur /= 1000
    if dur < REMAKE_SECONDS or not timeline:
        return []
    by = defaultdict(list)
    for v, traded, burst in deaths_in(timeline):
        by[v].append((traded, burst))
    rows = []
    for p in game.get("participants") or []:
        d = by.get(p["participantId"], [])
        if not d:
            continue
        rows.append({"deaths10": len(d) / (dur / 600), "caught": sum(not t for t, _ in d) / len(d),
                     "burst": sum(b for _, b in d) / len(d), "win": bool(p["stats"].get("win")), "n": len(d)})
    return rows


def summarize(group):
    n = len(group)
    if not n:
        return {"n": 0}
    return {"n": n, "win_rate": round(sum(r["win"] for r in group) / n, 3),
            "caught": round(sum(r["caught"] for r in group) / n, 3),
            "burst": round(sum(r["burst"] for r in group) / n, 3)}


def main():
    import mayhem_import as mi
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--json")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    games = [g for g in games if g.get("gameId")]
    if args.limit:
        games = games[-args.limit:]
    lcu = mi.find_client()
    if not lcu:
        sys.exit("League isn't open.")
    puuid = lcu.get("/lol-summoner/v1/current-summoner")["puuid"]
    token = mi.sgp_token(lcu)
    host = mi.find_sgp_host(lcu, puuid, token)

    def fetch(g):
        try:
            return mi.sgp_timeline(host, token, f"{g.get('platformId') or 'NA1'}_{g['gameId']}")
        except Exception:  # noqa: BLE001 - a missing game is just skipped
            return None

    with ThreadPoolExecutor(mi.SGP_WORKERS) as pool:
        timelines = list(pool.map(fetch, games))
    rows, deaths = [], {"all": 0, "traded": 0, "burst": 0}
    for g, tl in zip(games, timelines):
        for v, traded, burst in deaths_in(tl) if tl else []:
            deaths["all"] += 1
            deaths["traded"] += traded
            deaths["burst"] += burst
        rows += player_rows(g, tl)

    grid, by_caught, by_deaths = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in rows:
        d, c = binned(r["deaths10"], DEATH_BINS), binned(r["caught"], CAUGHT_BINS)
        grid[(d, c)].append(r)
        by_caught[c].append(r)
        by_deaths[d].append(r)
    out = {
        "games": len(games), "with_timeline": sum(1 for t in timelines if t), "player_rows": len(rows),
        "deaths": deaths,
        "by_caught_share": {c: summarize(by_caught[c]) for _, _, c in CAUGHT_BINS},
        "by_deaths_per_10min": {d: summarize(by_deaths[d]) for _, _, d in DEATH_BINS},
        "grid": {d: {c: summarize(grid[(d, c)]) for _, _, c in CAUGHT_BINS} for _, _, d in DEATH_BINS},
    }
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
    a = max(1, deaths["all"])
    print(f"{out['games']} games, {out['with_timeline']} with a timeline, {out['player_rows']} player rows who died")
    print(f"{deaths['all']} deaths: {deaths['traded'] / a:.0%} traded, {deaths['burst'] / a:.0%} burst")
    print("\nWin rate by deaths per 10 min x share of deaths that were 'caught' (n in brackets):")
    print(f"{'deaths/10m':>11} | " + " | ".join(f"{c:>17}" for _, _, c in CAUGHT_BINS))
    for _, _, d in DEATH_BINS:
        cells = [(f"{s['win_rate']:.0%} ({s['n']})" if s["n"] else "-").rjust(17)
                 for s in (out["grid"][d][c] for _, _, c in CAUGHT_BINS)]
        print(f"{d:>11} | " + " | ".join(cells))
    print("\nBy caught share:")
    for c, s in out["by_caught_share"].items():
        if s["n"]:
            print(f"  {c:>17}: win {s['win_rate']:.0%}, n {s['n']}, burst share {s['burst']:.0%}")
    print("\nBy deaths per 10 min:")
    for d, s in out["by_deaths_per_10min"].items():
        if s["n"]:
            print(f"  {d:>9}: win {s['win_rate']:.0%}, n {s['n']}, caught {s['caught']:.0%}, burst {s['burst']:.0%}")


if __name__ == "__main__":
    main()
