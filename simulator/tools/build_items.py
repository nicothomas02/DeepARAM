#!/usr/bin/env python3
"""Build data/items.json for the all-champion simulator.

Everything comes from the game's own client files on the live patch, via
CommunityDragon's latest/ (never pbe/):
  - v1/items.json (the client's item list): names and total gold cost.
  - game/items.cdtb.bin.json (the item bin): each item's stats (mFlat*Mod,
    mPercent*Mod, ...) and its passive numbers (mDataValues), with Riot's own
    per-mode DataValuesModeOverride applied, ARAM first and Mayhem (Kiwi) on top.

data/item_effects.json is hand-written: which items exist, their roles and their
passives as effect keys. Where an effect key maps to a DataValue in the bin
(BIN_EFFECTS below) the client value replaces the hand value; the hand value is
the fallback when the bin has nothing, and every changed value is logged.

    python3 simulator/tools/build_items.py

Python 3 standard library only. Downloads are cached in ~/.cache/deeparam-sim.
"""

import argparse
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# --pbe builds the PBE (test server) patch instead, into data/pbe/, for the simulator's optional
# PBE mode. The live patch stays the default everywhere.
PBE = "--pbe" in sys.argv
if PBE:
    sys.argv.remove("--pbe")
DATA = os.path.join(HERE, "..", "data")
OUT_DIR = os.path.join(DATA, "pbe") if PBE else DATA
DEFAULT_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-sim", "pbe" if PBE else "")

CDRAGON = "https://raw.communitydragon.org/" + ("pbe" if PBE else "latest")
CONTENT_METADATA = CDRAGON + "/content-metadata.json"
ITEM_LIST = CDRAGON + "/plugins/rcp-be-lol-game-data/global/default/v1/items.json"
ITEM_BIN = CDRAGON + "/game/items.cdtb.bin.json"

# Mode layers in Riot's DataValuesModeOverride, applied in order (Kiwi = Mayhem).
MODE_LAYERS = ("ARAM", "Kiwi")

# items.json stat key <- item bin field. Percent fields are already fractions.
BIN_STATS = {
    "ad": "mFlatPhysicalDamageMod",
    "ap": "mFlatMagicDamageMod",
    "as": "mPercentAttackSpeedMod",
    "crit": "mFlatCritChanceMod",
    "crit_damage": "mFlatCritDamageMod",
    "hp": "mFlatHPPoolMod",
    "armor": "mFlatArmorMod",
    "mr": "mFlatSpellBlockMod",
    "ah": "mAbilityHasteMod",
    "lethality": "PhysicalLethality",
    "armor_pen": "mPercentArmorPenetrationMod",
    "magic_pen": "mFlatMagicPenetrationMod",
    "magic_pen_pct": "mPercentMagicPenetrationMod",
    "lifesteal": "mPercentLifeStealMod",
    "omnivamp": "PercentOmnivampMod",
    "mana": "flatMPPoolMod",
    "mana_regen": "percentBaseMPRegenMod",
}


def dv(name, scale=1.0, offset=0.0):
    """Effect value = DataValue `name` * scale + offset."""
    return lambda vals, calcs: None if name not in vals else vals[name] * scale + offset


def dv_product(a, b):
    return lambda vals, calcs: None if a not in vals or b not in vals else vals[a] * vals[b]


def calc_number(name):
    """A tooltip calculation that is a single constant (e.g. Wit's End's on-hit)."""
    def f(vals, calcs):
        parts = calcs.get(name, {}).get("mFormulaParts", [])
        if len(parts) == 1 and parts[0].get("__type") == "NumberCalculationPart":
            return parts[0].get("mNumber", 0.0)
        return None
    return f


