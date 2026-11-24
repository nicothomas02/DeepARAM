#!/usr/bin/env python3
"""Niche builds per champion (niche_builds.json): a style that few players build on a champion (not one of its
build_archetypes.json styles) but whose items clearly win more on it, e.g. enchanter Orianna (Moonstone Renewer,
Ardent Censer, Staff of Flowing Water). Nico asked 2026-11-24 for niche builds alongside the usual ones.

A style is a niche build for a champion when at least 2 of its legendary items (by their main style) each have
>= MIN_GAMES games on the champion (AramHex 16.22 + 16.23 item stats) and a win rate above the champion's average by
more than 1.96 standard errors. Tank is left out: defensive items are bought against particular enemies, and counter
items are judged by what they do, not their win rate (house rule). Win rates are correlational, so a niche build is
marked estimated: it can be strong partly because of the augments its players take.

Triggers (the apps switch to the niche build when you take one): augments in the champion's Mayhem pool after which
players build that style clearly more than the same champion's players without it (archive, all lobbies: z >= 4, strict because about 2,000 augment x style pairs are tested with
>= MIN_HOLDERS holders, a leave-one-out expected rate per champion). Augments that pull 4+ styles at once (they hand
out random items) are skipped.

Usage: python3 data/estimates/niche_builds.py
"""

import glob
import gzip
import json
import math
import os
from collections import Counter, defaultdict

import common as cm
from build_archetypes import item_styles

OUT = os.path.join(cm.HERE, "niche_builds.json")
PATCHES = ["16.22", "16.23"]
MIN_GAMES = 1000
Z_ITEM = 1.96
MAX_SHARE = 0.05
MIN_HOLDERS = 20
Z_TRIGGER = 4.0
SKIP = {"tank"}
ARCHIVE = os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive/games"))


def legendary_ids():
    dd = sorted(glob.glob(os.path.join(cm.REPO, "web", "public", "assets", "dd", "*", "data", "en_US", "item.json")))[-1]
    data = cm.load(dd)["data"]
    return {int(k) for k, v in data.items() if v.get("gold", {}).get("total", 0) >= 2200}


def base(i):
    return i % 10000 if i > 100000 else i


def main_style(i, styles):
    st = styles.get(i) or styles.get(base(i)) or []
    return st[0] if st else None


def item_stats():
    items = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    games = defaultdict(lambda: [0, 0])
    for p in PATCHES:
        path = os.path.join(cm.REPO, "data", "aramhex", "patches", p, "items.json")
        if not os.path.exists(path):
            continue
        for ch, v in cm.load(path).items():
            games[ch][0] += v["all"][0]
            games[ch][1] += v["all"][1]
            for iid, (g, w) in v["items"].items():
                items[ch][base(int(iid))][0] += g
                items[ch][base(int(iid))][1] += w
    return items, games


def pools():
    out = defaultdict(set)
    for p in PATCHES:
        path = os.path.join(cm.REPO, "data", "aramhex", "patches", p, "augments.json")
        if os.path.exists(path):
            for ch, a in cm.load(path).items():
                out[ch].update(int(x) for x, (g, _) in a.items() if g >= 200)
    return out


