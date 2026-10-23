#!/usr/bin/env python3
"""Weapon of Destiny item ranking, for the Tier List's Weapon of Destiny tab.

Weapon of Destiny (gold augment 3081) turns your first Legendary item into the Weapon of Destiny: each
champion takedown adds GoldValue (200) gold worth of that item's own upgradeable stats, shared equally
among them. The augment's spell data (game/maps/modespecificdata/kiwi.bin) holds how much of each stat
BaselineGoldAmp (1,000) gold buys (UpgradeAD 30, UpgradeHealth 375, ...), so one takedown on an item
with N upgradeable stats adds Upgrade<stat> x GoldValue / BaselineGoldAmp / N of each.

For every Legendary item the simulator models, take the champions who buy it first most often (the order
in data/cn/builds core builds, falling back to how often they build it at all) and their simulated best
build (simulator/viewer/replay-data/best-builds.json) with the item in it. Simulate that build once as is
and once with the item carrying TAKEDOWNS takedowns' worth of upgrades. The differences in damage per
second and time alive are what the upgrades are worth to that champion.

Needs the native simulator: `make -C simulator mayhem_sim`. Run from the repo root:
    python3 data/estimates/weapon_of_destiny.py
Writes data/estimates/weapon_of_destiny.json. Takes about two minutes on 4 cores.
"""

import json
import os
import statistics
import subprocess
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIM_DIR = ROOT / "simulator"
SIM = SIM_DIR / "mayhem_sim"
OUT = Path(__file__).resolve().parent / "weapon_of_destiny.json"
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "deeparam-sim"
BASE = "https://raw.communitydragon.org/latest"
AUGMENT = "{12154b4d}"  # Augment_WeaponOfDestiny's spell object in kiwi.bin
TOP = 5  # champions per item
TRIALS = "2000"
SEED = "7"

# Upgradeable stat -> (the augment's DataValue, the item bin's stat field). Simulator stat keys; ms_pct and
# heal_shield_power sit under an item's effects in simulator/data/items.json, the rest under stats.
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
EFFECT_STATS = {"ms_pct", "heal_shield_power"}
PERCENT = {"as", "crit", "crit_damage", "armor_pen", "magic_pen_pct", "lifesteal", "omnivamp", "ms_pct", "heal_shield_power"}


def load(path):
    return json.loads((ROOT / path).read_text())


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


def per_takedown(record, full):
    """{stat: amount one takedown adds} for an item's bin record."""
    have = [k for k, (_, field) in UPGRADES.items() if record.get(field)]
    return {k: full[k] / len(have) for k in have}


def first_rates(cid):
    """{item id: share of games it's the first item in a core build, else its build rate / 3}."""
    f = ROOT / "data" / "cn" / "builds" / f"{cid}.json"
    if not f.exists():
        return {}
    items = json.loads(f.read_text()).get("items", {})
    first, built = {}, {}
    for e in items.get("core", []):
        if e["items"]:
            first[e["items"][0]] = first.get(e["items"][0], 0) + e["pick_rate"]
    for e in items.get("other", []):
        if len(e["items"]) == 1:
            built[e["items"][0]] = e["pick_rate"]
    return {i: first.get(i, 0) + built.get(i, 0) / 100 for i in set(first) | set(built)}


