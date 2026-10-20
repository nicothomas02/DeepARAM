#!/usr/bin/env python3
"""Build data/champions.json: every champion's stats and ability damage for the
all-champion ARAM Mayhem simulator.

Sources (all fetched live, then cached; CommunityDragon's latest/ is the live patch):
  - The client's champion list (champion-summary.json) and per-champion game
    data (v1/champions/{id}.json: roles, cooldown fallbacks).
  - Each champion's bin: base stats (CharacterRecord), ability values,
    scalings, cooldowns, targeting, and Riot's own ARAM/Mayhem (Kiwi) overrides
    of ability values and cooldowns.
  - The English string table (tooltips, which say whether a number is magic,
    physical or true damage).
  - The official League wiki, only for the per-champion modifiers Riot applies
    on the server and ships in no client file (damage dealt/taken, healing,
    shielding, tenacity, ability haste, attack speed), read from
    data/wiki/mayhem_modifiers.json, which the guide shares.
  - simulator/data/cn_enemy_pool.json (built by build_enemy_pool.py): role,
    CC rating and China-server Mayhem damage shares, used to check results.

The ability parser is generic. It reads each ability's tooltip, finds every
number tagged as magic, physical or true damage, and evaluates the game's own
formula for it at level 18 with max ranks (R rank 3, others rank 5). That gets
most damage abilities right but not every special case (stacking passives,
empowered recasts, on-hit steroids, transformations). Each champion carries a
`parse_quality` and notes; data/champion_overrides.json fixes the ones that
matter most by hand.

    python3 simulator/tools/build_champion_pool.py
    python3 simulator/tools/build_champion_pool.py --only Ahri,Lux

Python 3 standard library only.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
# --pbe builds the PBE (test server) patch instead, into data/pbe/, for the simulator's optional
# PBE mode. The live patch stays the default everywhere.
PBE = "--pbe" in sys.argv
if PBE:
    sys.argv.remove("--pbe")
DATA = os.path.join(HERE, "..", "data")
DEFAULT_OUT = os.path.join(DATA, "pbe" if PBE else "", "champions.json")
DEFAULT_POOL = os.path.join(DATA, "cn_enemy_pool.json")
DEFAULT_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-sim", "pbe" if PBE else "")

CDRAGON = "https://raw.communitydragon.org/" + ("pbe" if PBE else "latest")
GAME_DATA = CDRAGON + "/plugins/rcp-be-lol-game-data/global/default/v1"
CONTENT_METADATA = CDRAGON + "/content-metadata.json"
STRINGTABLE = CDRAGON + "/game/en_us/data/menu/en_us/lol.stringtable.json"
CHAMP_BIN = CDRAGON + "/game/data/characters/{c}/{c}.bin.json"
# Per-champion Mayhem modifiers, read from the official wiki by the Info tools (shared with the guide).
MAYHEM_MODIFIERS = os.path.join(HERE, "..", "..", "data", "wiki", "mayhem_modifiers.json")

LEVEL = 18
RANKS = {"Q": 5, "W": 5, "E": 5, "R": 3}
DEFAULT_COOLDOWN, DEFAULT_R_COOLDOWN = 8.0, 90.0
DEFAULT_OVERRIDES = os.path.join(DATA, "champion_overrides.json")
DEFAULT_ANIMS = os.path.join(HERE, "..", "viewer", "replay-data", "anims.json")
DEFAULT_PASSIVES = os.path.join(DATA, "passives.json")
YUNARA_ID = 804

# Stat ids used by the game's ability formulas (mStat). Inferred from how
# abilities use them (e.g. 12 is max health on Braum Q, 29 lethality on Pyke R).
STAT = {0: "ap", 1: "armor", 2: "ad", 4: "as", 6: "mr", 8: "crit", 12: "hp", 29: "lethality"}
# mStatFormula: missing = total, 1 = base, 2 = bonus.

AOE_TARGETING = {"Area", "AreaClamped", "SelfAoe", "Cone", "Location", "LocationClamped", "TargetOrLocation", "Self"}
LINE_TARGETING = {"Direction", "DragDirection"}

# Words right before a damage number that mark it as an alternative to the
# main hit (an empowered or maximum version) rather than extra damage.
ALT_WORDS = ("up to", "increased to", "instead", "empowered", "maximum of", "minimum of", "at most")
# Formula names that are never champion damage.
SKIP_CALC = re.compile(r"minion|monster|structure|turret|tower|heal(?!th)|shield", re.I)
# Mode layers in Riot's DataValuesModeOverride, applied in order.
MODE_LAYERS = ("ARAM", "Kiwi")
# Per-mode cooldowns sit under this hashed key in each spell, with the same ARAM/Kiwi layers.
COOLDOWN_OVERRIDE = "{f9c2333e}"


def log(*a):
    print(*a, file=sys.stderr)


def fetch(url, cache_dir, name=None, tries=5):
    path = os.path.join(cache_dir, name) if name else None
    if path and os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding="utf-8") as f:
            return f.read()
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "deeparam-sim"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8")
            break
        except Exception as e:  # connection resets happen; retry with backoff
            if i == tries - 1:
                raise RuntimeError(f"failed to fetch {url}: {e}") from e
            time.sleep(2 ** i)
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    return body


def level_stat(base, per_level, level=LEVEL):
    n = level - 1
    return base + per_level * n * (0.7025 + 0.0175 * n)


# ---------------------------------------------------------------------------
# Formula evaluation: every part becomes a linear form {stat key: coefficient}
# with "const" for the flat part, at a fixed rank and champion level.
# ---------------------------------------------------------------------------

class Lin(dict):
    def __add__(self, o):
        r = Lin(self)
        for k, v in o.items():
            r[k] = r.get(k, 0.0) + v
        return r

    def scale(self, s):
        return Lin({k: v * s for k, v in self.items()})

    def const(self):
        return self.get("const", 0.0)

    def is_const(self):
        return all(k == "const" or abs(v) < 1e-12 for k, v in self.items())


class Evaluator:
    def __init__(self, spell, rank, base_stats, notes):
        self.spell = spell
        self.rank = rank
        self.base = base_stats  # level-18 base values: ad, hp, armor, mr (and mana)
        self.notes = notes
        self.values = {}
        self.mode_overrides = []

        def load(dvs, mode=None):
            for dv in dvs or []:
                name = dv.get("name") or dv.get("mName")
                vals = dv.get("values") or dv.get("mValues") or []
                if name and vals:
                    if mode and self.values.get(name.lower()) != vals:
                        self.mode_overrides.append(f"{mode}:{name}")
                    self.values[name.lower()] = vals

        load(spell.get("DataValues"))
        # Riot's own per-mode ability values: regular ARAM first, then Mayhem (Kiwi) on top.
        overrides = spell.get("DataValuesModeOverride") or {}
        for mode in MODE_LAYERS:
            load((overrides.get(mode) or {}).get("SpellDataValues"), mode)
        self.calcs = {k: v for k, v in (spell.get("mSpellCalculations") or {}).items()}
        self.calcs_lower = {k.lower(): v for k, v in self.calcs.items()}
        self.depth = 0

    def dv(self, name):
        vals = self.values.get((name or "").lower())
        if not vals:
            self.notes.add(f"missing value {name}")
            return 0.0
        return float(vals[min(self.rank, len(vals) - 1)])

    def stat(self, stat_id, formula, coef):
        key = STAT.get(stat_id)
        if key is None:
            self.notes.add(f"unsupported stat {stat_id}")
            return Lin()
        if key in ("as", "crit", "lethality"):
            return Lin({key: coef})
        if formula == 1:  # base only
            return Lin({"const": coef * self.base.get(key, 0.0)})
        if formula == 2:  # bonus only
            return Lin({"bonus_" + key if key != "ap" else "ap": coef})
        if key == "ap":
            return Lin({"ap": coef})
        return Lin({"const": coef * self.base.get(key, 0.0), "bonus_" + key: coef})

    def part(self, p):
        t = p.get("__type")
        if t == "NamedDataValueCalculationPart":
            return Lin({"const": self.dv(p.get("mDataValue"))})
        if t == "NumberCalculationPart":
            return Lin({"const": float(p.get("mNumber", 0.0))})
        if t == "StatByCoefficientCalculationPart":
            return self.stat(p.get("mStat", 0), p.get("mStatFormula", 0), float(p.get("mCoefficient", 0.0)))
        if t == "StatByNamedDataValueCalculationPart":
            return self.stat(p.get("mStat", 0), p.get("mStatFormula", 0), self.dv(p.get("mDataValue")))
        if t == "StatBySubPartCalculationPart":
            sub = self.part(p.get("mSubpart") or {})
            return self.stat(p.get("mStat", 0), p.get("mStatFormula", 0), sub.const())
        if t == "EffectValueCalculationPart":
            idx = int(p.get("mEffectIndex", 1)) - 1
            eff = self.spell.get("mEffectAmount") or []
            if 0 <= idx < len(eff):
                vals = eff[idx].get("value") or []
                if vals:
                    return Lin({"const": float(vals[min(self.rank, len(vals) - 1)])})
            return Lin()
        if t == "ByCharLevelInterpolationCalculationPart":
            a, b = float(p.get("mStartValue", 0.0)), float(p.get("mEndValue", 0.0))
            return Lin({"const": b if LEVEL >= 18 else a + (b - a) * (LEVEL - 1) / 17})
        if t == "ByCharLevelBreakpointsCalculationPart":
            v = float(p.get("mLevel1Value", 0.0))
            per = float(p.get("{02deb550}", p.get("mInitialBonusPerLevel", 0.0)) or 0.0)
            bps = sorted(p.get("mBreakpoints") or [], key=lambda b: b.get("mLevel", 0))
            for lvl in range(2, LEVEL + 1):
                for b in bps:
                    if b.get("mLevel") == lvl:
                        v += float(b.get("mAdditionalBonusAtThisLevel", 0.0))
                        # A breakpoint always sets the per-level bonus from here on; the
                        # bin omits it when it is 0 (Senna's passive stops growing at 11).
                        hashed = [x for k, x in b.items() if k.startswith("{")]
                        per = float(b.get("mBonusPerLevelAtAndAfter", hashed[0] if hashed else 0.0))
                v += per
            return Lin({"const": v})
        if t == "ByCharLevelFormulaCalculationPart":
            vals = p.get("values") or [0.0]
            return Lin({"const": float(vals[min(LEVEL - 1, len(vals) - 1)])})
        if t == "SumOfSubPartsCalculationPart":
            r = Lin()
            for s in p.get("mSubparts") or []:
                r = r + self.part(s)
            return r
        if t == "ProductOfSubPartsCalculationPart":
            a, b = self.part(p.get("mPart1") or {}), self.part(p.get("mPart2") or {})
            if a.is_const():
                return b.scale(a.const())
            if b.is_const():
                return a.scale(b.const())
            self.notes.add("product of two scalings simplified")
            return Lin({"const": a.const() * b.const()})
        if t == "ClampSubPartsCalculationPart":
            r = Lin()
            for s in p.get("mSubparts") or []:
                r = r + self.part(s)
            if r.is_const():
                c = min(max(r.const(), float(p.get("mFloor", -1e9))), float(p.get("mCeiling", 1e9)))
                return Lin({"const": c})
            return r
        if t in ("BuffCounterByNamedDataValueCalculationPart", "BuffCounterByCoefficientCalculationPart"):
            self.notes.add("stack-based scaling ignored")
            return Lin()
        if t == "CooldownMultiplierCalculationPart":
            return Lin({"const": 1.0})
        if t == "AbilityResourceByCoefficientCalculationPart":
            # Max mana: bonus mana (items) as bonus_mana; the base pool at level 18 as a constant.
            coef = float(p.get("mCoefficient", 0.0))
            if p.get("mStatFormula", 0) == 2:
                return Lin({"bonus_mana": coef})
            return Lin({"const": coef * self.base.get("mana", 0.0), "bonus_mana": coef})
        if t:
            self.notes.add(f"unsupported part {t}")
        return Lin()

    def calc(self, name):
        c = self.calcs.get(name) or self.calcs_lower.get((name or "").lower())
        if c is None:
            vals = self.values.get((name or "").lower())
            if vals:
                return Lin({"const": float(vals[min(self.rank, len(vals) - 1)])}), False
            return None, False
        if self.depth > 8:
            return None, False
        self.depth += 1
        try:
            t = c.get("__type")
            if t == "GameCalculationModified":
                base, pct = self.calc(c.get("mModifiedGameCalculation"))
                if base is None:
                    return None, False
                mult = self.part(c.get("mMultiplier") or {"__type": "NumberCalculationPart", "mNumber": 1.0})
                return base.scale(mult.const() if mult.is_const() else 1.0), pct
            if t == "GameCalculationConditional":
                return self.calc(c.get("mDefaultGameCalculation"))
            r = Lin()
            for p in c.get("mFormulaParts") or []:
                r = r + self.part(p)
            if c.get("mMultiplier"):
                m = self.part(c["mMultiplier"])
                if m.is_const():
                    r = r.scale(m.const())
            return r, bool(c.get("mDisplayAsPercent"))
        finally:
            self.depth -= 1


# ---------------------------------------------------------------------------
# Tooltips: which formulas are damage, and of which type.
# ---------------------------------------------------------------------------

DAMAGE_TAG = re.compile(r"<(magicDamage|physicalDamage|trueDamage)>(.*?)</\1>", re.S | re.I)
REF = re.compile(r"@(?:spell\.[A-Za-z0-9_]+:)?([A-Za-z0-9_.{}]+?)(?:\*(-?[0-9.]+))?@")
TYPE = {"magicdamage": "magic", "physicaldamage": "physical", "truedamage": "true"}


def clean(text):
    text = re.sub(r"<br>", " ", text or "", flags=re.I)
    return html.unescape(re.sub(r"\s+", " ", text))


def tooltip_for(spell, strings):
    keys = (((spell.get("mClientData") or {}).get("mTooltipData") or {}).get("mLocKeys") or {})
    for k in ("keyTooltip", "keyTooltipSimple"):
        key = keys.get(k)
        if key and key.lower() in strings:
            return strings[key.lower()]
    return ""


def resolve_includes(text, strings, depth=0):
    if depth > 3:
        return text

    def sub(m):
        # Keys can pick a variant by a runtime value ("Spell_KarmaQ_Tooltip_@IsEmpowered@"): use the base state.
        key = m.group(1).lower()
        if "@" in key:
            stem = re.sub(r"@[^@]*@", "", key)
            key = next((stem + v for v in ("0", "1", "") if stem + v in strings), stem)
        return resolve_includes(strings.get(key, ""), strings, depth + 1)
    return re.sub(r"\{\{\s*([A-Za-z0-9_@.]+)\s*\}\}", sub, text)


def flat_is_range(inner, refs, i):
    """True when ref i is the upper end of an "X to Y" range."""
    return i > 0 and bool(re.search(r"\bto\s*$|-\s*$", inner[refs[i - 1].end():refs[i].start()].lower()))


def round_coef(v):
    """4 decimals, but small coefficients (a percent of max Health per AP) keep 3 significant digits."""
    return round(v, 4) if abs(v) >= 0.01 else float(f"{v:.3g}")


def round_lin(lin):
    return {k: round_coef(v) for k, v in lin.items() if abs(v) > 1e-9}


def parse_spell(slot, spell_obj, strings, base_stats, attack_range=125):
    spell = spell_obj.get("mSpell") or {}
    rank = RANKS.get(slot, 1)
    notes = set()
    ev = Evaluator(spell, rank, base_stats, notes)
    text = clean(resolve_includes(tooltip_for(spell, strings), strings))
    main = re.search(r"<mainText>(.*?)</mainText>", text, re.S)
    body = main.group(1) if main else text

    hits = []
    for m in DAMAGE_TAG.finditer(body):
        kind, inner = TYPE[m.group(1).lower()], m.group(2)
        before = body[max(0, m.start() - 30):m.start()].lower()
        after = body[m.end():m.end() + 30].lower()
        flat, flat_names, health = [], [], []
        refs = list(REF.finditer(inner))
        for i, ref in enumerate(refs):
            name, mult = ref.group(1), ref.group(2)
            if SKIP_CALC.search(name):
                continue
            lin, is_pct = ev.calc(name)
            if lin is None:
                continue
            nxt = refs[i + 1].start() if i + 1 < len(refs) else len(inner)
            tail = inner[ref.end():nxt].lower()
            words = (tail + " " + (after if i + 1 == len(refs) else "")).lower()
            health_part = "health" in words[:25] and not flat_is_range(inner, refs, i)
            if tail.startswith("%") or is_pct or (flat and health_part):
                # A percent: target health damage if the text says so, else a ratio display.
                if "health" not in words:
                    continue
                if "bonus health" in words[:40]:
                    # % of the target's bonus Health: champions in a Mayhem fight carry about 30% of
                    # their Health as bonus, so count it as a share of max Health.
                    lin = lin.scale(0.3)
                    notes.add("target bonus health counted as 30% of max health")
                target = ("target_missing_hp" if "missing" in words else
                          "target_current_hp" if "current" in words else "target_max_hp")
                if mult:
                    lin = lin.scale(float(mult) / 100.0)  # "@X*100@%" shows a fraction as a percent
                elif lin.const() > 1.0 or tail.startswith("%"):
                    lin = lin.scale(0.01)
                health.append((target, lin, name))
            else:
                if mult and float(mult) not in (100.0, 1.0):
                    lin = lin.scale(float(mult))  # e.g. "@BaseDamage*0.5@"
                ranged = bool(flat) and re.search(r"\bto\s*$|-\s*$", inner[refs[i - 1].end():ref.start()].lower())
                if ranged:  # "X to Y": use the middle of the range
                    flat[-1] = (flat[-1] + lin).scale(0.5)
                    flat_names[-1] += "~" + name
                elif not flat:
                    flat.append(lin)
                    flat_names.append(name)
        # "... damage @NumberOfStrikes@ times": a multi-hit count.
        count = 1.0
        cm = re.match(r"\s*(?:@([A-Za-z0-9_]+)@|([0-9]+))\s*times", body[m.end():m.end() + 40])
        if cm:
            if cm.group(2):
                count = float(cm.group(2))
            else:
                c_lin, _ = ev.calc(cm.group(1))
                if c_lin is None or c_lin.const() <= 0:
                    for cname in list(ev.calcs) + list(ev.values):
                        if re.search(r"strikes|hits|ticks|times|count", cname, re.I):
                            c_lin, _ = ev.calc(cname)
                            if c_lin is not None and c_lin.const() > 0:
                                break
                if c_lin is not None and c_lin.const() > 0:
                    count = c_lin.const()
            if count > 1:
                flat = [f.scale(count) for f in flat]
                health = [(t, l.scale(count), n) for t, l, n in health]
                notes.add(f"multi-hit x{count:g}")
        if not flat and not health:
            continue
        inner_l = inner.lower()
        per_second = "per second" in inner_l or "per second" in after or "every second" in after
        alt = any(w in before for w in ALT_WORDS) or re.match(r"\s*(?:\S+\s+){0,1}instead\b", after) is not None
        if flat:
            hits.append({"type": kind, "calc": flat_names[0], "scaling": round_lin(flat[0]), "target": "flat",
                         "per_second": per_second, "alt": alt})
        for target, lin, name in health:
            hits.append({"type": kind, "calc": name, "scaling": round_lin(lin), "target": target,
                         "per_second": per_second, "alt": alt})

    cooldown = spell.get("cooldownTime") or [0.0] * 7
    for mode in MODE_LAYERS:
        mode_cd = ((spell.get(COOLDOWN_OVERRIDE) or {}).get(mode) or {}).get("value")
        if mode_cd:
            if mode_cd != cooldown:
                notes.add(f"{mode} cooldown")
            cooldown = mode_cd
    cd = float(cooldown[min(rank, len(cooldown) - 1)])
    recharge = spell.get("mAmmoRechargeTime") or []
    if recharge and float(recharge[min(rank, len(recharge) - 1)]) > cd:
        # Ammo abilities: sustained use is one cast per recharge.
        cd = float(recharge[min(rank, len(recharge) - 1)])
        notes.add("cooldown is the ammo recharge time")
    durations = [v for k, v in ev.values.items() if "duration" in k and v]
    duration = float(durations[0][min(rank, len(durations[0]) - 1)]) if durations else 0.0
    targeting = (spell.get("mTargetingTypeData") or {}).get("__type", "")
    area = "aoe" if targeting in AOE_TARGETING else "line" if targeting in LINE_TARGETING else "single"
    return {
        "slot": slot,
        "name": spell_obj.get("mScriptName", ""),
        "rank": rank,
        "cooldown": round(cd, 3),
        **cast_timing(spell, rank, targeting),
        **({"cc": cc} if (cc := parse_cc(text, ev)) else {}),
        **({"shield": sh} if (sh := parse_shield(body, ev)) else {}),
        **({"heal": hl} if (hl := parse_heal(body, ev)) else {}),
        **({"cost": c} if (c := spell_cost(spell, rank)) else {}),
        "targeting": targeting,
        "area": area,
        "duration": round(duration, 3),
        "geometry": parse_geometry(spell, slot, area, attack_range),
        "hits": hits,
        "mode_overrides": ev.mode_overrides,
        "notes": sorted(notes),
    }


# Crowd control named in a tooltip's <status> tags, strongest first, with typical durations
# (seconds) for when the tooltip gives none.
CC_KINDS = [("suppress", r"suppress", 1.5), ("stun", r"stun", 1.0), ("knockup", r"knock|airborne|pull", 0.75),
            ("charm", r"charm", 1.25), ("fear", r"fear|flee|terrif", 1.25), ("taunt", r"taunt", 1.25),
            ("sleep", r"sleep|drows", 1.5), ("polymorph", r"polymorph", 1.25), ("root", r"root|snare|immobil", 1.25),
            ("silence", r"silenc", 1.25), ("slow", r"slow", 1.5)]


def parse_cc(text, ev):
    """The strongest crowd control an ability's tooltip names, and how long it lasts."""
    tags = [m for m in re.finditer(r"<status>([^<]+)</status>", text)]
    for kind, pat, default in CC_KINDS:
        hit = next((m for m in tags if re.search(pat, m.group(1), re.I)), None)
        if not hit:
            continue
        # The duration is usually the next "...Duration@" number in the same sentence.
        dur = None
        sentence = text[hit.end():hit.end() + 220].split(". ")[0]
        for ref in re.finditer(r"@([A-Za-z0-9_.]+?)(?:\*[0-9.]+)?@", sentence):
            name = ref.group(1)
            if re.search(r"duration|time", name, re.I) and not re.search(r"cooldown|recharge", name, re.I):
                lin, _ = ev.calc(name)
                if lin is not None and lin.is_const() and 0.1 <= lin.const() <= 5:
                    dur = lin.const()
                    break
        out = {"type": kind, "duration": round(dur if dur is not None else default, 3)}
        if kind == "slow":
            m = re.search(r"@([A-Za-z0-9_]*slow[A-Za-z0-9_]*)@\s*%", sentence, re.I)
            lin = ev.calc(m.group(1))[0] if m else None
            amt = lin.const() if lin is not None and lin.is_const() else 30.0
            out["amount"] = round(min(0.9, amt / 100.0 if amt > 1 else amt), 3)
        return out
    return None


