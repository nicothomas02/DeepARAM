#!/usr/bin/env python3
"""Fill data/augments.json with the live patch's Mayhem augment values.

Everything comes from the game's own client files on the live patch, via
CommunityDragon's latest/ (never pbe/):
  - game/maps/modespecificdata/kiwi.bin.json: every Mayhem (Kiwi) AugmentData
    entry, with AugmentPlatformId (the augment id), rarity (absent/0 silver,
    1 gold, 2 prismatic) and RootSpell, whose mSpell holds the augment's numbers
    (DataValues) and tooltip formulas (mSpellCalculations).
  - v1/cherry-augments.json (the client's augment list): names by id.

data/augments.json says which augments the simulator models and how (effect
keys, see README.md). For each augment, MAPPING below says where each stat or
effect value lives in the augment's spell and how its units convert. Values with
no client equivalent (assumed takedowns, stacks or Poros fed, the Poro wave's
shape) stay hand-written with a note. Every value that changes is printed.

    python3 simulator/tools/build_augments.py [--dry-run]

Python 3 standard library only. Downloads are cached in ~/.cache/deeparam-sim.
"""

import argparse
import json
import os
import sys
import time
import re
import urllib.request

import augment_effects as AE

HERE = os.path.dirname(os.path.abspath(__file__))
# --pbe builds the PBE (test server) patch instead, into data/pbe/, for the simulator's optional
# PBE mode. The live patch stays the default everywhere.
PBE = "--pbe" in sys.argv
if PBE:
    sys.argv.remove("--pbe")
OUT = os.path.join(HERE, "..", "data", "pbe" if PBE else "", "augments.json")
# The PBE file starts from the live one (same augments and hand-written values) the first time.
SOURCE = OUT if os.path.exists(OUT) else os.path.join(HERE, "..", "data", "augments.json")
DEFAULT_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-sim", "pbe" if PBE else "")

CDRAGON = "https://raw.communitydragon.org/" + ("pbe" if PBE else "latest")
CONTENT_METADATA = CDRAGON + "/content-metadata.json"
KIWI_BIN = CDRAGON + "/game/maps/modespecificdata/kiwi.bin.json"
AUGMENT_LIST = CDRAGON + "/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json"

RARITY = ["silver", "gold", "prismatic"]
STAT_AP, STAT_AD = 0, 2           # mStat ids in GameCalculation parts (12 = max health)
STAT_FORMULA_BONUS = 2            # mStatFormula: bonus part of the stat

# Hand-written assumptions (no client equivalent).
EROSION_STACKS = 15     # average Erosion stacks held on a target mid-fight (of MaxStacks)
TANK_ENGINE_STACKS = 10 # late-game takedowns, before stacks lost on death
# Wave milestones hard-coded in src/champ.cpp poroCharge(); checked against the client.
PORO_WAVES_IN_SIM = [5, 12, 20, 30, 44, 63, 90, 129, 187, 275]


def fnv1a(s):
    h = 0x811C9DC5
    for c in s.lower().encode():
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return "{%08x}" % h


class Spell:
    """One augment's spell: DataValues by name, calculations by name or hashed name."""

    def __init__(self, kiwi, path):
        self.kiwi = kiwi
        self.path = path
        self.sp = (kiwi.get(path) or {}).get("mSpell") or {}
        self.values = {}
        self.varying = set()
        for d in self.sp.get("DataValues") or []:
            v = d.get("values") or [0.0]
            if len(set(v)) != 1:  # only an error if a value source reads it
                self.varying.add(d["name"])
            self.values[d["name"]] = v[0]

    def calc(self, name):
        c = self.sp.get("mSpellCalculations") or {}
        return c.get(name) or c.get(fnv1a(name))

    def additional(self, suffix):
        return Spell(self.kiwi, self.path.rsplit("/", 1)[0] + "/" + suffix)


# --- value sources: each returns (value, description) or (None, reason) -------------------

