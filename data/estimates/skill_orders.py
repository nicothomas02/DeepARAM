#!/usr/bin/env python3
"""Skill orders per champion and per build style (skill_orders.json), from real level-ups.

The daily feed's skill orders are one generic list for every champion (Ezreal's W>E>Q "wins" as often as his
Q>E>W), so Nico chose on 2026-11-24 to use the level-ups of the OTHER nine players in his archived Mayhem lobbies
instead (his own games are left out; champion review, reviews/champion-review-tracker.md G1). Shown as estimated.

Max order: the order in which Q, W and E reach their most ranks. An ability counts as maxed when its level-up
events reach the most any player of that champion put into it, so an ability that starts with a free rank (Zeri's
Q) is maxed one event early. Only NORMAL level-ups; players who maxed fewer than two abilities are left out.
Build style: the style of the player's final legendary items (build_archetypes.style_of), so Ashe's attack-speed
build and her AP build get their own orders. levels = the most common first 15 level-ups for that max order.

The archive lives in the private owner repo (DeepARAM-PC/archive: games/<id>.json.gz and timelines/<id>.json.gz);
only these aggregate counts are written here. Rerun after the archive grows:

    python3 data/estimates/skill_orders.py /path/to/DeepARAM-PC/archive

Standard library only.
"""

import collections
import datetime as dt
import gzip
import json
import os
import sys

import build_archetypes as ba
import common as cm

OUT = os.path.join(cm.HERE, "skill_orders.json")
LEVELS = 15


def owner_of(gdir):
    """The archive's owner: the one player in every archived game (no account id kept in this public repo)."""
    seen = collections.Counter()
    for f in os.listdir(gdir):
        try:
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        seen.update({p["player"].get("puuid") for p in g["participantIdentities"]} - {None})
    return seen.most_common(1)[0][0] if seen else None


def players(archive):
    names = {v: k for k, v in json.load(open(os.path.join(cm.REPO, "web", "src", "data", "champion-ids.json"))).items()}
    styles = ba.item_styles()
    games = timelines = 0
    out = []
    tdir, gdir = os.path.join(archive, "timelines"), os.path.join(archive, "games")
    me = owner_of(gdir)
    for f in sorted(os.listdir(tdir)):
        try:
            t = json.load(gzip.open(os.path.join(tdir, f)))
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        games += 1
        owner = {p["participantId"] for p in g["participantIdentities"] if p["player"].get("puuid") == me}
        info = {}
        for p in g["participants"]:
            items = [p["stats"].get(f"item{i}", 0) for i in range(6)]
            items = [i for i in items if i and styles.get(i)]
            info[p["participantId"]] = (p["championId"], bool(p["stats"]["win"]), ba.style_of(items, styles) if items else None)
        seq = collections.defaultdict(list)
        for fr in t.get("frames") or []:
            for e in fr.get("events") or []:
                if e.get("type") == "SKILL_LEVEL_UP" and e.get("levelUpType") == "NORMAL" and 1 <= e.get("skillSlot", 0) <= 4:
                    seq[e["participantId"]].append("QWER"[e["skillSlot"] - 1])
        if seq:
            timelines += 1
        for pid, s in seq.items():
            if pid in owner or pid not in info or info[pid][0] not in names:
                continue
            out.append((info[pid][0], info[pid][1], info[pid][2], s))
    return out, games


def build(archive):
    rows, games = players(archive)
    cap = collections.defaultdict(collections.Counter)
    for c, _, _, s in rows:
        for k in "QWE":
            cap[c][k] = max(cap[c][k], s.count(k))
    # champion -> group ("all" or a style) -> max order -> [players, wins, Counter(levels)]
    agg = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, collections.Counter()])))
    for c, win, style, s in rows:
        count, order = collections.Counter(), []
        for k in s:
            if k == "R":
                continue
            count[k] += 1
            if count[k] == cap[c][k] and k not in order:
                order.append(k)
        if len(order) < 2:
            continue
        key = "".join(order + [k for k in "QWE" if k not in order])
        for group in ("all", style) if style else ("all",):
            r = agg[c][group][key]
            r[0] += 1
            r[1] += win
            if len(s) >= LEVELS:
                r[2]["".join(s[:LEVELS])] += 1
    champions = {}
    for c, groups in agg.items():
        def rows_of(m):
            return [{"max": k, "games": v[0], "wins": v[1], "levels": v[2].most_common(1)[0][0] if v[2] else ""}
                    for k, v in sorted(m.items(), key=lambda kv: -kv[1][0])]
        champions[str(c)] = {"all": rows_of(groups["all"]),
                             "styles": {st: rows_of(m) for st, m in sorted(groups.items()) if st != "all"}}
    return {"note": "Skill max orders of the other players in the owner's archived Mayhem lobbies (owner left out), per "
                    "champion and per build style. games = players, wins = their wins. Built by skill_orders.py.",
            "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "games": games,
            "champions": champions}


if __name__ == "__main__":
    archive = sys.argv[1] if len(sys.argv) > 1 else os.path.join(cm.REPO, "..", "deeparam-pc", "archive")
    data = build(archive)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(data['champions'])} champions from {data['games']} games -> {OUT}")