SHIELD_TAG = re.compile(r"<shield>(.*?)</shield>", re.S | re.I)


def parse_shield(body, ev):
    """The shield an ability gives (its first <shield> amount) and how long it lasts."""
    for m in SHIELD_TAG.finditer(body):
        ref = REF.search(m.group(1))
        if not ref:
            continue
        lin, is_pct = ev.calc(ref.group(1))
        if lin is None or is_pct or ref.group(2) or "%" in m.group(1)[ref.end():ref.end() + 2]:
            continue
        if lin.const() <= 0 and not any(k != "const" for k in round_lin(lin)):
            continue
        dur = 2.5
        sentence = body[m.end():m.end() + 160].split(". ")[0]
        for d in REF.finditer(sentence):
            if re.search(r"duration|time|length", d.group(1), re.I) and not re.search(r"cooldown|recharge", d.group(1), re.I):
                dl, _ = ev.calc(d.group(1))
                if dl is not None and dl.is_const() and 0.5 <= dl.const() <= 8:
                    dur = dl.const()
                    break
        return {"scaling": round_lin(lin), "duration": round(dur, 3)}
    return None


def spell_cost(spell, rank):
    """Mana or energy per cast at this rank."""
    costs = spell.get("mana") or []
    return round(float(costs[min(rank, len(costs)) - 1]), 2) if costs else 0.0