def dv(name, scale=1.0):
    def f(s):
        if name not in s.values:
            return None, f"DataValue {name} missing"
        if name in s.varying:
            raise SystemExit(f"{s.path}: DataValue {name} varies by level; mapping needs a level")
        return s.values[name] * scale, f"{name}" + (f" x {scale:g}" if scale != 1.0 else "")
    return f


def dv_times(name, factor, why):
    """DataValue times a hand-written assumption."""
    def f(s):
        if name not in s.values:
            return None, f"DataValue {name} missing"
        return s.values[name] * factor, f"{name} x {factor:g} ({why})"
    return f


def calc_coef_times_dv(calc, stat, stat_formula, name):
    """A stat coefficient inside a per-second calculation, times a duration DataValue."""
    def f(s):
        c = s.calc(calc)
        if not c or name not in s.values:
            return None, f"calculation {calc} or DataValue {name} missing"
        for p in c.get("mFormulaParts") or []:
            if (p.get("__type") == "StatByCoefficientCalculationPart" and p.get("mStat", 0) == stat
                    and p.get("mStatFormula", 0) == stat_formula):
                return p["mCoefficient"] * s.values[name], f"{calc} coefficient (stat {stat}) x {name}"
        return None, f"no stat-{stat} coefficient in {calc}"
    return f


def calc_part(calc, part_type, field):
    def f(s):
        c = s.calc(calc)
        for p in (c or {}).get("mFormulaParts") or []:
            if p.get("__type") == part_type:
                return p[field], f"{calc} {part_type}.{field}"
        return None, f"{calc} has no {part_type}"
    return f


def spell_field(field):
    def f(s):
        v = s.sp.get(field)
        if not v:
            return None, f"spell field {field} missing"
        return v[0], f"spell {field}"
    return f


def missile_speed(suffix):
    def f(s):
        m = s.additional(suffix).sp.get("mMissileSpec") or {}
        v = (m.get("movementComponent") or {}).get("mSpeed")
        return (v, f"{suffix} missile speed") if v else (None, f"{suffix} has no missile speed")
    return f


# augments.json key -> "stats.<key>" / "effects.<key>" -> source. Only mappings whose
# meaning and units clearly match the simulator's key; the rest stay hand-written.
MAPPING = {
    "deft": {"stats.as": dv("AttackSpeed")},                       # bonus attack speed, fraction
    # Witchful Thinking: 20-80 AP by level from the tooltip's calculation (confirmed in game), kept by
    # hand as ap_min/ap_max; the spell's DataValue APFlat = 70 isn't what the game grants.
    "witchful_thinking": {},
    "heavy_hitter": {"effects.onhit_own_hp": dv("HealthPercent")},  # share of own max HP on hit
    "erosion": {
        "effects.armor_shred": dv_times("Shred", EROSION_STACKS, "stacks assumed"),
        "effects.mr_shred": dv_times("Shred", EROSION_STACKS, "stacks assumed"),
    },
    "its_critical": {"stats.crit": dv("CritChance")},
    "tank_engine": {"effects.hp_pct": dv_times("MaxHPIncrement", TANK_ENGINE_STACKS, "takedowns assumed")},
    "magic_missile": {
        "effects.missile_count": dv("NumberOfMissiles"),
        "effects.missile_max_hp": dv("MaxHealthDamagePerMissile"),
        "effects.missile_cd": dv("Cooldown"),
    },
    "mystic_punch": {"effects.attack_cdr_flat": dv("CooldownRefund"), "effects.attack_cdr_min": dv("MinCDR")},  # seconds per attack; no lower than MinCDR of the full cooldown
    "goliath": {"effects.hp_pct": dv("HealthAmp"), "effects.adaptive_amp": dv("AFAmp")},
    "jeweled_gauntlet": {
        "stats.crit": dv("CritChance"),                  # the flat part of CritGranted
        "effects.ability_crit_damage": dv("CritDamage"),  # ability crits deal this share of damage
    },
    "dual_wield": {
        "effects.total_as_mult": dv("AttackSpeed"),       # "total Attack Speed"
        "effects.second_bolt": dv("AttackReduction"),     # bolt deals this share of AD (calc: AD x AttackReduction)
        "effects.second_bolt_onhit": dv("OnHitMod"),
    },
    "infernal_conduit": {
        # The sim deals a whole burn per application: per-second coefficient x BleedDuration.
        "effects.conduit_ap": calc_coef_times_dv("BleedDamagePerSecond", STAT_AP, 0, "BleedDuration"),
        "effects.conduit_ad": calc_coef_times_dv("BleedDamagePerSecond", STAT_AD, STAT_FORMULA_BONUS, "BleedDuration"),
        "effects.conduit_duration": dv("BleedDuration"),
        "effects.conduit_cdr_per_tick": dv("FlatCooldownRefundPerTick"),
    },
    "eureka": {"effects.ah_per_ap": dv("APToHasteConversion")},
    "poro_stampede": {
        "effects.poro_cd": spell_field("cooldownTime"),
        "effects.poro_min": calc_part("Damage", "ByCharLevelInterpolationCalculationPart", "mStartValue"),
        "effects.poro_max": calc_part("Damage", "ByCharLevelInterpolationCalculationPart", "mEndValue"),
        "effects.poro_per_fed": calc_part("Damage", "BuffCounterByCoefficientCalculationPart", "mCoefficient"),
        "effects.poro_repeat": dv("DamageReductionIfAlreadyHit"),  # share of damage on later waves
        "effects.poro_speed": missile_speed("Augment_PoroCharge_Active_PoroMissile"),
    },
}