# items.json key -> effect key -> where its value lives in the item bin. Only
# mappings whose meaning and units clearly match the simulator's effect key;
# every other effect value stays hand-written in data/item_effects.json.
BIN_EFFECTS = {
    "navori": {"attack_cdr_pct": dv("CDRAmount")},
    "runaans": {"bolts_ad": dv("BoltMinPercent", 0.01)},
    "collector": {"execute": dv("ExecuteThreshold")},
    "essence_reaver": {"spellblade_cd": dv("SpellbladeCooldown")},
    "stormrazor": {"storm_magic": calc_number("TotalProcDamage")},
    # One value for every champion: the ranged one (the hand value was ARAM's ranged value).
    "botrk": {"onhit_cur_hp": dv("RangedValue")},
    "kraken": {"kraken_every": dv("AttackCount"), "kraken_missing_amp": dv("MaxAmpNumber", 1.0, -1.0)},
    "rageblade": {"onhit_magic": dv("OnHitDamage")},
    "nashors": {"onhit_magic": dv("NashorsBaseValue"), "onhit_magic_ap": dv("NashorsAPValue")},
    "wits_end": {"onhit_magic": calc_number("OnHitDamage")},
    "statikk": {"storm_magic": dv("ChainDamage")},
    "black_cleaver": {"cleaver_shred": dv_product("ShredPerStack", "MaxStacks")},
    "trinity": {"spellblade_base_ad": dv("SpellbladeMultiplier"), "spellblade_cd": dv("SpellbladeCooldown")},
    "eclipse": {"maxhp_proc_cd": dv("Cooldown"), "proc_shield_flat": dv("MeleeBaseShield"),
                "proc_shield_bonus_ad": dv("MeleeShieldADRatio"), "proc_shield_duration": dv("ShieldDuration"),
                "shield_ranged": dv("RangedShieldMult")},
    "heartsteel": {"heartsteel_flat": dv("BaseDamage"), "heartsteel_own_hp": dv("MaxHPRatio"), "heartsteel_cd": dv("PerTargetCooldown")},
    "overlords_bloodmail": {"ad_per_bonus_hp": dv("HPToADPercentage")},
    "thornmail": {"thorns_flat": dv("BaseDamage"), "thorns_bonus_armor": dv("BonusArmorDamageRatio")},
    "unending_despair": {"drain_bonus_hp": dv("BonusHealthDrainPercentage"), "drain_cd": dv("Cooldown"), "drain_range": dv("DrainRange")},
    "steraks": {"base_ad_pct": dv("ADtoAD"), "lifeline_bonus_hp": dv("BaseShieldRatio"),
                "lifeline_duration": dv("ShieldDuration"), "lifeline_threshold": dv("LowHealthThreshold"),
                "shield_ranged": dv("RangedEffectiveness")},
    "maw": {"lifeline_flat": dv("ShieldSize"), "lifeline_bonus_ad": dv("ShieldADScaling"),
            "lifeline_duration": dv("ShieldDuration"), "lifeline_threshold": dv("LowHealthThreshold"),
            "shield_ranged": dv("RangedShieldMod")},
    "rabadons": {"ap_amp": dv("APAmp")},
    "liandrys": {"burn_max_hp": dv("BurnPercentHealthDamage"), "burn_duration": dv("BurnDuration")},
    "blackfire": {"burn_flat": dv("BurnFlatDamagePerSecond"), "burn_ap": dv("APRatio"),
                  "burn_duration": dv("BurnDuration")},
    "ludens": {"proc_flat": dv("BaseDamage"), "proc_ap": dv("APRatio"), "proc_cd": dv("Cooldown")},
    "stormsurge": {"proc_flat": dv("BaseDamage"), "proc_ap": dv("APRatio"), "proc_cd": dv("Cooldown")},
    "lich_bane": {"spellblade_base_ad": dv("SpellbladeADRatio"), "spellblade_ap": dv("LichBaneAPValue"),
                  "spellblade_cd": dv("SpellbladeCooldown")},
    "riftmaker": {"damage_amp": dv("EternityDamageIncreaseMax")},
    "horizon_focus": {"damage_amp": dv("DamageAmp")},
    "rocketbelt": {"active_flat": dv("BaseDamage"), "active_ap": dv("APRatio"), "active_cd": dv("Cooldown")},
    "gunblade": {"active_cd": dv("Cooldown")},
    "iceborn": {"spellblade_base_ad": dv("SpellbladeMultiplier"), "spellblade_cd": dv("SpellbladeCooldown")},
}


def log(*a):
    print(*a, file=sys.stderr)