def style_pulls(styles, legend):
    """{augment: {style: z}} from the archive: holders building the style vs the same champions' other players."""
    rows = []
    for f in sorted(glob.glob(os.path.join(ARCHIVE, "*.json.gz"))):
        with gzip.open(f) as fh:
            g = json.load(fh)
        for p in g.get("participants", []):
            s = p["stats"]
            augs = {s.get(f"playerAugment{i}", 0) for i in range(1, 7)} - {0}
            st = {main_style(base(s.get(f"item{i}", 0)), styles) for i in range(7) if base(s.get(f"item{i}", 0)) in legend}
            rows.append((p["championId"], augs, st - {None}))
    n, have = Counter(), defaultdict(Counter)
    for c, _, st in rows:
        n[c] += 1
        for x in st:
            have[c][x] += 1
    holders = defaultdict(list)
    for c, augs, st in rows:
        for a in augs:
            holders[a].append((c, st))
    out = {}
    for a, rows_a in holders.items():
        if len(rows_a) < MIN_HOLDERS:
            continue
        zs = {}
        for x in {x for _, st in rows_a for x in st}:
            obs = sum(1 for _, st in rows_a if x in st)
            ps = [(have[c][x] - (x in st)) / max(1, n[c] - 1) for c, st in rows_a]
            var = sum(q * (1 - q) for q in ps)
            if var > 0:
                zs[x] = (obs - sum(ps)) / math.sqrt(var)
        strong = {x: z for x, z in zs.items() if z >= Z_TRIGGER}
        if 0 < len(strong) < 4:
            out[a] = {x: (round(z, 1), len(rows_a)) for x, z in strong.items()}
    return out, len(rows)


def main():
    styles = item_styles()
    legend = legendary_ids()
    arch = cm.load(os.path.join(cm.HERE, "build_archetypes.json"))["champions"]
    items, games = item_stats()
    pool = pools()
    pulls, players = style_pulls(styles, legend)
    champions = {}
    for ch, its in items.items():
        total, wins = games[ch]
        if not total:
            continue
        avg = wins / total
        known = {a["style"] for a in arch.get(ch, [])}
        mainb = (arch.get(ch) or [{}])[0]
        by = defaultdict(list)
        for i, (g, w) in its.items():
            if i not in legend or g < MIN_GAMES:
                continue
            x = main_style(i, styles)
            if not x or x in known or x in SKIP:
                continue
            lift = w / g - avg
            se = math.sqrt(avg * (1 - avg) / g)
            by[x].append({"id": i, "games": g, "win_rate": round(w / g, 4), "lift": round(lift, 4), "z": round(lift / se, 2)})
        for x, rows in by.items():
            good = sorted([r for r in rows if r["z"] > Z_ITEM], key=lambda r: -(r["lift"] - Z_ITEM * math.sqrt(avg * (1 - avg) / r["games"])))
            share = max(r["games"] for r in rows) / total
            if len(good) < 2 or share >= MAX_SHARE:
                continue
            core = [r["id"] for r in good[:3]]
            for i in mainb.get("core", []):
                if len(core) < 3 and i not in core:
                    core.append(i)
            later = [r["id"] for r in good[3:]] + [i for i in mainb.get("core", []) + mainb.get("later", []) if i not in core]
            g_all = sum(r["games"] for r in good)
            wr = sum(r["win_rate"] * r["games"] for r in good) / g_all
            trig = sorted(((pulls[a][x][0], a) for a in pool.get(ch, set()) if x in pulls.get(a, {})), reverse=True)
            champions.setdefault(ch, []).append({
                "style": x, "niche": True, "share": round(share, 4), "games": max(r["games"] for r in good),
                "win_rate": round(wr, 4), "lift": round(wr - avg, 4), "starters": mainb.get("starters", []), "core": core,
                "boots": mainb.get("boots", []), "later": later[:5], "items": good[:5],
                "triggers": [a for _, a in trig[:6]], "trigger_z": {str(a): z for z, a in trig[:6]}, "estimated": True,
            })
    for v in champions.values():
        v.sort(key=lambda a: -a["lift"])
    out = {"patches": PATCHES, "method": {"min_games": MIN_GAMES, "z_item": Z_ITEM, "max_share": MAX_SHARE, "skip": sorted(SKIP),
           "trigger": {"z": Z_TRIGGER, "min_holders": MIN_HOLDERS, "archive_players": players}}, "champions": champions}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    n = sum(len(v) for v in champions.values())
    print(f"{n} niche builds on {len(champions)} champions -> {os.path.relpath(OUT, cm.REPO)}")


if __name__ == "__main__":
    main()