# Notes for values that stay hand-written or for client numbers the sim doesn't model.
# {name} placeholders are filled from the augment's DataValues.
NOTES = {
    "witchful_thinking": "20-80 AP by level, as the tooltip shows (confirmed in game); the spell's unused "
                         "DataValue APFlat is {APFlat:g}",
    "erosion": "{Shred_pct:g}% Armor and Magic Resist shred per stack for {ShredDuration:g} s, up to {MaxStacks:g} "
               "stacks; " + f"{EROSION_STACKS} stacks assumed as the mid-fight average",
    "tank_engine": "{MaxHPIncrement_pct:g}% max Health per takedown, {PercentOfStacksLost_pct:g}% of stacks lost on "
                   "death; " + f"{TANK_ENGINE_STACKS} late-game takedowns assumed",
    "magic_missile": "Up to {MaxHealthDamageTooltip:g}% max Health true damage in all; the sim assumes full "
                     "distance traveled",
    "jeweled_gauntlet": "Also grants {CritConverRatio_pct:g}% crit chance per AP (CritGranted), not modeled",
    "infernal_conduit": "Burn per second is 2-20 by level + 1.2% AP + 2.8% bonus AD for {BleedDuration:g} s; "
                        "the level-based part is not modeled",
}


# --- every other augment: tools/augment_effects.py -------------------------------------------

# GameCalculation stat parts: (mStat, mStatFormula) -> amount key (formula 0 total, 2 bonus).
STAT_PARTS = {(0, 0): "ap", (0, 2): "ap", (2, 0): "ad", (2, 2): "bonus_ad", (12, 0): "own_hp", (12, 2): "bonus_hp",
              (1, 2): "bonus_armor", (6, 2): "bonus_mr"}


def breakpoints_at(p, level):
    v = p.get("mLevel1Value", 0.0) + p.get("mInitialBonusPerLevel", 0.0) * (level - 1)
    for b in p.get("mBreakpoints") or []:
        if b.get("mLevel", 99) <= level:
            v += b.get("mAdditionalBonusAtThisLevel", 0.0)
    return v