def fetch(url, cache_dir, name, tries=5):
    path = os.path.join(cache_dir, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "deeparam-sim"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read().decode("utf-8")
            break
        except Exception as e:  # connection resets happen; retry with backoff
            if i == tries - 1:
                raise RuntimeError(f"failed to fetch {url}: {e}") from e
            time.sleep(2 ** i)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return json.loads(body)


def clean(v):
    """Round off the bin's float32 noise (0.07999999821186066 -> 0.08)."""
    r = round(v, 4)
    return int(r) if r == int(r) and abs(r) >= 1 else r


def data_values(item):
    vals = {d["mName"]: d.get("mValue", 0.0) for d in item.get("mDataValues", [])}
    for mode in MODE_LAYERS:
        for d in item.get("DataValuesModeOverride", {}).get(mode, {}).get("DataValues", []):
            vals[d["mName"]] = d.get("mValue", 0.0)
    return vals


def bin_stats(item):
    return {k: clean(item[f]) for k, f in BIN_STATS.items() if item.get(f)}


# Stats the simulator reads as effect keys (move speed, tenacity, heal and shield power).
BIN_STAT_EFFECTS = {
    "ms": "mFlatMovementSpeedMod",
    "ms_pct": "mPercentMovementSpeedMod",
    "tenacity": "mPercentTenacityItemMod",
    "heal_shield_power": "mPercentHealingAmountMod",
}

# item_effects.json group -> items.json slot. Only boots and legendaries go into the build search;
# components, starters and the items augments hand out can be put in a build by hand.
GROUPS = {"boots": "boots", "items": "legendary", "components": "component", "starters": "starter",
          "rewards": "reward"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    args = ap.parse_args()
    meta = fetch(CONTENT_METADATA, args.cache, "content-metadata.json")
    version = ".".join(meta["version"].split(".")[:2])
    sub = f"items/{version}"
    listing = {it["id"]: it for it in fetch(ITEM_LIST, args.cache, f"{sub}/items.json")}
    bins = {v["itemID"]: v for v in fetch(ITEM_BIN, args.cache, f"{sub}/items.cdtb.bin.json").values()
            if isinstance(v, dict) and v.get("__type") == "ItemData" and "itemID" in v}
    with open(os.path.join(DATA, "item_effects.json"), encoding="utf-8") as f:
        hand = json.load(f)
    out, from_bin, changed = {}, 0, []
    for group, slot in GROUPS.items():
        for item_id, h in hand.get(group, {}).items():
            iid = int(item_id)
            it, b = listing.get(iid), bins.get(iid)
            if it is None or b is None:
                sys.exit(f"item {item_id} ({h['key']}) is not in the {version} client item data")
            stats = bin_stats(b)
            stats.update(h.get("stats", {}))
            for k, v in h.get("stats_add", {}).items():
                stats[k] = stats.get(k, 0) + v
            effects = {k: clean(b[f]) for k, f in BIN_STAT_EFFECTS.items() if b.get(f)}
            effects.update(h.get("effects", {}))
            vals, calcs = data_values(b), b.get("mItemCalculations", {})
            for key, getter in BIN_EFFECTS.get(h["key"], {}).items():
                v = getter(vals, calcs)
                if v is None:
                    log(f"  {h['key']}.{key}: not in the bin, keeping hand value {effects.get(key)}")
                    continue
                v = clean(v)
                from_bin += 1
                if key in effects and effects[key] != v:
                    changed.append(f"{h['key']}.{key}: {effects[key]} -> {v}")
                effects[key] = v
            out[h["key"]] = {
                "id": iid,
                "name": it["name"],
                "slot": slot,
                "cost": it["priceTotal"],
                "roles": h.get("roles", []),
                "stats": stats,
                "effects": effects,
                "confidence": h.get("confidence", "approx" if h.get("effects") else "verified"),
                # Items of one group (Last Whisper, Blight, Hydra, Lifeline) can't be bought together.
                **({"group": h["group"]} if h.get("group") else {}),
                **({"note": h["note"]} if h.get("note") else {}),
            }
    doc = {"meta": {"game_version": version,
                    "notes": ["stats: the game's item bin on this patch (verified). effects: data/item_effects.json "
                              "(passives; approx unless confidence says otherwise), with values the item bin holds "
                              "(Mayhem over ARAM over base) read from it."]},
           "items": out}
    path = os.path.join(OUT_DIR, "items.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    for c in changed:
        log("  changed " + c)
    print(f"wrote {len(out)} items to {os.path.relpath(path)} (patch {version}; "
          f"{from_bin} effect values from the item bin, {len(changed)} changed)")


if __name__ == "__main__":
    main()
