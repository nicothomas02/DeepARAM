#!/usr/bin/env python3
"""Lay AramHex's real game counts over the 101 feed's files in data/cn, data/stats and data/fill.

Nico, 2026-11-21: base the site's data on AramHex; 101 only fills what AramHex doesn't have. Run after the 101
steps (fetch_cn.py, builds.py, history.py, data/stats/games.py, data/fill/build_estimates.py) and after fetch.py.
It is idempotent: running it twice changes nothing.

What it replaces, for every patch AramHex has (the live one only when AramHex already has it):
  data/cn/history/by_patch.csv + .json   champion win rate and pick rate (101 keeps its rank, damage share, KP, time dead)
  data/stats/games.json                   real matches per patch (estimated: false)
And on the live patch:
  data/cn/champions.json                  champion win rate and pick rate
  data/cn/augments.json                   each augment's win rate and pick rate over all champions
  data/cn/builds/<id>.json                augments (real games + wins), boots, single items, 3-item cores (when the
                                          cores are this patch's own); 101 keeps skill orders, starting items,
                                          six-item builds and teammates
  data/fill/spells_games.json             real summoner spell pairs (estimated: false)
Each replaced file gets "aramhex" in its source notes. Standard library only.

Usage: python3 data/aramhex/merge.py [--check]   (--check: report what would change, write nothing)
"""

import argparse
import csv
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as ah  # noqa: E402

ROOT = ah.ROOT
CN = os.path.join(ROOT, "data", "cn")
HIST = os.path.join(CN, "history")
BUILDS = os.path.join(CN, "builds")
GAMES = os.path.join(ROOT, "data", "stats", "games.json")
SPELLS = os.path.join(ROOT, "data", "fill", "spells_games.json")

# Rows below these game counts stay out of the lists (noise; the site shrinks small samples anyway).
MIN_AUG_GAMES = 100
MIN_ITEM_GAMES = 100
MIN_SPELL_GAMES = 100
ITEM_LIST = os.path.join(ROOT, "web", "public", "assets", "cd", "latest", "plugins", "rcp-be-lol-game-data", "global",
                         "default", "v1", "items.json")
# A start is marked as an augment's when the champion's first-screen picks of augments explain at least this share of
# its games (a majority; flagged to Nico 2026-11-24 as a chosen threshold).
AUGMENT_START_SHARE = 0.5
# The Pentakill headliner's own screen (HEAVY Q, POWER W, THRASH E, DOOM R; wiki ARAM: Mayhem): never offered on a
# regular augment screen, so kept out of the augment lists. The Pentakill tab reads them from the patch files.
PENTAKILL_PICKS = {"3170", "3171", "3172", "3173"}
RARITY = {"silver": "silver", "gold": "gold", "prismatic": "prismatic"}

changed = []


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj, check, compact=False, ascii=False):
    text = json.dumps(obj, ensure_ascii=ascii, separators=(",", ":") if compact else None, indent=None if compact else 1)
    if not text.endswith("\n"):
        text += "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old is not None and old.rstrip("\n") == text.rstrip("\n"):
        return
    changed.append(os.path.relpath(path, ROOT))
    if not check:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


def rate(g, w):
    return round(w / g, 4) if g else 0.0


# ---------------------------------------------------------------- champion history (every patch AramHex has)

def merge_history(check):
    path = os.path.join(HIST, "by_patch.csv")
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    rows = list(csv.DictReader(io.StringIO(text)))
    cols = list(rows[0]) if rows else []
    done = set()
    for patch in {r["patch"] for r in rows}:
        real = ah.champion_rates(patch)
        if not real:
            continue
        done.add(patch)
        mine = [r for r in rows if r["patch"] == patch]
        for r in mine:
            got = real.get(r["champion_id"])
            if got:
                r["win_rate"], r["pick_rate"] = str(round(got[0], 4)), str(round(got[1], 4))
        # "rank" stays 101's own ranking (not a win-rate order); the site ranks with its own tier formula.
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=cols, lineterminator="\r\n" if "\r\n" in text else "\n")
    w.writeheader()
    w.writerows(rows)
    if out.getvalue() != text:
        changed.append(os.path.relpath(path, ROOT))
        if not check:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(out.getvalue())

    jpath = os.path.join(HIST, "by_patch.json")
    site = read_json(jpath)
    for patch, champs in site["champions"].items():
        real = ah.champion_rates(patch)
        days = next((p["days"] for p in site["patches"] if p["patch"] == patch), None)
        for c in champs:
            got = real.get(str(c["id"]))
            if got:
                c["win_rate"], c["pick_rate"] = round(got[0], 4), round(got[1], 4)
                if days:
                    c["weight"] = round(c["pick_rate"] * days, 5)
    site["sources"] = {"win_rate, pick_rate": f"{ah.SOURCE} for patches {', '.join(sorted(done, key=vkey))}; 101 otherwise",
                       "avg_*": "101.qq.com"}
    write_json(jpath, site, check, compact=True)
    return done