# Resource types in the CharacterRecord (AbilityResourceSlotInfo.arType) and its value hashes.
RESOURCES = {0: "mana", 1: "energy"}
AR_BASE, AR_PER_LEVEL, AR_REGEN, AR_REGEN_PER_LEVEL = "{726ee5cd}", "{6216bf7b}", "{c4ab3550}", "{3a509002}"


def resource(record):
    """The champion's ability resource: kind, pool and regeneration per second (base and per level)."""
    ar = record.get("primaryAbilityResource") or {}
    kind = RESOURCES.get(ar.get("arType", 0) if ar else 0)
    num = lambda k: round(float((ar.get(k) or {}).get("baseValue", 0.0)), 4)  # noqa: E731
    if not kind or num(AR_BASE) <= 0:
        return {"kind": "none"}
    return {"kind": kind, "pool": num(AR_BASE), "pool_per_level": num(AR_PER_LEVEL),
            "regen": num(AR_REGEN), "regen_per_level": num(AR_REGEN_PER_LEVEL)}


HEAL_TAG = re.compile(r"<healing>(.*?)</healing>", re.S | re.I)


def parse_heal(body, ev):
    """The Health an ability restores to its caster (its first flat <healing> amount). Heals that
    are a share of damage dealt or of missing Health are left out."""
    for m in HEAL_TAG.finditer(body):
        ref = REF.search(m.group(1))
        if not ref:
            continue
        lin, is_pct = ev.calc(ref.group(1))
        if lin is None or is_pct or ref.group(2) or "%" in m.group(1):
            continue
        if lin.const() <= 0 and not any(k != "const" for k in round_lin(lin)):
            continue
        return {"scaling": round_lin(lin)}
    return None