def main():
    if not SIM.exists():
        sys.exit("Build the simulator first: make -C simulator mayhem_sim")
    dv, full = augment_values()
    bins = fetch("game/items.cdtb.bin.json")
    items_file = load("simulator/data/items.json")
    sim_items = items_file["items"]
    legendary = {v["id"]: k for k, v in sim_items.items() if v.get("slot") == "legendary"}
    gains = {gid: per_takedown(bins.get(f"Items/{gid}", {}), full) for gid in legendary}
    gains = {gid: g for gid, g in gains.items() if g}

    # Half a typical game's takedowns: the stacks an item carries on average over a game.
    profiles = load("data/estimates/estimates.json")["profiles"]
    takedowns = round(statistics.median(p["kills"]["value"] + p["assists"]["value"] for p in profiles.values()) / 2)

    # Each item's upgraded copy, as an extra item the simulator can be handed by key.
    upgraded = dict(sim_items)
    for gid, g in gains.items():
        slug = legendary[gid]
        item = json.loads(json.dumps(sim_items[slug]))
        for k, v in g.items():
            box = item.setdefault("effects" if k in EFFECT_STATS else "stats", {})
            box[k] = box.get(k, 0) + v * takedowns
        upgraded[f"wod_{slug}"] = item

    best = {c["champion"].lower(): c for c in load("simulator/viewer/replay-data/best-builds.json")["champions"]}
    ids = load("web/src/data/champion-ids.json")
    builders = {}
    for alias, cid in ids.items():
        c = best.get(alias.lower())
        if not c:
            continue
        for gid, rate in first_rates(cid).items():
            if gid in gains:
                builders.setdefault(gid, []).append((rate, c))

    jobs = []
    for gid, rows in builders.items():
        slug = legendary[gid]
        for rate, c in sorted(rows, key=lambda r: -r[0])[:TOP]:
            items, augs = c["build"]["items"], c["build"]["augments"]
            # Builds without the item swap it in for one of their items, last first, skipping swaps the
            # shop doesn't allow (two Hydras, two Last Whisper items).
            tries = [items] if slug in items else [items[:k] + [slug] + items[k + 1:] for k in reversed(range(len(items)))
                                                    if sim_items.get(items[k], {}).get("slot") != "boots"]
            jobs.append((gid, c["champion"], tries, augs, rate))

    with tempfile.TemporaryDirectory() as tmp:
        for name in ("champions.json", "augments.json", "augment_pools.json"):
            os.symlink(SIM_DIR / "data" / name, Path(tmp) / name)
        (Path(tmp) / "items.json").write_text(json.dumps({**items_file, "items": upgraded}))

        def dps(champ, items, augs):
            out = subprocess.run(
                [str(SIM), "--champ", champ, "--items", ",".join(items), "--augs", ",".join(augs), "--game-data", tmp,
                 "--trials", TRIALS, "--seed", SEED, "--threads", "1", "--json"],
                capture_output=True, text=True, check=True, cwd=SIM_DIR,
            ).stdout
            s = json.loads(out)["builds"][0]["summary"]
            return s["mean_dps"], s["time_alive"]

        def run(job):
            gid, champ, tries, augs, rate = job
            slug = legendary[gid]
            for items in tries:
                try:
                    (b, ba) = dps(champ, items, augs)
                    (u, ua) = dps(champ, [f"wod_{slug}" if i == slug else i for i in items], augs)
                    break
                except (subprocess.CalledProcessError, KeyError, json.JSONDecodeError):
                    continue
            else:
                print(f"skip {champ} {gid}: no build with it runs", file=sys.stderr)
                return None
            return gid, {"champ": champ, "first": round(rate, 4), "dps": round(b), "up_dps": round(u),
                         "alive": round(ba, 1), "up_alive": round(ua, 1)}

        sims = {}
        with ThreadPoolExecutor() as pool:
            for r in pool.map(run, jobs):
                if r:
                    sims.setdefault(r[0], []).append(r[1])

    patch = (SIM_DIR / "data" / "tuned_patch.txt").read_text().strip()
    out = {
        "patch": patch,
        "takedowns": takedowns,
        "gold_per_takedown": dv["GoldValue"],
        "items": {
            str(gid): {"per_takedown": {k: round(v, 5) for k, v in g.items()}, "sims": sims.get(gid, [])}
            for gid, g in sorted(gains.items())
        },
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(gains)} items, {sum(map(len, sims.values()))} champion builds, {takedowns} takedowns -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