def calc_amounts(spell, name):
    """A spell calculation as amount keys: flat, flat_l1/flat_l18 (by level), ap, ad, bonus_ad..."""
    c = spell.calc(name)
    if not c:
        raise ValueError(f"calculation {name} missing")
    if c.get("__type") == "GameCalculationModified":
        out = calc_amounts(spell, c["mModifiedGameCalculation"])
    else:
        out = {}
        for p in c.get("mFormulaParts") or []:
            t = p.get("__type", "")
            if t == "ByCharLevelInterpolationCalculationPart":
                out["flat_l1"] = out.get("flat_l1", 0) + p.get("mStartValue", 0.0)
                out["flat_l18"] = out.get("flat_l18", 0) + p.get("mEndValue", 0.0)
            elif t == "ByCharLevelBreakpointsCalculationPart":
                out["flat_l1"] = out.get("flat_l1", 0) + breakpoints_at(p, 1)
                out["flat_l18"] = out.get("flat_l18", 0) + breakpoints_at(p, 18)
            elif t == "NamedDataValueCalculationPart":
                out["flat"] = out.get("flat", 0) + spell.values[p["mDataValue"]]
            elif t == "NumberCalculationPart":
                out["flat"] = out.get("flat", 0) + p.get("mNumber", 0.0)
            elif t in ("StatByCoefficientCalculationPart", "StatByNamedDataValueCalculationPart"):
                key = STAT_PARTS.get((p.get("mStat", 0), p.get("mStatFormula", 0)))
                if key is None:
                    raise ValueError(f"{name}: stat {p.get('mStat', 0)}/{p.get('mStatFormula', 0)} has no amount key")
                coef = p["mCoefficient"] if "mCoefficient" in p else spell.values[p["mDataValue"]]
                out[key] = out.get(key, 0) + coef
            else:
                raise ValueError(f"{name}: part {t} not supported")
    mult = c.get("mMultiplier")
    if mult:
        if mult.get("__type") == "NumberCalculationPart":
            f = mult.get("mNumber", 1.0)
        elif mult.get("__type") == "NamedDataValueCalculationPart":
            f = spell.values[mult["mDataValue"]]
        else:
            raise ValueError(f"{name}: multiplier {mult.get('__type')} not supported")
        out = {k: v * f for k, v in out.items()}
    if "flat_l1" in out and out.get("flat"):  # a constant beside a level range: fold it in
        out["flat_l1"] += out["flat"]
        out["flat_l18"] += out.pop("flat")
    return out


def resolve(spell, group):
    """A SPEC stats/effects dict with its value sources read from the augment's spell."""
    out = {}
    for k, v in group.items():
        if isinstance(v, AE.dv):
            if v.name not in spell.values:
                raise ValueError(f"DataValue {v.name} missing")
            if v.name in spell.varying:
                raise ValueError(f"DataValue {v.name} varies by level")
            out[k] = tidy(spell.values[v.name] * v.scale)
        elif isinstance(v, AE.calc):
            if not k.endswith("_"):
                raise ValueError(f"calc() on {k}: the key must end in _")
            for part, x in calc_amounts(spell, v.name).items():
                out[k + part] = tidy(x * v.scale)
        elif isinstance(v, AE.lvl):
            amounts = calc_amounts(spell, v.name)
            if set(amounts) - {"flat", "flat_l1", "flat_l18"}:
                raise ValueError(f"lvl({v.name}) scales with stats: {amounts}")
            if "flat" in amounts:
                out[k] = tidy(amounts["flat"] * v.scale)
            else:
                out[k + "_l1"] = tidy(amounts["flat_l1"] * v.scale)
                out[k + "_l18"] = tidy(amounts["flat_l18"] * v.scale)
        else:
            out[k] = v
    return out


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


NOT_MODELED_REASON = {aid: why for why, ids in AE.NOT_MODELED.items() for aid in ids}


