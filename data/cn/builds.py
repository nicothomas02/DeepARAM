#!/usr/bin/env python3
"""Fetch each champion's Mayhem build data: augments, skill order, items, partners.

Same backend as fetch_cn.py: the endpoint 101.qq.com's champion page calls in
Mayhem (海斗) mode, `fuwen_hero_rank?championid=N`. It returns the newest day's
numbers only, so the daily run overwrites one file per champion.

Writes data/cn/builds/<champion_id>.json (see README.md for the format) and
builds/index.json listing every champion with a file.

Some blocks of the feed can stop updating while the rest goes on (core builds, single items and skill
orders froze in mid-October 2026). Each file records in "fresh" when every block last changed. A block
unchanged for STALE_DAYS is stale: core builds and single items are then rebuilt from the six-item builds,
which still update, and listed in "derived"; anything else stale is listed in "stale" so the site can hide
or label it.

Usage: python3 data/cn/builds.py [champion_id ...]   (default: every champion)
Standard library only.
"""

import datetime as dt
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from fetch_cn import HERO_LIST, OUT, get, odp

BUILDS = os.path.join(OUT, "builds")
SKILLS = {"1": "Q", "2": "W", "3": "E", "4": "R"}
TIERS = {"255": "all", "kSilver": "silver", "kGold": "gold", "kPrismatic": "prismatic"}


def ratio(v, basis_points=False):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v / 10000 if basis_points else v, 4)


# Tencent's ids that differ from the game client's (3097 is Stormrazor, 3095 in the client)
ITEM_IDS = {3097: 3095}


def item_ids(s):
    ids = [int(i) for i in str(s).replace("&", ",").split(",") if i.strip().isdigit() and int(i) > 0]
    return [ITEM_IDS.get(i, i) for i in ids]


def parse_dollar_list(s):
    """'ids$pick$win#...' (starting items, boots)."""
    rows = []
    for rec in filter(None, str(s or "").split("#")):
        ids, pick, win = (rec.split("$") + ["", ""])[:3]
        if item_ids(ids):
            rows.append({"items": item_ids(ids), "pick_rate": ratio(pick), "win_rate": ratio(win)})
    return rows


def parse_json_list(s, key):
    """{"1": {key: "a&b", "showrate": 1543, "winrate": 5287}, ...} with rates in basis points."""
    try:
        d = json.loads(s) if isinstance(s, str) else (s or {})
    except ValueError:
        return []
    rows = []
    for v in (d.values() if isinstance(d, dict) else d):
        if item_ids(v.get(key, "")):
            rows.append({"items": item_ids(v[key]), "pick_rate": ratio(v.get("showrate"), True),
                         "win_rate": ratio(v.get("winrate"), True)})
    return sorted(rows, key=lambda r: -(r["pick_rate"] or 0))


def parse_full_builds(s):
    """'rank_ids_pick_win;...' (most common six-item builds)."""
    rows = []
    for rec in filter(None, str(s or "").split(";")):
        p = rec.split("_")
        if len(p) >= 4 and item_ids(p[1]):
            rows.append({"items": item_ids(p[1]), "pick_rate": ratio(p[2]), "win_rate": ratio(p[3])})
    return rows


def parse_augments(s):
    """'255:rank|champ|aug|tier|pick|grade#...&kGold:...' -> {all, silver, gold, prismatic}."""
    out = {t: [] for t in TIERS.values()}
    for section in filter(None, str(s or "").split("&")):
        tier, _, body = section.partition(":")
        key = TIERS.get(tier.strip())
        if not key:
            continue
        for rec in filter(None, body.split("#")):
            p = rec.split("|")
            if len(p) >= 5 and p[2].isdigit():
                out[key].append({"id": int(p[2]), "pick_rate": ratio(p[4]),
                                 "grade": p[5] if len(p) > 5 else ""})
    return out


def parse_skills(s):
    """Skill max orders, each with its most common level-by-level sequences."""
    try:
        d = json.loads(s) if isinstance(s, str) else (s or {})
    except ValueError:
        return []
    out = []
    for v in d.values():
        orders = [{"order": [SKILLS.get(k, k) for k in str(o.get("sk", "")).split("&") if k],
                   "pick_rate": ratio(o.get("sk_s"), True), "win_rate": ratio(o.get("sk_w"), True)}
                  for o in (v.get("sks") or {}).values()]
        out.append({"max_order": [SKILLS.get(k, k) for k in str(v.get("qwe", "")).split("&") if k],
                    "pick_rate": ratio(v.get("qwe_s"), True), "win_rate": ratio(v.get("qwe_w"), True),
                    "orders": orders})
    return sorted(out, key=lambda r: -(r["pick_rate"] or 0))


def parse_partners(s):
    rows = []
    for rec in filter(None, str(s or "").split("#")):
        p = rec.split("|")
        if len(p) >= 3 and p[0].isdigit():
            rows.append({"id": int(p[0]), "win_rate": ratio(p[1]), "pick_rate": ratio(p[2])})
    return rows


