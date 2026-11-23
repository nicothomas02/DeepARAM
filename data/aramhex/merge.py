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
            if g < MIN_AUG_GAMES:
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
        bt = boots.get(cid)
        if bt and bt["items"]:
            den = bt["all"][0]
            pb = pooled_table(live, "boots", cid, "items")
            it["boots"] = sorted((row([int(i)], g, w, den, pb) for i, (g, w) in bt["items"].items() if g >= MIN_ITEM_GAMES),
                                 key=lambda r: -r["games"])
            src["items.boots"] = "aramhex"
        ti = items.get(cid)
        if ti and ti["items"]:
            den = ti["all"][0]
            po = pooled_table(live, "items", cid, "items")
            it["other"] = sorted((row([int(i)], g, w, den, po) for i, (g, w) in ti["items"].items()
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