def vkey(p):
    return [int(x) for x in p.split(".")]


# ---------------------------------------------------------------- matches per patch

def merge_games(check, patches):
    if not os.path.exists(GAMES):
        return
    g = read_json(GAMES)
    for p in patches:
        n = ah.matches(p)
        if n and p in g["patches"]:
            e = g["patches"][p]
            e.update({"matches": int(n), "per_day": round(n / max(e.get("days") or 1, 1)), "estimated": False, "source": "aramhex"})
    g["about"] = ("Matches behind each patch's stats: real counts from AramHex where it has the patch (source: aramhex), "
                  "else estimated from 101's day-to-day win-rate noise (data/stats/games.py). A champion's games = "
                  "pick_rate x matches; an item's or a teammate pair's = its share x the champion's games.")
    write_json(GAMES, g, check)


# ---------------------------------------------------------------- live patch: champions, augments, builds, spells

def merge_live_champions(check, live):
    real = ah.champion_rates(live)
    path = os.path.join(CN, "champions.json")
    d = read_json(path)
    for c in d["champions"]:
        got = real.get(str(c["champion_id"]))
        if got:
            c["win_rate"], c["pick_rate"] = round(got[0], 4), round(got[1], 4)
    d["meta"]["aramhex"] = {"patch": live, "fields": ["win_rate", "pick_rate"], "source": ah.SOURCE}
    write_json(path, d, check)
    # The same numbers in champions.csv (101 keeps its rank and the other columns).
    cpath = os.path.join(CN, "champions.csv")
    if os.path.exists(cpath):
        with open(cpath, encoding="utf-8-sig", newline="") as f:
            text = f.read()
        bom = open(cpath, "rb").read(3) == b"\xef\xbb\xbf"
        rows = list(csv.DictReader(io.StringIO(text)))
        by = {str(c["champion_id"]): c for c in d["champions"]}
        for r in rows:
            c = by.get(r["champion_id"])
            if c:
                r["win_rate"], r["pick_rate"] = str(c["win_rate"]), str(c["pick_rate"])
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=list(rows[0]), lineterminator="\r\n" if "\r\n" in text else "\n")
        w.writeheader()
        w.writerows(rows)
        if out.getvalue() != text:
            changed.append(os.path.relpath(cpath, ROOT))
            if not check:
                with open(cpath, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
                    f.write(out.getvalue())


def merge_live_augments(check, live):
    A = ah.load(live, "augments") or {}
    n = ah.matches(live)
    tot = {}
    for v in A.values():
        for a, (g, w) in v.items():
            t = tot.setdefault(a, [0, 0])
            t[0] += g
            t[1] += w
    path = os.path.join(CN, "augments.json")
    d = read_json(path)
    for r in d["augments"]:
        t = tot.get(str(r["augment_id"]))
        if t and t[0] >= MIN_AUG_GAMES:
            r["win_rate"] = rate(t[0], t[1])
            # Games with the augment per match (all ten players), the scale the 101 table used.
            r["pick_rate"] = round(t[0] / n, 4)
            r["games"] = t[0]
    for key in ("win_rate", "pick_rate"):
        order = sorted(d["augments"], key=lambda r: -r[key])
        for i, r in enumerate(order, 1):
            r["win_rank" if key == "win_rate" else "pick_rank"] = i
    d["meta"]["aramhex"] = {"patch": live, "fields": ["win_rate", "pick_rate", "games"], "source": ah.SOURCE}
    write_json(path, d, check)


def row(ids, g, w, denom, pooled=None):
    r = {"items": ids, "pick_rate": round(g / denom, 4), "win_rate": rate(g, w), "games": g}
    p = (pooled or {}).get(str(ids[0]) if len(ids) == 1 else None)
    if p and p[2] > 1:
        r["pooled"] = {"win_rate": p[0], "games": p[1], "patches": p[2]}
    return r


def pooled_table(live, name, cid, key=None):
    """common.pool for one champion's rows in one table, with the earlier patches that have the table."""
    hist = []
    for p in [live] + ah.earlier(live):
        t = (ah.load(p, name) or {}).get(cid)
        if t is None:
            break
        hist.append(t["items"] if key == "items" else t)
    return ah.pool(hist) if hist else {}


def start_history(live):
    """Each earlier patch's starting items per champion from the saved 101 snapshots (data/cn/history/builds), as
    {cid: {key: [games, wins]}} with games = the champion's AramHex games that patch x the start's pick rate."""
    out = []
    for p in ah.earlier(live):
        path = os.path.join(HIST, "builds", p + ".json")
        heroes = ah.load(p, "heroes") or {}
        if not os.path.exists(path) or not heroes:
            break
        t = {}
        for cid, c in read_json(path).get("champions", {}).items():
            g_all = (heroes.get(cid) or [0])[0]
            rows = {}
            for ids, pick, wr in (c.get("items") or {}).get("starting") or []:
                g = int(round(g_all * pick))
                if g > 0 and wr is not None:
                    rows[start_key(ids)] = [g, int(round(g * wr))]
            t[cid] = rows
        out.append(t)
    return out


def start_key(ids):
    return "+".join(map(str, sorted(ids)))


def augment_starts():
    path = os.path.join(ROOT, "data", "estimates", "augment_starts.json")
    return read_json(path) if os.path.exists(path) else {}


# Start rows are matched without potions and wards, which the feeds and the archive list unevenly.
SKIP_STARTS = None


def start_set(ids):
    global SKIP_STARTS
    if SKIP_STARTS is None:
        SKIP_STARTS = {r["id"] for r in read_json(ITEM_LIST) if {"Consumable", "Trinket"} & set(r.get("categories") or [])} \
            if os.path.exists(ITEM_LIST) else set()
    return tuple(sorted(i for i in ids if i not in SKIP_STARTS))


def wilson_low(k, n, z=1.96):
    if not n:
        return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def mark_augment_starts(rows, augs, est):
    """Estimates how many of each starting row's games come from the champion's first-screen picks of an augment that
    makes players buy that start (data/estimates/augment_starts.py: Upgrade Stormsurge -> Hextech Alternator, Ethereal
    Weapon -> Sheen, Wooglet's Witchcap -> Needlessly Large Rod...). For each augment the champion takes, its
    first-screen pickers (games x first_share) times how much more often first-pickers start that exact set than the
    same champions' other players start with all of its items (the archive's and the feeds' start sets differ in small
    parts, Upgrade Stormsurge's Amplifying Tome + Hextech Alternator against Ahri's Hextech Alternator), counted only where the archive shows a real rise (95% lower bound above the rest's rate). A row
    whose games are mostly explained that way is marked (augment: the main one, augment_share: the share); the site
    keeps marked rows off the card's default start (Nico 2026-11-24: the default start mustn't come from an augment
    rush, including ones like Ethereal Weapon or BEES!)."""
    for r in rows:
        r.pop("augment", None)
        r.pop("augment_share", None)
    if not est:
        return {}
    groups = {}
    for r in rows:
        k = start_set(r["items"])
        if k and r.get("games"):
            groups.setdefault(k, []).append(r)
    # rises[aid][k]: (share of first-pickers starting with all of k's items above the same champions' other players,
    # first-pickers with it); only rises whose 95% lower bound clears the others' rate.
    rises = {}
    for aid, a in (est.get("augments") or {}).items():
        if int(aid) not in augs:
            continue
        n = a["first_pickers"]
        for k in groups:
            hit = sum(h for s, h, _ in a["starts"] if set(k) <= set(s))
            rest = sum(x for s, _, x in a["starts"] if set(k) <= set(s)) / n
            if wilson_low(hit, n) > rest:
                rises.setdefault(int(aid), {})[k] = (hit / n - rest, hit)
    for k, rs in groups.items():
        g = sum(r["games"] for r in rs)
        extra = {aid: augs[aid]["games"] * est["augments"][str(aid)]["first_share"] * ks[k][0] for aid, ks in rises.items() if k in ks}
        e = sum(extra.values())
        if e / g >= AUGMENT_START_SHARE:
            for r in rs:
                r["augment"] = max(extra, key=extra.get)
                r["augment_share"] = round(min(1.0, e / g), 2)
    # The start each augment leads to when taken first (the apps switch to it): the champion's start with the biggest
    # rise, when players who take that augment first start it more often than any other start (its first-pickers'
    # most common start, counted in the archive) and the rise at least matches how often the champion's players start
    # it overall (the augment at least doubles it: Upgrade Stormsurge and Alternator on Ahri, not Eureka and Lost
    # Chapter, which her players start anyway; a chosen line, flagged to Nico 2026-11-24).
    out = {}
    for aid, ks in rises.items():
        k = max(ks, key=lambda x: ks[x][0])
        starts = est["augments"][str(aid)]["starts"]
        other = max([h for s, h, _ in starts if not set(k) <= set(s)], default=0)
        if ks[k][1] >= other and ks[k][0] >= sum(r["pick_rate"] for r in groups[k]):
            out[str(aid)] = max(groups[k], key=lambda r: r["games"])["items"]
    return out


def pool_starts(rows, g_all, cid, hist):
    """Starting items with real games (g_all x pick rate) and, where earlier patches agree, pooled like the other
    lists (common.pool), so a rarely bought start with a steady lead keeps it under the bound rule (Nico 2026-11-24:
    unify the rule while keeping rare starters; analysis/scoring/starters_pool.py)."""
    live = {}
    for r in rows:
        g = int(round(g_all * r["pick_rate"]))
        if g > 0 and r.get("win_rate") is not None:
            r["games"] = g
            live[start_key(r["items"])] = [g, int(round(g * r["win_rate"]))]
        r.pop("pooled", None)
    if not live:
        return
    pooled = ah.pool([live] + [h.get(cid) or {} for h in hist])
    for r in rows:
        p = pooled.get(start_key(r["items"]))
        if p and p[2] > 1:
            r["pooled"] = {"win_rate": p[0], "games": p[1], "patches": p[2]}


def merge_builds(check, live):
    heroes = ah.load(live, "heroes") or {}
    A = ah.load(live, "augments") or {}
    info = ah.load(live, "augment_info") or {}
    items = ah.load(live, "items") or {}
    boots = ah.load(live, "boots") or {}
    cores = ah.load(live, "cores") or {}
    own_cores = "cores" not in ah.carried(live)
    # Augments pooled with earlier patches where nothing changed (common.pool); the site ranks on these by default.
    aug_hist = [ah.load(p, "augments") or {} for p in ah.earlier(live)]
    starts_hist = start_history(live)
    a_starts = augment_starts()
    boot_ids = {int(i) for v in boots.values() for i in v["items"]}
    n = 0
    for name in sorted(os.listdir(BUILDS)):
        if not name[:-5].isdigit():
            continue
        cid = name[:-5]
        if cid not in heroes:
            continue
        path = os.path.join(BUILDS, name)
        b = read_json(path)
        src = dict(b.get("sources") or {})
        g_all = heroes[cid][0]
        # Augments: every augment this champion took, with real games and wins. 101's letter grade stays where it
        # gave one (the site ranks by DeepScore once rows carry games).
        grades = {r["id"]: r.get("grade") for r in (b.get("augments") or {}).get("all", [])}
        rows = []
        pooled = ah.pool([A.get(cid) or {}] + [h.get(cid) or {} for h in aug_hist])
        for a, (g, w) in (A.get(cid) or {}).items():
            if g < MIN_AUG_GAMES or a in PENTAKILL_PICKS:
                continue
            r = {"id": int(a), "pick_rate": round(g / g_all, 4), "win_rate": rate(g, w), "games": g}
            r["grade"] = grades.get(int(a)) or ""
            pw, pg, pn = pooled.get(a, (None, 0, 1))
            if pn > 1:
                r["pooled"] = {"win_rate": pw, "games": pg, "patches": pn}
            rows.append((info.get(a), r))
        if rows:
            rows.sort(key=lambda x: -x[1]["games"])
            augs = {"all": [r for _, r in rows]}
            for k in RARITY:
                augs[k] = [r for t, r in rows if t == k]
            b["augments"] = augs
            src["augments"] = "aramhex"
        it = b.setdefault("items", {})
        if it.get("starting"):
            pool_starts(it["starting"], g_all, cid, starts_hist)
            by_aug = mark_augment_starts(it["starting"], {r["id"]: r for r in (b.get("augments") or {}).get("all", [])}, a_starts)
            it.pop("augment_starts", None)
            if by_aug:
                b["augment_starts"] = by_aug
            else:
                b.pop("augment_starts", None)
        bt = boots.get(cid)
        if bt and bt["items"]:
            den = bt["all"][0]
            # Boots pooled with earlier patches where nothing changed, like augments (Nico 2026-11-24: "Can we do this
            # with historical patches?"). Backtest on the saved per-patch 101 snapshots 16.20-16.23
            # (analysis/scoring/items_pool.py): same picks on a full patch (+0.004 pts per 3-row offer), better on a
            # patch's first days (10% of games: +0.10 pts per offer, rank correlation +0.08). Single items are NOT
            # pooled: there pooling picked worse (-0.008 full, -0.036 at 10%).
            bp = pooled_table(live, "boots", cid, key="items")
            it["boots"] = sorted((row([int(i)], g, w, den, bp) for i, (g, w) in bt["items"].items() if g >= MIN_ITEM_GAMES),
                                 key=lambda r: -r["games"])
            src["items.boots"] = "aramhex"
        ti = items.get(cid)
        if ti and ti["items"]:
            den = ti["all"][0]
            it["other"] = sorted((row([int(i)], g, w, den) for i, (g, w) in ti["items"].items()
                                  if g >= MIN_ITEM_GAMES and int(i) not in boot_ids), key=lambda r: -r["games"])
            src["items.other"] = "aramhex"
        tc = cores.get(cid)
        if own_cores and tc and ti:
            den = ti["all"][0]
            it["core"] = [dict(row(ids, g, w, den), ordered=True) for ids, g, w in sorted(tc, key=lambda c: -c[1])]
            src["items.core"] = "aramhex"
        for k in ("items.core", "items.other"):
            if src.get(k) == "aramhex" and k in (b.get("derived") or []):
                b["derived"] = [x for x in b["derived"] if x != k]
        b["sources"] = src
        b["aramhex_patch"] = live
        write_json(path, b, check, compact=True)
        n += 1
    return n


def merge_spells(check, live):
    sp = ah.load(live, "spells")
    heroes = ah.load(live, "heroes") or {}
    if not sp:
        return
    g = read_json(GAMES)["patches"].get(live, {}) if os.path.exists(GAMES) else {}
    out = {"patch": live, "estimated": False, "source": "aramhex", "total_games": ah.matches(live),
           "daily_games": g.get("per_day"), "champions": {}}
    for cid, pairs in sp.items():
        g_all = heroes.get(cid, [0])[0]
        if not g_all:
            continue
        ps = pooled_table(live, "spells", cid)
        rows = []
        for k, (g, w) in pairs.items():
            if g < MIN_SPELL_GAMES:
                continue
            r = {"ids": sorted(int(x) for x in k.split("+")), "games": g, "pick_rate": round(g / g_all, 4), "win_rate": rate(g, w)}
            pw, pg, pn = ps.get(k, (None, 0, 1))
            if pn > 1:
                r["pooled"] = {"win_rate": pw, "games": pg, "patches": pn}
            rows.append(r)
        rows.sort(key=lambda r: -r["games"])
        if rows:
            out["champions"][cid] = {"games": g_all, "spells": rows}
    if os.path.exists(SPELLS):
        old = read_json(SPELLS)
        out["built"] = old.get("built")
    write_json(SPELLS, out, check)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if not ah.patches():
        print("no AramHex data (run data/aramhex/fetch.py first)")
        return 0
    done = merge_history(a.check)
    merge_games(a.check, done)
    live = ah.live_patch()
    if live and ah.has(live, "heroes"):
        merge_live_champions(a.check, live)
        merge_live_augments(a.check, live)
        nb = merge_builds(a.check, live)
        merge_spells(a.check, live)
        print(f"live patch {live}: AramHex builds for {nb} champions")
    else:
        print(f"live patch {live}: AramHex doesn't have it yet, the live tables stay on 101")
    print(f"patches with AramHex champion rates: {', '.join(sorted(done, key=vkey))}")
    print(("would change" if a.check else "changed") + f" {len(changed)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