def attack_windup(record):
    """Share of an attack's time spent winding up before it fires: the game's 30% base plus the
    champion's offset, or its own cast/total attack time when the record gives them."""
    ba = record.get("basicAttack") or {}
    if ba.get("mAttackCastTime") and ba.get("mAttackTotalTime"):
        return round(float(ba["mAttackCastTime"]) / float(ba["mAttackTotalTime"]), 4)
    return round(0.3 + float(ba.get("mAttackDelayCastOffsetPercent") or 0.0), 4)


def cast_timing(spell, rank, targeting):
    """How long the ability holds the caster: its cast time (the wind-up before it fires) and,
    for channels, how long it keeps the caster busy afterwards (lock). Missing cast times are
    instant. Self-targeted buffs and toggled auras go off at once in game whatever the record's
    template says; casts that borrow the attack's wind-up (cast_from_attack) scale with
    attack speed like an attack."""
    raw = spell.get("spellCastTime")
    older = spell.get("mCastTime") or 0
    # The newer field is often left at its template (0.25, or 0 with no total time); then the
    # older field holds the real cast time.
    if raw is None or (older > 0.01 and (raw == 0.25 or (raw == 0 and not spell.get("spellTotalTime")))):
        raw = older
    cast = max(0.0, float(raw or 0.0))
    if targeting == "Self" or (spell.get("bIsToggleSpell") and targeting in ("SelfAoe", "")):
        cast = 0.0
    out = {"cast_time": round(min(cast, 1.5), 3)}
    channel = per_level(spell.get("mChannelDuration"), rank) or 0.0
    if spell.get("mUseChargeChanneling"):
        channel *= 0.5  # charged abilities are usually let go halfway
    if channel > 0:
        out["lock"] = round(channel, 3)
    auto = spell.get("mUseAutoattackCastTimeData")
    if isinstance(auto, dict):
        parts = ((auto.get("mAutoattackCastTimeCalculation") or {}).get("mFormulaParts") or [])
        mult = next((float(x["mNumber"]) for x in parts if "mNumber" in x), 1.0)
        out["cast_from_attack"] = round(mult, 3)
    return out


