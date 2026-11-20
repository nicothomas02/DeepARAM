#!/usr/bin/env python3
"""Predicted Weapon of Destiny and Pentakill picks, for the Tier List tabs (predicted_tabs.json).

The public feed doesn't record which item a Weapon of Destiny player upgraded or which ability a Pentakill player
Empowered, so both tabs are predictions, labelled so on the site. Nothing here uses the Simulator.

Inputs
- owner_picks.json: counts of real picks in the owner's games since both launched (patch 16.21): the first
  Legendary item finished by Weapon of Destiny players, and the ability each Pentakill player Empowered first.
- The feed's per-champion builds (data/cn/builds): which Legendary items each champion builds at all, so a
  champion is never handed an item it doesn't buy.
- weapon_of_destiny.json: each item's stats per takedown (from the augment's game data) and the feed's share of
  champions whose first Legendary it is, weighted by how often they take the augment.
- Data Dragon class tags, to pool picks across similar champions.

Weapon of Destiny
- Items: predicted share of Weapon picks = PICK_WEIGHT x share of real picks + (1 - PICK_WEIGHT) x the feed's
  first-item share. Real picks favour Shadowflame, Endless Hunger, Heartsteel, Hubris and Void Staff, which the
  feed's first items alone miss.
- Champions: candidates are items the champion builds in the feed. Score = the champion's own picks x OWN +
  (share of picks by its class + half the share of all picks) x how often it builds the item. Checked
  leave-one-out on the real picks: the champion's real Weapon is among the top 3 in 54% of picks (39% for its
  most common first item alone); top 1 stays near 26% either way, so the site lists three.

Pentakill
- Start pick: the champion's own picks plus its class's pick shares (CLASS_WEIGHT): leave-one-out 72% right,
  against 61% for always Q. Champions with fewer than MIN_PICKS real picks are left out rather than guessed.

Run from the repo root: python3 data/estimates/predict_tabs.py
"""

import json
import os
from collections import Counter

import common as cm

OUT = os.path.join(cm.HERE, "predicted_tabs.json")
PICK_WEIGHT = 0.9
OWN = 2.0
CLASS_WEIGHT = 1.0
MIN_PICKS = 2
TOP = 3


def built_items(b):
    """{item id: how often the champion builds it, 0-1} from its full builds and single items."""
    out = Counter()
    for r in b["items"].get("full_builds", []):
        for i in r["items"]:
            out[str(i)] += r["pick_rate"]
    for r in b["items"].get("other", []) + b["items"].get("core", []):
        for i in r["items"]:
            out[str(i)] = max(out[str(i)], r["pick_rate"])
    top = max(out.values(), default=0) or 1
    return {k: min(1.0, v / top) for k, v in out.items()}


def main():
    own = cm.load(os.path.join(cm.HERE, "owner_picks.json"))
    wod = cm.load(os.path.join(cm.HERE, "weapon_of_destiny.json"))
    dd = cm.data_dragon()
    builds = cm.builds()
    cls = {c: (v["tags"] or ["?"])[0] for c, v in dd.items()}
    legendary = set(wod["items"])

    # Weapon of Destiny: items.
    picks = Counter()
    by_class = {}
    for c, items in own["weapon_of_destiny"].items():
        for i, n in items.items():
            picks[i] += n
            by_class.setdefault(cls.get(c), Counter())[i] += n
    total = sum(picks.values()) or 1
    feed_total = sum(v["share"] for v in wod["items"].values()) or 1
    items = {}
    for i, v in wod["items"].items():
        share = PICK_WEIGHT * picks[i] / total + (1 - PICK_WEIGHT) * v["share"] / feed_total
        if share > 0:
            items[i] = {"share": round(share, 5), "per_takedown": v["per_takedown"]}

    # Weapon of Destiny: champions.
    champs = {}
    for c, b in builds.items():
        built = {i: w for i, w in built_items(b).items() if i in legendary}
        if not built:
            continue
        mine = Counter(own["weapon_of_destiny"].get(c, {}))
        pc = by_class.get(cls.get(c), Counter())
        npc = sum(pc.values()) or 1
        score = {i: OWN * mine[i] + (pc[i] / npc + 0.5 * picks[i] / total) * w for i, w in built.items()}
        ranked = [i for i in sorted(score, key=lambda i: -score[i]) if score[i] > 0][:TOP]
        if ranked:
            champs[c] = {"items": [int(i) for i in ranked]}
    best = {}
    for c, v in champs.items():
        best.setdefault(str(v["items"][0]), []).append(c)
    for i, v in items.items():
        v["champions"] = len(best.get(i, []))

    # Pentakill: start pick.
    first = own["pentakill_first"]
    class_picks = {}
    for c, v in first.items():
        class_picks.setdefault(cls.get(c), Counter()).update(v)
    penta = {}
    for c, v in first.items():
        n = sum(v.values())
        if n < MIN_PICKS:
            continue
        cp = class_picks.get(cls.get(c), Counter())
        ncp = sum(cp.values()) or 1
        score = {s: v.get(s, 0) + CLASS_WEIGHT * cp[s] / ncp for s in "QWE"}
        pick = max(score, key=score.get)
        penta[c] = {"start": pick, "picks": n, "agree": round(v.get(pick, 0) / n, 3)}

    out = {
        "patch": cm.live_patch(),
        "since": "16.21",
        "weapon_of_destiny": {"gold_per_takedown": wod["gold_per_takedown"], "items": items, "champions": champs},
        "pentakill": penta,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"{len(items)} items, {len(champs)} champions with a likely Weapon, {len(penta)} Pentakill picks")


if __name__ == "__main__":
    main()
