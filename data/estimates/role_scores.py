#!/usr/bin/env python3
"""Which post-game score judges each champion best, checked against public results: role_scores.json.

The archive re-tests (pair_check.py, more to follow) compare a few dozen players who made a choice with those who
didn't. Wins alone are too noisy for that, and no single other stat fits every role (Nico 2026-11-27: "damage and
deaths shouldn't be the only metrics, especially on enchanters"). So each champion gets one of five scores, each the
mean of post-game stats standardised within the champion:

  damage     win, share of the team's damage to champions, deaths per minute (flipped)
  support    win, share of the team's healing, units healed, assists per minute, kill participation,
             share of the team's CC time, deaths (flipped)
  frontline  win, share of the team's damage taken, share of self-mitigated damage, CC share, kill participation,
             deaths (flipped)
  kda        win, (kills + assists) / deaths, kill participation, deaths (flipped)
  bruiser    win, damage share, damage-taken share, KDA, deaths (flipped)

Default by Riot's subclass (champions/classes.py): Enchanter (main or second, e.g. Senna) -> support, Specialist -> bruiser, everyone else ->
damage. A champion switches to another score when its own data clearly says so: at least MIN_CELLS cells and that
score tracks the public results at least MARGIN better than the default.

How "tracks public results" is measured: for each champion x augment and champion x item with >= 5 holders in the
archive and >= 2,000 public games (AramHex 16.19+), the holders' mean score is correlated with the public win-rate
lead of that choice on that champion (weighted by holders).

Validation (research/calibration, 2026-11-27, 4,699 cells): damage-for-all r 0.255; subclass defaults 0.301; Riot-
style grade (KDA, damage, taken, KP, CS, gold, objectives) 0.16 (-0.31 on enchanters). Per-champion switches chosen
on half of each champion's cells and scored on the other half added +0.017 (positive in 30 of 30 splits, margin 0.2,
30+ cells). Profile clusters (k-means on damage / taken / heal / CC shares) added only +0.01, so Riot's subclasses
stay the groups. Wins alone: 0.15.

Usage: python3 data/estimates/role_scores.py /path/to/DeepARAM-PC/archive
Standard library only. Only aggregates are written.
"""

import collections
import gzip
import importlib.util
import json
import math
import os
import sys

import common as cm

OUT = os.path.join(cm.HERE, "role_scores.json")
AH = os.path.join(cm.REPO, "data", "aramhex", "patches")
FIRST_PATCH = (16, 19)
MIN_HOLDERS, MIN_PUBLIC = 5, 2000
MIN_CELLS, MARGIN = 30, 0.2

SCORES = {
    "damage": (("win", 1), ("dmg_share", 1), ("deaths", -1)),
    "support": (("win", 1), ("heal_share", 1), ("units_healed", 1), ("assists", 1), ("kp", 1), ("cc_share", 1), ("deaths", -1)),
    "frontline": (("win", 1), ("taken_share", 1), ("mitig_share", 1), ("cc_share", 1), ("kp", 1), ("deaths", -1)),
    "kda": (("win", 1), ("kda", 1), ("kp", 1), ("deaths", -1)),
    "bruiser": (("win", 1), ("dmg_share", 1), ("taken_share", 1), ("kda", 1), ("deaths", -1)),
}
DEFAULT_BY_SUBCLASS = {"Enchanter": "support", "Specialist": "bruiser"}
STATS = sorted({k for spec in SCORES.values() for k, _ in spec})