def per_level(v, rank):
    """A FloatPerSpellLevel or plain number at this rank (lists start at rank 0)."""
    if isinstance(v, dict):
        vals = v.get("mPerLevelValues")
        return float(vals[min(rank, len(vals) - 1)]) if vals else None
    if isinstance(v, list):
        return float(v[min(rank, len(v) - 1)]) if v else None
    if isinstance(v, (int, float)):
        return float(v)
    return None


SELF_TARGETING = {"Self", "SelfAoe"}
FAKE_RANGE = 5000  # castRange 25000 (or 10000) means "aimed anywhere"; the targeter has the real range


def parse_geometry(spell, slot, area, attack_range):
    """Where an ability reaches and what it covers, in game units, from the targeter
    the game draws when aiming it (mTargeterDefinitions), falling back to the spell's
    own cast range, radius and line width. Missile speed 0 means it lands at once."""
    rank = RANKS.get(slot, 1)
    targeting = (spell.get("mTargetingTypeData") or {}).get("__type", "")
    targeters = ((spell.get("mClientData") or {}).get("mTargeterDefinitions")) or []
    by_type = {}
    for t in targeters:
        by_type.setdefault(t.get("__type", ""), t)
    line, aoe, cone = by_type.get("TargeterDefinitionLine"), by_type.get("TargeterDefinitionAoe"), by_type.get("TargeterDefinitionCone")
    rng = by_type.get("TargeterDefinitionRange")
    arc = by_type.get("TargeterDefinitionArc")
    missile = (spell.get("mMissileSpec") or {})
    speed = per_level((missile.get("movementComponent") or {}).get("mSpeed"), rank) or 0.0
    if speed < 300:
        speed = per_level(spell.get("missileSpeed"), rank) or 0.0
    if speed < 300 or speed > 6000:
        speed = 0.0
    cast_range = per_level(spell.get("castRangeDisplayOverride"), rank) or per_level(spell.get("castRange"), rank) or 0.0
    anywhere = cast_range >= FAKE_RANGE
    if anywhere:
        cast_range = 0.0

    g = {"shape": "single", "range": 0.0, "radius": 0.0, "width": 0.0, "angle": 0.0, "speed": round(speed),
         "on_self": targeting in SELF_TARGETING}
    if cone:
        g.update(shape="cone", range=per_level(cone.get("coneRange"), rank) or cast_range,
                 angle=per_level(cone.get("coneAngleDegrees"), rank) or 45.0)
    elif line and area == "line" or line and not aoe:
        width = per_level(line.get("lineWidth"), rank) or per_level(spell.get("mLineWidth"), rank) or \
            per_level(missile.get("mMissileWidth"), rank) or 80.0
        g.update(shape="line", range=per_level(line.get("overrideBaseRange"), rank) or cast_range, width=width)
    elif aoe or arc or area == "aoe":
        t = aoe or arc or {}
        radius = per_level(t.get("overrideRadius"), rank) or per_level(spell.get("castRadius"), rank) or 0.0
        reach = per_level(t.get("constraintRange"), rank) or cast_range
        if g["on_self"]:
            radius = radius or reach
            reach = 0.0
        if g["on_self"] and radius < 150:
            # No real area (a placeholder castRadius): a self buff whose damage lands
            # through the champion's attacks, so it reaches whatever they can attack.
            g.update(shape="single", range=float(attack_range), self_buff=True)
        else:
            g.update(shape="circle", range=reach, radius=radius or 300.0)
    if rng and per_level(rng.get("overrideBaseRange"), rank):
        g["range"] = max(g["range"], per_level(rng.get("overrideBaseRange"), rank))
    if g["shape"] == "single" and g["on_self"]:
        g.update(range=float(attack_range), self_buff=True)
    elif g["shape"] == "single":
        g["range"] = cast_range if 0 < cast_range < FAKE_RANGE else 0.0
    if not g["range"] and not (g["on_self"] and g["shape"] in ("circle", "single")):
        # Nothing usable: melee-ish abilities reach a little past the attack, others a typical cast range.
        if anywhere and g["shape"] in ("line", "circle"):
            g["range"] = 1500.0 if g["shape"] == "line" else 900.0  # long-range or global: far, but fought nearby
        else:
            g["range"] = max(attack_range + 100, 600.0) if g["shape"] != "single" or attack_range >= 300 else attack_range + 50
        g["range_guessed"] = True
    if g["on_self"]:
        g["speed"] = 0
    for k in ("range", "radius", "width", "angle"):
        g[k] = round(float(g[k]), 1)
    return g


