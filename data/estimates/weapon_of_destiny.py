#!/usr/bin/env python3
"""Weapon of Destiny item ranking, for the Tier List's Weapon of Destiny tab.

Weapon of Destiny (gold augment 3081) turns your first Legendary item into the Weapon of Destiny: each
champion takedown adds GoldValue (200) gold worth of that item's own upgradeable stats, shared equally
among them. The augment's spell data (game/maps/modespecificdata/kiwi.bin) holds how much of each stat
BaselineGoldAmp (1,000) gold buys (UpgradeAD 30, UpgradeHealth 375, ...), so one takedown on an item
with N upgradeable stats adds Upgrade<stat> x GoldValue / BaselineGoldAmp / N of each.

Each item gets these numbers. Until the augment has real games (no champion lists it among its augments
yet), the output says "anticipated" and the site ranks by valuable stats; once it does, by a DeepScore
from share and lift (Nico 2026-10-23):

- share: how often it would be the Weapon. Each champion's Weapon is its first Legendary item in its core
  builds' order. Champions are weighted by pick rate times how often they take the augment, or, while the
  augment has no games, times takedowns per game (the augment pays per takedown).
- lift: the win rate of core builds that start with it minus the same champion's average over its core
  builds, weighted like share, so items strong champions happen to buy don't look better than they are.
- rare: how much of the upgrade goes into stats few Legendary items give. Each stat's rarity is
  log2(Legendary items / Legendary items with that stat), so Critical Strike Damage (one item) is worth
  far more than Attack Damage or Health (sixty-odd each); the item's score is its stats' rarities
  averaged, since the 200 gold is shared equally.
- value: what the anticipated ranking sorts by (Nico 2026-10-23: rarity and value both). Each stat's
  rarity times how much it's worth (VALUE), averaged over the item's stats like rare.

Run from the repo root:
    python3 data/estimates/weapon_of_destiny.py
Writes data/estimates/weapon_of_destiny.json.
"""

import json
import math
import os
import urllib.request
from pathlib import Path

import common

ROOT = Path(common.REPO)
OUT = Path(common.HERE) / "weapon_of_destiny.json"
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "deeparam-sim"
BASE = "https://raw.communitydragon.org/latest"
AUGMENT = "{12154b4d}"  # Augment_WeaponOfDestiny's spell object in kiwi.bin
AUGMENT_ID = 3081
BEST = 3  # champions listed per item

# How much each stat is worth to upgrade, for the anticipated ranking: stats that multiply all your damage
# count most, then penetration and crit or attack speed, then healing; everything else (AD, AP, Health ...) 1.
VALUE = {
    "crit_damage": 3, "armor_pen": 3, "magic_pen_pct": 3,
    "lethality": 2, "magic_pen": 2, "crit": 2, "as": 2,
    "lifesteal": 1.5, "omnivamp": 1.5, "heal_shield_power": 1.5,
}

# Upgradeable stat -> (the augment's DataValue, the item bin's stat field), keyed like the simulator's stats.
UPGRADES = {
    "ad": ("UpgradeAD", "mFlatPhysicalDamageMod"),
    "ap": ("UpgradeAP", "mFlatMagicDamageMod"),
    "as": ("UpgradeAS", "mPercentAttackSpeedMod"),
    "crit": ("UpgradeCritChance", "mFlatCritChanceMod"),
    "crit_damage": ("UpgradeCritDamage", "mFlatCritDamageMod"),
    "ah": ("UpgradeAH", "mAbilityHasteMod"),
    "hp": ("UpgradeHealth", "mFlatHPPoolMod"),
    "mana": ("UpgradeMana", "flatMPPoolMod"),
    "armor": ("UpgradeAR", "mFlatArmorMod"),
    "mr": ("UpgradeMR", "mFlatSpellBlockMod"),
    "lethality": ("UpgradeArmorPenFlat", "PhysicalLethality"),
    "magic_pen": ("UpgradeMagicPenFlat", "mFlatMagicPenetrationMod"),
    "armor_pen": ("UpgradeArmorPenPercent", "mPercentArmorPenetrationMod"),
    "magic_pen_pct": ("UpgradeMagicPenPercent", "mPercentMagicPenetrationMod"),
    "lifesteal": ("UpgradeLifesteal", "mPercentLifeStealMod"),
    "omnivamp": ("UpgradeOmnivamp", "PercentOmnivampMod"),
    "ms_pct": ("UpgradeMSPercent", "mPercentMovementSpeedMod"),
    "heal_shield_power": ("UpgradeHSPower", "mPercentHealingAmountMod"),
}


def fetch(path):
    """A CommunityDragon file, cached like the simulator's own builders."""
    f = CACHE / "wod" / path.replace("/", "_")
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{BASE}/{path}", timeout=120) as r:
            f.write_bytes(r.read())
    return json.loads(f.read_text())


