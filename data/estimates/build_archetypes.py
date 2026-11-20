#!/usr/bin/env python3
"""Build archetypes per champion (build_archetypes.json): the distinct ways a champion is built (Ashe: AP or crit),
each with its own starters, core, boots, later items and augments. Read by the champion page's archetype switch and
by the overlay, so both show the same builds.

Styles are the site's (web/src/lib/augment-tiers.ts STYLES): crit, onhit, ap, lethality, fighter ("AD"), tank,
enchanter. Each legendary item gets styles from the Simulator's item roles (simulator/data/items.json), else from its
item class (web/src/data/item-groups.json). A core (the feed's 3-item cores) takes the style most of its items share;
an archetype is all the cores of one style, kept when it holds at least MIN_SHARE of the champion's games and enough
games for a Wilson interval narrower than +-MAX_HALF_WIDTH. Its win rate and lift come from those cores.

Starters, boots and later items are the champion's most picked ones whose style fits (else its most picked overall).
The feed has augments per champion only, not per build, so an archetype's augments are the champion's most picked
of each rarity whose official build tags (data/official/augment-build-tags.json) fit the style or that have no tags:
marked `augments_estimated`.

Usage: python3 data/estimates/build_archetypes.py
"""

import json
import math
import os
import sys
from collections import defaultdict

import common as cm

OUT = os.path.join(cm.HERE, "build_archetypes.json")
MIN_SHARE = 0.03
MAX_HALF_WIDTH = 0.03
LATER = 5
AUGMENTS_PER_RARITY = 6

ROLE_STYLES = {"crit": ["crit"], "onhit": ["onhit"], "ap": ["ap"], "ap_onhit": ["ap", "onhit"], "ap_tank": ["ap", "tank"],
               "lethality": ["lethality"], "bruiser": ["fighter"], "ability_ad": ["fighter"], "ad": ["fighter"],
               "tank": ["tank"], "support": ["enchanter"]}
CLASS_STYLES = {"mage": "ap", "marksman": "crit", "assassin": "lethality", "fighter": "fighter", "tank": "tank",
                "support": "enchanter"}
TAG_STYLES = {"crit": "crit", "attack_speed": "onhit", "on_hit": "onhit", "ap": "ap", "ability_power": "ap",
              "pen": "lethality", "lethality": "lethality", "tank": "tank", "support": "enchanter", "fighter": "fighter"}
ORDER = ["crit", "onhit", "ap", "lethality", "fighter", "tank", "enchanter"]


def item_styles():
    sim = cm.load(os.path.join(cm.REPO, "simulator", "data", "items.json"))["items"]
    groups = cm.load(os.path.join(cm.REPO, "web", "src", "data", "item-groups.json"))
    out = {}
    for v in sim.values():
        styles = [s for r in v.get("roles") or [] for s in ROLE_STYLES.get(r, [])]
        if styles and v.get("id"):
            out[int(v["id"])] = list(dict.fromkeys(styles))
    for k, v in groups.items():
        i = int(k)
        base = i % 10000 if i >= 100000 else i  # Mayhem/ARAM copies (22xxxx, 32xxxx, 77xxxx) of a normal item
        if i not in out:
            out[i] = out.get(base) or [CLASS_STYLES[c] for c in v.get("c", []) if c in CLASS_STYLES]
    return out


def style_of(items, styles):
    votes = defaultdict(float)
    for i in items:
        st = styles.get(int(i)) or []
        for s in st:
            votes[s] += 1 / len(st)
    if not votes:
        return None
    return max(ORDER, key=lambda s: (votes.get(s, 0), -ORDER.index(s)))


# Starters and boots serve more than one build: Berserker's Greaves fit crit as well as on-hit.
KIN = {"crit": {"crit", "onhit"}, "onhit": {"onhit", "crit"}, "lethality": {"lethality", "fighter"},
       "fighter": {"fighter", "lethality"}, "ap": {"ap"}, "tank": {"tank"}, "enchanter": {"enchanter", "ap"}}