def parse_passives(bin_data, record, rules, strings, base, attack_range, notes):
    """The champion's passive damage (its tooltip's damage numbers, as for abilities) with
    when it lands, from data/passives.json."""
    path = record.get("mCharacterPassiveSpell")
    obj = find_spell(bin_data, path) if rules and path else None
    if obj is None:
        if rules:
            notes.append("P: passive spell data not found")
        return []
    parsed = parse_spell("P", obj, strings, base, attack_range)
    ev = Evaluator(obj.get("mSpell") or {}, RANKS.get("P", 1), base, set())

    def value(v, default):
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            lin, _ = ev.calc(v)
            if lin is not None and lin.is_const():
                return lin.const()
            notes.append(f"P: value {v} not found")
        return default

    out = []
    for rule in rules:
        want = rule.get("calcs")
        hits = [dict(h, per_second=False) for h in parsed["hits"]
                if (want is None and not h["alt"]) or (want and h["calc"].split("~")[0] in want)]
        if rule.get("hits"):  # whole hits by hand: an ability's passive on-hit that the passive tooltip lacks
            hits = [dict(h, per_second=False) for h in rule["hits"]]
        elif rule.get("scaling"):  # the hit's numbers by hand (e.g. without the attack's own AD it replaces)
            hits = [dict(h, scaling=dict(rule["scaling"])) for h in hits[:1]] or [
                {"type": rule.get("type", "magic"), "calc": "Manual", "scaling": dict(rule["scaling"]),
                 "target": "flat", "per_second": False, "alt": False}]  # a passive scripted without tooltip numbers (Bard's meeps)
        mult = float(rule.get("mult", 1.0))
        if mult != 1.0:
            for h in hits:
                h["scaling"] = {k: round_coef(c * mult) for k, c in h["scaling"].items()}
        hits = [h for h in hits if h["scaling"]]
        if not hits:
            notes.append(f"P: no damage for {rule.get('calcs') or 'its passive'}")
            continue
        out.append({
            "trigger": rule["trigger"],
            "every": max(1, int(round(value(rule.get("every"), 1)))),
            "cooldown": round(value(rule.get("cooldown"), 0.0), 3),
            "per_target": bool(rule.get("per_target")),
            "charges": int(rule.get("charges", 1)),
            "max_charges": max(1, int(round(value(rule.get("max_charges"), 1)))),
            "aoe": bool(rule.get("aoe")),
            "below_hp": round(value(rule.get("below_hp"), 0.0), 3),
            "ability_cdr": round(value(rule.get("ability_cdr"), 0.0), 3),
            **({"restore": float(rule["restore"])} if rule.get("restore") else {}),
            **({"basic_cdr": float(rule["basic_cdr"])} if rule.get("basic_cdr") else {}),
            **({"needs_hit": True} if rule.get("needs_hit") else {}),
            "hits": hits,
        })
    return out


def eval_hits(specs, spell_obj, slot, base):
    """Hits named by calc and evaluated from a spell's own formulas: {"calc", "type", "target", "mult"}."""
    out = []
    for h in specs:
        if "scaling" in h:
            out.append({"alt": False, "per_second": False, "target": "flat", **h})
            continue
        notes = set()
        ev = Evaluator((spell_obj or {}).get("mSpell") or {}, RANKS.get(slot, 1), base, notes)
        lin, _ = ev.calc(h["calc"])
        mult = h.get("mult", 1.0)
        out.append({"calc": h["calc"], "type": h.get("type", "magic"),
                    "scaling": {k: round_coef(v * mult) for k, v in (lin or {}).items() if abs(v) > 1e-9},
                    "target": h.get("target", "flat"), "per_second": h.get("per_second", False), "alt": False})
    return out


def apply_fix(a, fix, spell_obj, base):
    """A hand fix (champion_overrides.json) on one parsed ability."""
    for k, v in fix.items():
        if k == "geometry":
            a["geometry"].update(v)
        elif k == "hit_mults":  # {calc name: multiplier}, e.g. a recast or a hit count
            for h in a["hits"]:
                if h["calc"] in v:
                    h["scaling"] = {s: round_coef(c * v[h["calc"]]) for s, c in h["scaling"].items()}
        elif k == "hit_adds":  # {calc name: {stat: amount}}: stacks added to a hit (Nasus Q)
            for h in a["hits"]:
                for stat, amt in v.get(h["calc"], {}).items():
                    h["scaling"][stat] = round_coef(h["scaling"].get(stat, 0) + amt)
        elif k == "alt_calcs":  # damage numbers that replace the main hit rather than add to it
            for h in a["hits"]:
                if h["calc"] in v:
                    h["alt"] = True
        elif k == "calcs":  # only these of the parsed numbers count (one of several spells in a slot)
            a["hits"] = [dict(h, alt=False) for h in a["hits"] if h["calc"] in v]
        elif k == "hits":  # hits given outright, or named by calc and evaluated from the spell
            a["hits"] = eval_hits(v, spell_obj, a["slot"], base)
        elif k == "cooldown_calc":  # a cooldown kept in one of the spell's formulas
            notes = set()
            lin, _ = Evaluator((spell_obj or {}).get("mSpell") or {}, RANKS.get(a["slot"], 1), base, notes).calc(v)
            if lin:
                a["cooldown"] = round(lin.const(), 3)
        elif k == "pet" and isinstance(v, dict):
            a["pet"] = {pk: (eval_hits(pv, spell_obj, a["slot"], base) if pk in ("hits", "slam") else pv) for pk, pv in v.items()}
        elif k not in ("why", "variants"):
            a[k] = v


def make_variant(base_ability, spec, bin_data, slot_spell, strings, base, attack_range):
    """One version of an ability slot: a copy of the parsed ability, or another spell of the champion
    ("spell"), with its own hand fixes."""
    import copy
    slot = base_ability["slot"]
    spell_obj = find_spell(bin_data, spec["spell"]) if spec.get("spell") else slot_spell
    if spec.get("spell") and spell_obj:
        v = parse_spell(slot, spell_obj, strings, base, attack_range)
        v["cost"] = base_ability.get("cost", 0.0)
    else:
        v = copy.deepcopy({k: x for k, x in base_ability.items() if k != "variants"})
    apply_fix(v, {k: x for k, x in spec.items() if k != "spell"}, spell_obj, base)
    v["notes"] = []
    v.pop("mode_overrides", None)
    return v


def find_spell(bin_data, path):
    if path in bin_data:
        return bin_data[path]
    low = path.lower()
    for k, v in bin_data.items():
        if k.lower() == low:
            return v
    tail = path.split("/")[-1].lower()
    for k, v in bin_data.items():
        if isinstance(v, dict) and v.get("__type") == "SpellObject" and k.lower().endswith("/" + tail):
            return v
    return None