def other_augment(aid, entry, kiwi, names):
    """An augment outside MAPPING: modeled from augment_effects.SPEC, or listed with no effect."""
    a = {"id": aid, "name": names.get(aid, {}).get("nameTRA") or entry["AugmentNameId"],
         "rarity": RARITY[entry.get("rarity", 0)]}
    spec = AE.SPEC.get(aid)
    if spec is None:
        why = NOT_MODELED_REASON.get(aid, "an effect the simulator doesn't model yet")
        a["note"] = f"No effect in the simulator: it depends on {why}"
        return a
    spell = Spell(kiwi, entry["RootSpell"])
    try:
        for g in ("stats", "effects"):
            if spec.get(g):
                a[g] = resolve(spell, spec[g])
    except ValueError as e:
        print(f"WARNING: {a['name']} ({aid}): {e}; left without an effect")
        a.pop("stats", None)
        a.pop("effects", None)
        a["note"] = "No effect in the simulator: its values couldn't be read"
        return a
    for k in ("spell_bind", "requires_item"):
        if k in spec:
            a[k] = spec[k]
    a["confidence"] = "approx" if spec.get("note") else "verified"
    if spec.get("note"):
        a["note"] = spec["note"][0].upper() + spec["note"][1:]
    return a


def poro_note(spell):
    waves = [int(spell.values[f"WaveRequirement{i}"]) for i in range(1, 11) if f"WaveRequirement{i}" in spell.values]
    cd2 = (spell.sp.get("Cooldown") or {}).get("values", [None])[0]
    alt = f"; the spell's newer Cooldown field says {cd2:g} s" if cd2 and cd2 != spell.sp["cooldownTime"][0] else ""
    return (f"Quest augment: feed Poros to unlock Poro Charge ({spell.sp['cooldownTime'][0]:g} s cooldown{alt}), "
            f"one wave per milestone ({', '.join(map(str, waves))} fed). Damage 100-200 by level + 20 per Poro fed, "
            f"physical; later waves deal {spell.values['DamageReductionIfAlreadyHit'] * 100:g}% to champions "
            "already hit (kiwi.bin PoroCharge_Active). Assumes the quest is done with 20 Poros fed (3 waves). "
            "Wave length, width and spacing are estimates from the Poro missile (speed 900, radius 210); "
            f"the first wave's {spell.values['SlowStrength'] * 100:g}% slow is not modeled."), waves


def tidy(v):
    """Round off float32 noise (0.6000000238 -> 0.6) and write whole numbers as ints."""
    v = float(f"{v:.6g}")
    return int(v) if v.is_integer() else v