def augment_values():
    spell = fetch("game/maps/modespecificdata/kiwi.bin.json")[AUGMENT]["mSpell"]["DataValues"]
    dv = {v["name"]: v["values"][0] for v in spell}
    share = dv["GoldValue"] / dv["BaselineGoldAmp"]
    return dv, {k: dv[name] * share for k, (name, _) in UPGRADES.items()}


def first_legendary(build, legendary):
    """{item id: (share of the champion's core builds whose first Legendary item it is, their win rate minus
    the champion's average over its core builds)}."""
    counts, wins = {}, {}
    for e in build.get("items", {}).get("core", []):
        first = next((i for i in e["items"] if i in legendary), None)
        if first:
            counts[first] = counts.get(first, 0) + e["pick_rate"]
            wins[first] = wins.get(first, 0) + e["pick_rate"] * e["win_rate"]
    total = sum(counts.values())
    if not total:
        return {}
    base = sum(wins.values()) / total
    return {i: (c / total, wins[i] / c - base) for i, c in counts.items()}


def taken(build):
    """How often the champion takes Weapon of Destiny, from its augment lists (0 while it has no games)."""
    lists = build.get("augments", {})
    rows = lists.get("all") or [a for k in ("silver", "gold", "prismatic") for a in lists.get(k, [])]
    return sum(a.get("pick_rate", 0) for a in rows if a.get("id") == AUGMENT_ID)


def main():
    dv, full = augment_values()
    bins = fetch("game/items.cdtb.bin.json")
    sim_items = common.load(os.path.join(common.REPO, "simulator", "data", "items.json"))["items"]
    legendary = {v["id"] for v in sim_items.values() if v.get("slot") == "legendary"}
    stats = {
        gid: [k for k, (_, field) in UPGRADES.items() if bins.get(f"Items/{gid}", {}).get(field)] for gid in legendary
    }
    stats = {gid: s for gid, s in stats.items() if s}

    # Rarity of each stat among Legendary items, and each item's average over its stats.
    have = {k: sum(k in s for s in stats.values()) for k in UPGRADES}
    rarity = {k: math.log2(len(stats) / n) for k, n in have.items() if n}
    rare = {gid: sum(rarity[k] for k in s) / len(s) for gid, s in stats.items()}

    # Who takes it: pick rate x how often they take the augment, or while it has no games, pick rate x
    # takedowns per game (the estimated profile's kills + assists).
    profiles = common.load(os.path.join(common.HERE, "estimates.json"))["profiles"]
    champs = common.champion_stats()
    builds = common.builds()
    anticipated = not any(taken(b) for b in builds.values())
    weight, picks = {}, {}
    for cid, c in champs.items():
        p, b = profiles.get(cid), builds.get(cid)
        if not b or (anticipated and not p):
            continue
        firsts = first_legendary(b, legendary)
        w = c["pick_rate"] * (p["kills"]["value"] + p["assists"]["value"] if anticipated else taken(b))
        if firsts and w:
            weight[cid] = w
            picks[cid] = firsts
    total = sum(weight.values())
    share, lift, by = {}, {}, {}
    for cid, firsts in picks.items():
        for gid, (s, l) in firsts.items():
            part = weight[cid] / total * s
            share[gid] = share.get(gid, 0) + part
            lift[gid] = lift.get(gid, 0) + part * l
            by.setdefault(gid, []).append((part, champs[cid]["name"]))

    ids = common.load(os.path.join(common.REPO, "web", "src", "data", "champion-ids.json"))
    alias = {str(v): k for k, v in ids.items()}
    names = {c["name"]: alias.get(cid, c["name"]) for cid, c in champs.items()}
    out = {
        "patch": common.live_patch(),
        # No champion takes it in the feed yet: rank by valuable stats, labelled Anticipated.
        "anticipated": anticipated,
        "gold_per_takedown": dv["GoldValue"],
        "rarity": {k: round(v, 3) for k, v in sorted(rarity.items(), key=lambda kv: -kv[1])},
        "items": {
            str(gid): {
                "per_takedown": {k: round(full[k] / len(s), 5) for k in s},
                "share": round(share.get(gid, 0), 5),
                # Win rate as the first Legendary item minus what the same champions win with their other
                # first items, weighted like share (null when no champion buys it first).
                "lift": round(lift[gid] / share[gid], 5) if share.get(gid) else None,
                "rare": round(rare[gid], 3),
                "value": round(sum(rarity[k] * VALUE.get(k, 1) for k in s) / len(s), 3),
                "best": [names[n] for _, n in sorted(by.get(gid, []), reverse=True)[:BEST]],
            }
            for gid, s in sorted(stats.items())
        },
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"{len(stats)} items, {len(weight)} champions, anticipated={anticipated} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