# ---------------------------------------------------------------------------
# ARAM Mayhem balance table
# ---------------------------------------------------------------------------

def load_mayhem_balance(path):
    """Per-champion Mayhem modifiers from data/wiki/mayhem_modifiers.json (fractions, ability haste in
    points), as the multipliers and bonuses the engine reads. Champions it leaves out have none."""
    with open(path, encoding="utf-8") as f:
        src = json.load(f)
    out = {}
    for name, e in src["champions"].items():
        m = e.get("mayhem") or {}
        out[norm(name)] = {"damage_dealt": round(1.0 + m.get("damage_dealt", 0), 4),
                           "damage_taken": round(1.0 + m.get("damage_taken", 0), 4),
                           "ability_haste": float(m.get("ability_haste", 0)),
                           "attack_speed": float(m.get("attack_speed", 0)),
                           "healing": round(1.0 + m.get("healing", 0), 4),
                           "shielding": round(1.0 + m.get("shielding", 0), 4),
                           "tenacity": float(m.get("tenacity", 0))}
    return out, f"wiki read {src.get('read', '?')}"


def norm(name):
    return re.sub(r"[^a-z]", "", name.lower())


def record_stat(record, *names):
    """A base stat from the champion's CharacterRecord (plain number or {baseValue})."""
    for n in names:
        v = record.get(n)
        if isinstance(v, dict):
            v = v.get("baseValue")
        if v is not None:
            return round(float(v), 4)
    return 0.0


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--pool", default=DEFAULT_POOL, help="cn_enemy_pool.json for roles and CN stats")
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--only", default="", help="comma-separated champion names (for debugging)")
    ap.add_argument("--overrides", default=DEFAULT_OVERRIDES, help="hand fixes per champion and ability")
    ap.add_argument("--anims", default=DEFAULT_ANIMS, help="anims.json with which abilities dash or blink")
    ap.add_argument("--passives", default=DEFAULT_PASSIVES, help="when each champion's passive deals its damage")
    args = ap.parse_args()
    cache = args.cache

    version = ".".join(json.loads(fetch(CONTENT_METADATA, cache, "content-metadata.json"))["version"].split(".")[:2])
    summary = json.loads(fetch(GAME_DATA + "/champion-summary.json", cache, f"gd/{version}/champion-summary.json"))
    # Ids from 60000 up are mode copies (e.g. Jade); -1 is "None".
    # The client spells one alias differently from everywhere else (FiddleSticks).
    alias = lambda a: "Fiddlesticks" if a == "FiddleSticks" else a  # noqa: E731
    champs = {alias(c["alias"]): {"id": alias(c["alias"]), "name": c["name"], "key": str(c["id"])}
              for c in summary if 0 < c["id"] < 10000}
    log(f"game version {version}: {len(champs)} champions")
    strings = {k.lower(): v for k, v in json.loads(fetch(STRINGTABLE, cache, "stringtable.json"))["entries"].items()}
    balance, balance_patch = load_mayhem_balance(MAYHEM_MODIFIERS)
    log(f"Mayhem balance table ({balance_patch}): {len(balance)} champions")

    with open(args.pool, encoding="utf-8") as f:
        pool = json.load(f)
    with open(args.overrides, encoding="utf-8") as f:
        overrides = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    with open(os.path.join(DATA, "kit_passives.json"), encoding="utf-8") as f:
        kit_passives = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    with open(args.passives, encoding="utf-8") as f:
        passive_rules = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    cn = {int(e["champion_id"]): e for e in pool["enemies"]}
    anims = {}
    if os.path.exists(args.anims):
        with open(args.anims, encoding="utf-8") as f:
            anims = json.load(f)

    only = {norm(x) for x in args.only.split(",") if x}
    todo = [c for c in champs.values() if not only or norm(c["id"]) in only or norm(c["name"]) in only]

    def load(c):
        detail = json.loads(fetch(f"{GAME_DATA}/champions/{c['key']}.json", cache, f"gd/{version}/champions/{c['key']}.json"))
        c["tags"] = [r.capitalize() for r in detail.get("roles") or []]
        c["spells"] = detail.get("spells") or []
        return c, json.loads(fetch(CHAMP_BIN.format(c=c["id"].lower()), cache, f"bins/{c['id'].lower()}.json"))

    with ThreadPoolExecutor(8) as ex:
        loaded = list(ex.map(load, todo))

    out = []
    for c, bin_data in sorted(loaded, key=lambda x: x[0]["name"]):
        cid = int(c["key"])
        record = next((v for k, v in bin_data.items() if isinstance(v, dict) and v.get("__type") == "CharacterRecord"
                       and k.lower().endswith("/root")), {})
        st = lambda *n: record_stat(record, *n)  # noqa: E731
        s = {
            "hp": st("baseHPModifiable", "baseHP"), "hpperlevel": st("hpPerLevelModifiable", "hpPerLevel"),
            "armor": st("baseArmorModifiable", "baseArmor"), "armorperlevel": st("armorPerLevelModifiable", "armorPerLevel"),
            "spellblock": st("baseMR", "baseSpellBlock"), "spellblockperlevel": st("mrPerLevel", "spellBlockPerLevel"),
            "attackdamage": st("baseDamageModifiable", "baseDamage"),
            "attackdamageperlevel": st("damagePerLevelModifiable", "damagePerLevel"),
            "attackspeed": st("attackSpeedModifiable", "attackSpeed"),
            "attackspeedperlevel": st("attackSpeedPerLevelModifiable", "attackSpeedPerLevel"),
            "attackrange": st("attackRangeModifiable", "attackRange"),
            "movespeed": st("baseMoveSpeedModifiable", "baseMoveSpeed"),
        }
        base = {
            "ad": level_stat(s["attackdamage"], s["attackdamageperlevel"]),
            "hp": level_stat(s["hp"], s["hpperlevel"]),
            "armor": level_stat(s["armor"], s["armorperlevel"]),
            "mr": level_stat(s["spellblock"], s["spellblockperlevel"]),
        }
        res = resource(record)
        if res["kind"] == "mana":
            base["mana"] = level_stat(res["pool"], res["pool_per_level"])
        spell_paths = record.get("spells") or []
        abilities, notes, spell_objs = [], [], {}
        for slot, path in zip("QWER", spell_paths):
            obj = find_spell(bin_data, path)
            spell_objs[slot] = obj
            if obj is None:
                notes.append(f"{slot}: spell data not found")
                continue
            abilities.append(parse_spell(slot, obj, strings, base, s["attackrange"]))
        if any(a["cooldown"] <= 0 for a in abilities):
            # A few abilities keep their cooldown outside the spell record; the client's champion data has it.
            for a, sp in zip(abilities, c["spells"]):
                cds = sp.get("cooldownCoefficients") or []
                if a["cooldown"] <= 0 and any(cds):
                    a["cooldown"] = float(cds[min(a["rank"], len(cds)) - 1])
                    a["notes"].append("cooldown from the champion's ability list")

        for a in abilities:
            if a["cooldown"] < 1.0 and not (a["hits"] and all(h["per_second"] for h in a["hits"])):
                # Passives, resource-gated and charge abilities keep no usable cooldown.
                a["cooldown"] = DEFAULT_R_COOLDOWN if a["slot"] == "R" else DEFAULT_COOLDOWN
                a["notes"].append(f"cooldown unknown; assumed {a['cooldown']:g}s")
        for slot, fix in overrides.get(c["id"], {}).items():
            if slot == "death":
                continue
            for a in abilities:
                if a["slot"] == slot:
                    apply_fix(a, fix, spell_objs.get(slot), base)
                    if "variants" in fix:  # versions of the slot the kit swaps in mid-fight (Hwei, Aphelios)
                        a["variants"] = [make_variant(a, v, bin_data, spell_objs.get(slot), strings, base, s["attackrange"])
                                         for v in fix["variants"]]
                    a["notes"].append("hand override: " + fix.get("why", ""))
        abilities = [a for a in abilities if not a.get("skip")]
        for a in abilities:
            move = (anims.get(c["id"], {}).get(a["slot"]) or {}).get("move")
            if move and "move" not in a["geometry"]:
                a["geometry"]["move"] = move  # "dash" or "blink": the caster travels with the ability

        passives = parse_passives(bin_data, record, passive_rules.get(c["id"]), strings, base, s["attackrange"], notes)

        bal = balance.get(norm(c["name"])) or balance.get(norm(c["id"]))
        if not bal:
            notes.append("no Mayhem damage dealt/taken modifiers listed")

        damaging = sum(1 for a in abilities if a["hits"])
        flagged = sum(1 for a in abilities for n in a["notes"] if "ignored" in n or "unsupported" in n)
        quality = "good" if damaging >= 2 and flagged == 0 else "partial" if damaging >= 1 else "none"
        p = cn.get(cid)
        entry = {
            "id": c["id"],
            "name": c["name"],
            "champion_id": cid,
            "tags": c.get("tags", []),
            "role": (p or {}).get("role") or (c.get("tags") or ["Fighter"])[0].lower(),
            "ranged": s["attackrange"] >= 300,
            "stats": {
                "hp": s["hp"], "hp_per_level": s["hpperlevel"],
                "armor": s["armor"], "armor_per_level": s["armorperlevel"],
                "mr": s["spellblock"], "mr_per_level": s["spellblockperlevel"],
                "ad": s["attackdamage"], "ad_per_level": s["attackdamageperlevel"],
                "attack_speed": s["attackspeed"], "attack_speed_per_level": s["attackspeedperlevel"] / 100.0,
                "attack_speed_ratio": round(float((record.get("attackSpeedRatioModifiable") or {}).get("baseValue")
                                                  or s["attackspeed"]), 4),
                "attack_range": s["attackrange"],
                "attack_windup": attack_windup(record),
                "attack_windup_mod": round(float((record.get("basicAttack") or {}).get(
                    "mAttackDelayCastOffsetPercentAttackSpeedRatio", 1.0)), 4),
                "move_speed": s["movespeed"],
                # The in-game hitbox: most champions 65, some 55, 70 or 80.
                "gameplay_radius": float(record.get("overrideGameplayCollisionRadius") or 65.0),
            },
            "mayhem": {
                "damage_dealt": (bal or {}).get("damage_dealt", 1.0),
                "damage_taken": (bal or {}).get("damage_taken", 1.0),
                "ability_haste": (bal or {}).get("ability_haste", 0.0),
                "attack_speed": (bal or {}).get("attack_speed", 0.0),
                "healing": (bal or {}).get("healing", 1.0),
                "shielding": (bal or {}).get("shielding", 1.0),
                "tenacity": (bal or {}).get("tenacity", 0.0),
            },
            "resource": resource(record),
            "cn": {k: p[k] for k in ("weight", "damage_share", "damage_taken_share", "win_rate", "cc", "phys_share")} if p else None,
            "abilities": abilities,
            **({"passives": passives} if passives else {}),
            "parse_quality": quality,
            "notes": notes,
        }
        kit = kit_passives.get(c["id"])
        if kit:  # stat and stacking passives (data/kit_passives.json)
            entry["kit"] = {k: v for k, v in kit.items() if k in ("stats", "effects")}
        death = overrides.get(c["id"], {}).get("death")
        if death:  # cheating death once a fight (champion_overrides.json)
            entry["death"] = {k: v for k, v in death.items() if k != "why"}
        out.append(entry)

    if YUNARA_ID not in cn and pool.get("yunara"):
        for e in out:
            if e["champion_id"] == YUNARA_ID:
                y = pool["yunara"]
                e["cn"] = {"weight": y.get("pick_rate"), "damage_share": y.get("damage_share"),
                           "damage_taken_share": y.get("damage_taken_share"), "win_rate": y.get("win_rate"),
                           "cc": 1, "phys_share": 1.0}

    doc = {
        "meta": {
            "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "game_version": version,
            "cdragon": "pbe" if PBE else "latest",
            "mayhem_balance_patch": balance_patch,
            "level": LEVEL,
            "ranks": RANKS,
            "notes": [
                "Ability damage is parsed from Riot's game data (CommunityDragon) and tooltips: every number tagged as "
                "magic, physical or true damage, evaluated at level 18 with max ranks. scaling keys: const, ap, bonus_ad, "
                "bonus_hp, bonus_armor, bonus_mr, bonus_mana, as (bonus attack speed), crit, lethality.",
                "target is flat or a fraction of the target's max/current/missing health. alt marks numbers that look like "
                "alternatives (empowered, maximum, recast) rather than extra hits.",
                "mayhem holds the server-side ARAM Mayhem modifiers (damage dealt/taken, healing, shielding, tenacity, "
                "ability haste, attack speed) from the official League wiki; ability values and cooldowns use Riot's own ARAM/Kiwi overrides from each bin.",
                "cn holds 101.qq.com China-server Mayhem stats: damage_share is the average share of the team's damage.",
            ],
        },
        "champions": out,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    q = {k: sum(1 for e in out if e["parse_quality"] == k) for k in ("good", "partial", "none")}
    log(f"wrote {len(out)} champions to {os.path.relpath(args.out)} (parse quality {q})")


if __name__ == "__main__":
    main()