def fetch(url, cache_dir, name, refresh):
    path = os.path.join(cache_dir, name)
    if not refresh and os.path.exists(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-sim"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    os.makedirs(cache_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return json.loads(data)


def dump(doc):
    """Compact layout: one augment per line."""
    lines = ["{", f' "_note": {json.dumps(doc["_note"], ensure_ascii=False)},', ' "augments": {']
    items = list(doc["augments"].items())
    for i, (k, a) in enumerate(items):
        sep = "," if i < len(items) - 1 else ""
        lines.append(f"  {json.dumps(k)}: {json.dumps(a, ensure_ascii=False)}{sep}")
    lines += [" }", "}"]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--refresh", action="store_true", help="ignore cached downloads")
    ap.add_argument("--dry-run", action="store_true", help="print changes without writing")
    args = ap.parse_args()

    meta = fetch(CONTENT_METADATA, args.cache, "content-metadata.json", True)
    kiwi = fetch(KIWI_BIN, args.cache, "kiwi.bin.json", args.refresh)
    names = {a["id"]: a for a in fetch(AUGMENT_LIST, args.cache, "cherry-augments.json", args.refresh)}
    patch = meta.get("version", "?")
    print(f"{'PBE' if PBE else 'live'} patch {patch}")

    by_id = {a["AugmentPlatformId"]: a for a in kiwi.values()
             if isinstance(a, dict) and a.get("__type") == "AugmentData" and a.get("AugmentPlatformId")}

    with open(SOURCE) as f:
        doc = json.load(f)

    changes, unmapped = [], []
    for key, aug in list(doc["augments"].items()):
        if key not in MAPPING:  # rebuilt below from augment_effects.py
            continue
        entry = by_id.get(aug["id"])
        if not entry and PBE:  # taken out on the PBE patch
            print(f"{key}: augment id {aug['id']} is not on the PBE patch, left out")
            del doc["augments"][key]
            continue
        if not entry:
            raise SystemExit(f"{key}: augment id {aug['id']} is not in the live kiwi.bin")
        spell = Spell(kiwi, entry["RootSpell"])

        def setv(field, new):
            old = aug.get(field)
            if old != new:
                changes.append(f"{key}.{field}: {old} -> {new}")
                aug[field] = new

        setv("name", names.get(aug["id"], {}).get("nameTRA") or aug["name"])
        setv("rarity", RARITY[entry.get("rarity", 0)])

        mapping = MAPPING.get(key)
        if mapping is None:
            raise SystemExit(f"{key}: no entry in MAPPING")
        hand = []
        for group in ("stats", "effects"):
            for k, old in (aug.get(group) or {}).items():
                src = mapping.get(f"{group}.{k}")
                if not src:
                    hand.append(f"{group}.{k}")
                    continue
                v, how = src(spell)
                if v is None:
                    raise SystemExit(f"{key}.{group}.{k}: {how}")
                new = tidy(v)
                print(f"  {key}.{group}.{k} <- {how} = {new}")
                if new != old:
                    changes.append(f"{key}.{group}.{k}: {old} -> {new}")
                    aug[group][k] = new
        for k in mapping:
            g, e = k.split(".")
            if e not in (aug.get(g) or {}):
                raise SystemExit(f"{key}: MAPPING has {k}, which the augment doesn't use")
        assumed = key in ("erosion", "tank_engine", "poro_stampede")
        if hand:
            unmapped.append(f"{key}: {', '.join(hand)}")

        fmt = dict(spell.values)
        fmt.update({f"{n}_pct": tidy(v * 100) for n, v in spell.values.items()})
        note = NOTES.get(key, "").format(**fmt) if key in NOTES else None
        if key == "poro_stampede":
            note, waves = poro_note(spell)
            if waves != PORO_WAVES_IN_SIM:
                print(f"WARNING: Poro wave milestones in the client {waves} differ from src/champ.cpp {PORO_WAVES_IN_SIM}")
        setv("confidence", "approx" if assumed else "verified")
        if note:
            setv("note", note)
        elif "note" in aug:
            changes.append(f"{key}.note: removed")
            del aug["note"]
        # keep confidence/note last
        for k in ("confidence", "note"):
            if k in aug:
                aug[k] = aug.pop(k)

    # Every other augment on the patch (enabled ones only), from augment_effects.py.
    mapped_ids = {a["id"] for k, a in doc["augments"].items() if k in MAPPING}
    extra = {}
    for aid, entry in sorted(by_id.items()):
        if aid in mapped_ids or entry.get("Enabled") is False:
            continue
        a = other_augment(aid, entry, kiwi, names)
        if not slug(a["name"]):  # an unnamed placeholder (the PBE has one): no player can see or pick it
            continue
        extra[slug(a["name"])] = a
    for k in list(doc["augments"]):
        if k not in MAPPING:
            del doc["augments"][k]
    for k, a in sorted(extra.items()):
        if k in doc["augments"]:
            raise SystemExit(f"augment key {k} is used twice")
        doc["augments"][k] = a
    modeled = sum(1 for a in doc["augments"].values() if a.get("stats") or a.get("effects"))
    print(f"{len(doc['augments'])} augments, {modeled} with an effect in the simulator")

    doc["_note"] = (
        "Every enabled Mayhem augment on the patch. Ids, names, rarities and values are the client files "
        "(kiwi.bin, each augment's spell DataValues and calculations), filled in by tools/build_augments.py "
        "through MAPPING there and tools/augment_effects.py. An augment with no stats or effects has no effect "
        "in the simulator (its note says why). confidence is verified when every value is read from the client "
        "and approx when one rests on an assumption the note states. Effect keys: README.md.")

    print("\nhand-written values:")
    for u in unmapped:
        print("  " + u)
    print(f"\n{len(changes)} change(s):")
    for c in changes:
        print("  " + c)
    if args.dry_run:
        return
    with open(OUT, "w") as f:
        f.write(dump(doc))
    print(f"wrote {os.path.relpath(OUT)}")


if __name__ == "__main__":
    sys.exit(main())