def fits(items, style, styles, kin=False):
    ok = KIN[style] if kin else {style}
    return any(ok & set(styles.get(int(i)) or []) for i in items)


def wilson_half(p, n):
    if n <= 0:
        return 1.0
    z = 1.96
    return z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)


def champion(b, stats, matches, styles, aug_tags, min_share=MIN_SHARE, max_half=MAX_HALF_WIDTH):
    items = b.get("items") or {}
    cores = items.get("core") or []
    champ_wr = stats.get("win_rate") or 0.5
    games = (stats.get("pick_rate") or 0) * matches
    groups = defaultdict(list)
    for row in cores:
        s = style_of(row["items"], styles)
        if s:
            groups[s].append(row)
    total = sum(r["pick_rate"] for r in cores) or 1
    out = []
    for style, rows in groups.items():
        share = sum(r["pick_rate"] for r in rows) / total
        wr = sum(r["pick_rate"] * r["win_rate"] for r in rows) / max(1e-9, sum(r["pick_rate"] for r in rows))
        n = round(share * games)
        if share < min_share or wilson_half(wr, n) > max_half:
            continue
        core = max(rows, key=lambda r: r["pick_rate"])["items"]
        pick = lambda key: next((r["items"] for r in sorted(items.get(key) or [], key=lambda r: -r["pick_rate"])
                                 if fits(r["items"], style, styles, kin=True)),
                                (max(items.get(key) or [{"items": [], "pick_rate": 0}], key=lambda r: r["pick_rate"])["items"]))
        later = [r["items"][0] for r in sorted(items.get("other") or [], key=lambda r: -r["pick_rate"])
                 if len(r["items"]) == 1 and r["items"][0] not in core and fits(r["items"], style, styles)][:LATER]
        augs = {}
        for rarity in ("prismatic", "gold", "silver"):
            rows_ = sorted(b.get("augments", {}).get(rarity) or [], key=lambda a: -a["pick_rate"])
            ok = [a["id"] for a in rows_
                  if not aug_tags.get(str(a["id"])) or style in {TAG_STYLES.get(t) for t in aug_tags[str(a["id"])]}]
            augs[rarity] = ok[:AUGMENTS_PER_RARITY]
        out.append({"style": style, "share": round(share, 4), "games": n, "win_rate": round(wr, 4),
                     "lift": round(wr - champ_wr, 4), "starters": pick("starting"), "core": core,
                     "boots": pick("boots"), "later": later, "augments": augs, "augments_estimated": True})
    if not out and groups:
        # Too few games for any archetype on its own: the most played one stands for the champion, marked.
        style = max(groups, key=lambda k: sum(r["pick_rate"] for r in groups[k]))
        out = [a for a in champion(b, stats, matches, styles, aug_tags, 0, 1) if a["style"] == style]
        for a in out:
            a["few_games"] = True
    return sorted(out, key=lambda a: -a["share"])


def main():
    patch = cm.live_patch()
    games = cm.load(os.path.join(cm.REPO, "data", "stats", "games.json"))["patches"]
    matches = (games.get(patch) or list(games.values())[-1])["matches"]
    stats = cm.champion_stats()
    styles = item_styles()
    aug_tags = cm.load(os.path.join(cm.REPO, "data", "official", "augment-build-tags.json"))
    champions = {}
    for cid, b in sorted(cm.builds().items(), key=lambda kv: int(kv[0])):
        rows = champion(b, stats.get(cid) or {}, matches, styles, aug_tags)
        if rows:
            champions[cid] = rows
    out = {"patch": patch, "styles": ORDER,
           "method": {"min_share": MIN_SHARE, "max_half_width": MAX_HALF_WIDTH, "later": LATER,
                      "augments_per_rarity": AUGMENTS_PER_RARITY},
           "champions": champions}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    multi = sum(1 for v in champions.values() if len(v) > 1)
    print(f"{len(champions)} champions, {multi} with more than one archetype -> {os.path.relpath(OUT, cm.REPO)}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
