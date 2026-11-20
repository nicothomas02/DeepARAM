"""What kills the archive's owner: abilities and champions behind the owner's deaths, from the cached timelines.

Every CHAMPION_KILL in a timeline lists the damage its victim took in that fight (victimDamageReceived: who, which
spell or slot, physical / magic / true). For the owner's own deaths this adds it up by ability and by enemy
champion: total damage, deaths it took part in, average per death, and how often it was the biggest hit of the death.
Also counts how many of the owner's games each archive holds, so it's clear which games are covered.

    python data/analysis/my_deaths.py <archive.json> [<other archive.json> ...] [--top 20] [--json out.json]

Reads the timeline cache timeline_signals.py keeps (%APPDATA%/Mayhem Stats/timelines); nothing is downloaded.
Only the owner's own deaths are read; other players appear as champions, never by name.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import gzip
import json
import os


def cached(game_id):
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    try:
        with gzip.open(os.path.join(base, "Mayhem Stats", "timelines", f"{game_id}.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def load(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    owner = data.get("puuid") if isinstance(data, dict) else None
    if not owner:
        counts = collections.Counter(pi.get("player", {}).get("puuid") for g in games
                                     for pi in g.get("participantIdentities") or [])
        counts.pop(None, None)
        owner = counts.most_common(1)[0][0] if counts else None
    return games, owner


def day(ms):
    return dt.datetime.fromtimestamp((ms or 0) / 1000, dt.timezone.utc).date().isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archives", nargs="+")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--json")
    args = ap.parse_args()

    games, owner, coverage = {}, None, {}
    for path in args.archives:
        gs, own = load(path)
        owner = owner or own
        ids = [g["gameId"] for g in gs if g.get("gameId")]
        coverage[os.path.basename(path)] = {"games": len(ids), "first": day(min((g.get("gameCreation") or 0) for g in gs) if gs else 0),
                                            "last": day(max((g.get("gameCreation") or 0) for g in gs) if gs else 0)}
        for g in gs:
            if g.get("gameId"):
                games[g["gameId"]] = g

    by_spell = collections.defaultdict(lambda: {"damage": 0.0, "deaths": 0, "top_hit": 0, "physical": 0.0, "magic": 0.0, "true": 0.0})
    by_champ = collections.defaultdict(lambda: {"damage": 0.0, "deaths": 0, "kills": 0})
    deaths = with_timeline = 0
    total = {"physical": 0.0, "magic": 0.0, "true": 0.0}
    for gid, g in games.items():
        me = next((pi["participantId"] for pi in g.get("participantIdentities") or []
                   if pi.get("player", {}).get("puuid") == owner), None)
        tl = cached(gid)
        if me is None or not tl:
            continue
        with_timeline += 1
        champ_of = {p["participantId"]: p.get("championId") for p in g.get("participants") or []}
        for f in tl.get("frames") or []:
            for e in f.get("events") or []:
                if e.get("type") != "CHAMPION_KILL" or e.get("victimId") != me:
                    continue
                deaths += 1
                if e.get("killerId") in champ_of:
                    by_champ[champ_of[e["killerId"]]]["kills"] += 1
                hits = e.get("victimDamageReceived") or []
                seen_spell, seen_champ = set(), set()
                biggest, biggest_dmg = None, -1
                for h in hits:
                    phys, mag, tru = h.get("physicalDamage") or 0, h.get("magicDamage") or 0, h.get("trueDamage") or 0
                    dmg = phys + mag + tru
                    who = h.get("name") or "?"
                    spell = f"{who} {h.get('spellName') or '?'}" + (" (auto attack)" if h.get("basic") else "")
                    s = by_spell[spell]
                    s["damage"] += dmg
                    s["physical"] += phys
                    s["magic"] += mag
                    s["true"] += tru
                    total["physical"] += phys
                    total["magic"] += mag
                    total["true"] += tru
                    if spell not in seen_spell:
                        s["deaths"] += 1
                        seen_spell.add(spell)
                    pid = h.get("participantId")
                    if pid in champ_of:
                        c = by_champ[champ_of[pid]]
                        c["damage"] += dmg
                        if pid not in seen_champ:
                            c["deaths"] += 1
                            seen_champ.add(pid)
                    if dmg > biggest_dmg:
                        biggest, biggest_dmg = spell, dmg
                if biggest:
                    by_spell[biggest]["top_hit"] += 1

    def table(d, key):
        rows = sorted(d.items(), key=lambda kv: -kv[1][key])[: args.top]
        return [{"name": k, **{kk: round(v, 0) if isinstance(v, float) else v for kk, v in r.items()},
                 "avg_per_death": round(r["damage"] / max(1, r["deaths"]))} for k, r in rows]

    t = sum(total.values()) or 1
    out = {
        "archives": coverage, "unique_games": len(games), "games_with_timeline": with_timeline, "my_deaths": deaths,
        "death_damage_mix": {k: round(v / t, 3) for k, v in total.items()},
        "abilities_by_total_damage": table(by_spell, "damage"),
        "abilities_by_deaths_involved": table(by_spell, "deaths"),
        "abilities_by_biggest_hit": table(by_spell, "top_hit"),
        "champions_by_damage_in_my_deaths": table(by_champ, "damage"),
        "champions_by_kills_on_me": table(by_champ, "kills"),
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