STALE_DAYS = 7
BOOTS = {1001, 2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158}
BLOCKS = ("augments", "skills", "partners", "items.starting", "items.boots", "items.core", "items.other",
          "items.full_builds")


def block(d, key):
    a, _, b = key.partition(".")
    return (d.get(a) or {}).get(b) if b else d.get(a)


def signature(v):
    return hashlib.sha1(json.dumps(v, sort_keys=True).encode()).hexdigest()[:12]


def from_full_builds(full, boots):
    """Single items and three-item cores from the six-item builds. An item's pick rate is the share of the
    listed builds that have it; a core is each build's three most common non-boots items, most common first
    (the builds list items as a set, so the most built items stand in for the first ones bought)."""
    total = sum(r["pick_rate"] or 0 for r in full)
    if not total:
        return [], []
    share, wins = {}, {}
    for r in full:
        for i in set(r["items"]):
            share[i] = share.get(i, 0) + r["pick_rate"]
            wins[i] = wins.get(i, 0) + r["pick_rate"] * (r["win_rate"] or 0)
    other = [{"items": [i], "pick_rate": round(share[i] / total, 4), "win_rate": round(wins[i] / share[i], 4)}
             for i in share if i not in boots]
    other.sort(key=lambda r: -r["pick_rate"])
    cores = {}
    for r in full:
        top = sorted((i for i in set(r["items"]) if i not in boots), key=lambda i: (-share[i], i))[:3]
        if len(top) == 3:
            c = cores.setdefault(tuple(top), [0.0, 0.0])
            c[0] += r["pick_rate"]
            c[1] += r["pick_rate"] * (r["win_rate"] or 0)
    core = [{"items": list(k), "pick_rate": round(v[0] / total, 4), "win_rate": round(v[1] / v[0], 4)}
            for k, v in cores.items() if v[0]]
    core.sort(key=lambda r: -r["pick_rate"])
    return core, other


def freshen(data, old, boots):
    """Record when each block last changed (against the previous file) and replace or flag stale ones."""
    prev = (old or {}).get("fresh") or {}
    day = dt.date.fromisoformat(data["date"])
    fresh, stale = {}, []
    for key in BLOCKS:
        sig = signature(block(data, key))
        p = prev.get(key)
        since = p["since"] if p and p.get("sig") == sig else data["date"]
        fresh[key] = {"sig": sig, "since": since}
        if (day - dt.date.fromisoformat(since)).days >= STALE_DAYS:
            stale.append(key)
    derived = []
    if "items.full_builds" not in stale and ({"items.core", "items.other"} & set(stale)):
        core, other = from_full_builds(data["items"]["full_builds"], boots)
        for key, rows in (("items.core", core), ("items.other", other)):
            if key in stale and rows:
                data["items"][key.split(".")[1]] = rows
                derived.append(key)
    data["fresh"] = fresh
    data["derived"] = derived
    data["stale"] = [k for k in stale if k not in derived]
    return data


def build(cid, name):
    _, p = odp("fuwen_hero_rank", {"championid": cid})
    if not isinstance(p, dict) or not p.get("dtstatdate"):
        return None
    d = p["dtstatdate"]
    return {
        "id": cid, "name": name, "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
        "augments": parse_augments(p.get("augment_json_irank") or p.get("augment_json")),
        "skills": parse_skills(p.get("skill_json")),
        "items": {
            "starting": parse_dollar_list(p.get("itemout")),
            "boots": parse_dollar_list(p.get("itemshoes")),
            "core": parse_json_list(p.get("itemcore_json"), "itemcore"),
            "other": parse_json_list(p.get("itemone_json"), "itemone"),
            "full_builds": parse_full_builds(p.get("itemover_rec")),
        },
        "partners": parse_partners(p.get("championid_json")),
    }


def main():
    heroes = {int(h["heroId"]): h.get("alias", h["heroId"]) for h in get(HERO_LIST)["hero"]}
    ids = [int(a) for a in sys.argv[1:]] or sorted(heroes)
    os.makedirs(BUILDS, exist_ok=True)

    def one(cid):
        for attempt in range(3):
            try:
                return cid, build(cid, heroes.get(cid, str(cid)))
            except Exception as e:  # one champion failing shouldn't stop the rest
                err = e
                time.sleep(2 * (attempt + 1))
        print(f"champion {cid}: {err}", file=sys.stderr)
        return cid, None

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, ids))
    written = []
    boots = BOOTS | {i for _, d in results if d for r in d["items"]["boots"] for i in r["items"]}
    for cid, data in results:
        if data:
            path = os.path.join(BUILDS, f"{cid}.json")
            try:
                with open(path, encoding="utf-8") as f:
                    old = json.load(f)
            except (OSError, ValueError):
                old = None
            freshen(data, old, boots)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            written.append({"id": cid, "name": data["name"], "date": data["date"]})
    if len(sys.argv) == 1:
        with open(os.path.join(BUILDS, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"updated": dt.date.today().isoformat(), "champions": written}, f,
                      ensure_ascii=False, indent=1)
    print(f"builds: {len(written)} of {len(ids)} champions")


if __name__ == "__main__":
    main()