def subclasses():
    """{champion id: (main subclass, ...)} from champions/classes.py."""
    spec = importlib.util.spec_from_file_location("champion_classes", os.path.join(cm.REPO, "champions", "classes.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ids = cm.load(os.path.join(cm.REPO, "web", "src", "data", "champion-ids.json"))
    return {int(ids[a]): (s if isinstance(s, tuple) else (s,)) for a, s in mod.SUBCLASS.items() if a in ids}


def default_score(champ, subs):
    """Enchanter anywhere in the subclasses (Senna is Marksman + Enchanter) -> support; else by the main subclass."""
    s = subs.get(champ) or ("",)
    if "Enchanter" in s:
        return "support"
    return DEFAULT_BY_SUBCLASS.get(s[0], "damage")


def player_rows(archive):
    """One row per player per game (remakes left out): champion, augments, items and the stats the scores use."""
    gdir = os.path.join(archive, "games")
    out = []
    for f in sorted(os.listdir(gdir)):
        try:
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        parts = g.get("participants") or []
        if g.get("gameDuration", 0) < 300 or any(p["stats"].get("gameEndedInEarlySurrender") for p in parts):
            continue
        mins = g["gameDuration"] / 60
        team = collections.defaultdict(collections.Counter)
        for p in parts:
            for key in ("totalDamageDealtToChampions", "totalHeal", "timeCCingOthers", "kills", "totalDamageTaken",
                        "damageSelfMitigated"):
                team[p["teamId"]][key] += p["stats"].get(key, 0)
        for p in parts:
            s, tm = p["stats"], team[p["teamId"]]
            share = lambda key: s.get(key, 0) / (tm[key] or 1)
            out.append({"champ": p["championId"], "augs": {s.get(f"playerAugment{i}") for i in range(1, 7)} - {0, None},
                        "items": {s.get(f"item{i}") for i in range(6)} - {0, None},
                        "win": 1 if s.get("win") else 0, "deaths": s.get("deaths", 0) / mins,
                        "dmg_share": share("totalDamageDealtToChampions"), "heal_share": share("totalHeal"),
                        "cc_share": share("timeCCingOthers"), "taken_share": share("totalDamageTaken"),
                        "mitig_share": share("damageSelfMitigated"), "units_healed": s.get("totalUnitsHealed", 0),
                        "assists": s.get("assists", 0) / mins,
                        "kp": (s.get("kills", 0) + s.get("assists", 0)) / (tm["kills"] or 1),
                        "kda": (s.get("kills", 0) + s.get("assists", 0)) / max(1, s.get("deaths", 0))})
    return out


def standardise(rows):
    """Adds <stat>_z to each row, standardised within its champion."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r["champ"]].append(r)
    for rs in by.values():
        for key in STATS:
            m = sum(r[key] for r in rs) / len(rs)
            sd = math.sqrt(sum((r[key] - m) ** 2 for r in rs) / max(1, len(rs) - 1)) or 1
            for r in rs:
                r[key + "_z"] = (r[key] - m) / sd


def score(r, name):
    spec = SCORES[name]
    return sum(sign * r[key + "_z"] for key, sign in spec) / len(spec)


def public_leads():
    """{(champion, 'aug'|'item', id): win-rate lead over the champion's average} from AramHex 16.19+, pooled."""
    hero = collections.defaultdict(lambda: [0, 0])
    cells = collections.defaultdict(lambda: [0, 0])
    for p in sorted(os.listdir(AH)):
        try:
            if tuple(map(int, p.split("."))) < FIRST_PATCH:
                continue
        except ValueError:
            continue
        d = os.path.join(AH, p)
        for c, (n, w) in cm.load(os.path.join(d, "heroes.json")).items():
            hero[int(c)][0] += n; hero[int(c)][1] += w
        for c, aa in cm.load(os.path.join(d, "augments.json")).items():
            for a, (n, w) in aa.items():
                x = cells[(int(c), "aug", int(a))]; x[0] += n; x[1] += w
        if os.path.exists(os.path.join(d, "items.json")):
            for c, dd in cm.load(os.path.join(d, "items.json")).items():
                for i, (n, w) in (dd.get("items") or {}).items():
                    x = cells[(int(c), "item", int(i))]; x[0] += n; x[1] += w
    return {k: w / n - hero[k[0]][1] / hero[k[0]][0] for k, (n, w) in cells.items() if n >= MIN_PUBLIC and hero[k[0]][0]}


def wcorr(xs, ys, ws):
    tw = sum(ws)
    if tw <= 0 or len(xs) < 3:
        return None
    mx = sum(x * w for x, w in zip(xs, ws)) / tw; my = sum(y * w for y, w in zip(ys, ws)) / tw
    cov = sum((x - mx) * (y - my) * w for x, y, w in zip(xs, ys, ws))
    vx = sum((x - mx) ** 2 * w for x, w in zip(xs, ws)); vy = sum((y - my) ** 2 * w for y, w in zip(ys, ws))
    return cov / math.sqrt(vx * vy) if vx > 0 and vy > 0 else None


def main():
    archive = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    rows = player_rows(archive)
    standardise(rows)
    leads = public_leads()
    holders = collections.defaultdict(list)
    for r in rows:
        for a in r["augs"]:
            holders[(r["champ"], "aug", a)].append(r)
        for i in r["items"]:
            holders[(r["champ"], "item", i)].append(r)
    cells = [(k, v, leads[k]) for k, v in holders.items() if len(v) >= MIN_HOLDERS and k in leads]
    means = [(k, len(v), lead, {s: sum(score(r, s) for r in v) / len(v) for s in SCORES}) for k, v, lead in cells]
    subs = subclasses()
    by_champ = collections.defaultdict(list)
    for m in means:
        by_champ[m[0][0]].append(m)
    out = {}
    for champ, ms in sorted(by_champ.items()):
        rs = {s: wcorr([m[3][s] for m in ms], [m[2] for m in ms], [m[1] for m in ms]) for s in SCORES}
        default = default_score(champ, subs)
        best = max(rs, key=lambda s: rs[s] if rs[s] is not None else -9)
        pick = default
        if len(ms) >= MIN_CELLS and rs[best] is not None and rs[default] is not None and rs[best] - rs[default] >= MARGIN:
            pick = best
        out[str(champ)] = {"score": pick, "default": default, "cells": len(ms),
                           "r": {s: (round(v, 3) if v is not None else None) for s, v in rs.items()}}
    pick_of = lambda champ: (out.get(str(champ)) or {}).get("score") or default_score(champ, subs)
    check = {}
    for label, fn in (("win", lambda m: m[3]["damage"] * 0 + sum(r["win_z"] for r in holders[m[0]]) / m[1]),
                      ("damage for everyone", lambda m: m[3]["damage"]),
                      ("subclass defaults", lambda m: m[3][default_score(m[0][0], subs)]),
                      ("with champion switches (in sample)", lambda m: m[3][pick_of(m[0][0])])):
        v = wcorr([fn(m) for m in means], [m[2] for m in means], [m[1] for m in means])
        check[label] = round(v, 3) if v is not None else None
    res = {"scores": {k: [[s, sg] for s, sg in v] for k, v in SCORES.items()}, "defaults": DEFAULT_BY_SUBCLASS,
           "min_cells": MIN_CELLS, "margin": MARGIN, "cells": len(means), "players": len(rows), "check": check,
           "champions": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    names = {int(v): k for k, v in cm.load(os.path.join(cm.REPO, "web", "src", "data", "champion-ids.json")).items()}
    print(f"{len(means)} cells, {len(rows)} players; r with public leads: {check}")
    for c, v in out.items():
        if v["score"] != v["default"]:
            print(f"  {names.get(int(c), c):14} {v['default']} -> {v['score']}  ({v['cells']} cells, r {v['r']})")


if __name__ == "__main__":
    main()
