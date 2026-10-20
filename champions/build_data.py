"""Build data.js for the champion pages (Champions, one page per champion).

Usage: python3 champions/build_data.py [--channel latest|pbe]
Writes champions/data.js and champions/tags.json (roles, subclasses, playstyles). Python 3 standard library only. Champion files are cached in
~/.cache/deeparam-champions/<patch>/.

What it reads:
  v1/champion-summary.json, v1/champions/{id}.json   names, titles, roles, splash, ability text and icons, pick quote
  game/data/characters/{alias}/{alias}.bin.json      Mayhem ability changes (DataValuesModeOverride and the
                                                     cooldown override, ARAM then Kiwi)
  v1/items.json, v1/cherry-augments.json             item and augment names and icons (ids match Tencent's)
  data/cn/builds/{id}.json (in this repo)            Mayhem build stats per champion (101.qq.com, refreshed daily
                                                     by the My Stats thread): items, augments, skill orders, teammates
  data/cn/champions.csv (in this repo)               Tier List rank, win and pick rate
  guide/augment_rules.json (in this repo)            items only augments give, left out of the build stats

Not in the client: the per-champion damage dealt/taken, tenacity, healing and ability haste
adjustments. Riot applies those on the game server, so this page doesn't show them.
"""
import argparse, csv, json, os, re, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BASE = "https://raw.communitydragon.org"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-champions")
SLOTS = ["Q", "W", "E", "R", "P"]
RANKS = {"Q": 5, "W": 5, "E": 5, "R": 3}
MODES = ("ARAM", "Kiwi")  # Kiwi is Mayhem; it is applied on top of the ARAM layer
COOLDOWN_OVERRIDE = "{f9c2333e}"  # per-mode cooldownTime override (unhashed name unknown)


def get(url, cache=None, tries=4):
    if cache and os.path.exists(cache):
        with open(cache) as f:
            return json.load(f)
    # CommunityDragon refuses Python's default User-Agent
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-champions"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == tries - 1:
                raise
        except (urllib.error.URLError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)
    if cache:
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "wb") as f:
            f.write(data)
    return json.loads(data)


def clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text or "")
    return re.sub(r"<[^>]+>", "", text).replace("&nbsp;", " ").strip()


def same(a, b):
    return all(abs(x - y) < 1e-4 for x, y in zip(a, b)) and len(a) == len(b)


def ranks(values, slot):
    """The values a player sees: rank 1..max for abilities (index 0 is rank 0), level 1 on for the passive."""
    vals = [round(v, 4) for v in values[1:] if v is not None]
    if slot in RANKS:
        vals = vals[:RANKS[slot]]
    return vals


def mayhem_changes(bin_, record):
    """Every number Mayhem changes in this champion's abilities, as (slot, label, rift ranks, mayhem ranks)."""
    # spells lists the Q, W, E and R spells in order; each ability's sub-spells live in the same folder
    folders = {sp.rsplit("/", 1)[0]: SLOTS[i] for i, sp in enumerate((record.get("spells") or [])[:4])}
    mains = set((record.get("spells") or [])[:4])
    passive = record.get("mCharacterPassiveSpell") or ""
    if passive:
        folders.setdefault(passive.rsplit("/", 1)[0], "P")

    def slot(path):
        for f, s in folders.items():
            if path.startswith(f + "/"):
                return s
        return None

    out, seen = [], set()
    # main spells first, so a sub-spell repeating the same change (Ashe's Volley ranks) is dropped
    for path, obj in sorted(bin_.items(), key=lambda kv: (kv[0] not in mains and kv[0] != passive, kv[0])):
        sp = obj.get("mSpell") if isinstance(obj, dict) else None
        if not isinstance(sp, dict):
            continue
        s = slot(path)
        if not s:
            continue
        rows = []
        base = {d["name"]: d.get("values") for d in sp.get("DataValues") or [] if d.get("values")}
        merged = {}
        for mode in MODES:
            for d in ((sp.get("DataValuesModeOverride") or {}).get(mode) or {}).get("SpellDataValues") or []:
                if d.get("values"):
                    merged[d["name"]] = d["values"]
        for name, vals in merged.items():
            if name in base and not same(base[name], vals):
                rows.append((name, base[name], vals))
        cd = sp.get(COOLDOWN_OVERRIDE) or {}
        cd_vals = next(((cd.get(m) or {}).get("value") for m in reversed(MODES) if (cd.get(m) or {}).get("value")), None)
        if cd_vals and sp.get("cooldownTime") and not same(sp["cooldownTime"], cd_vals):
            rows.append(("Cooldown", sp["cooldownTime"], cd_vals))
        for name, rift, mayhem in rows:
            r, m = ranks(rift, s), ranks(mayhem, s)
            key = (s, name, tuple(m))
            if key in seen or r == m:
                continue
            seen.add(key)
            out.append({"slot": s, "name": name, "rift": r, "mayhem": m})
    out.sort(key=lambda c: (SLOTS.index(c["slot"]), c["name"] != "Cooldown", c["name"]))
    return out


# Build stats name a few items by ids the game files don't use; map them to the game's id.
ITEM_ALIASES = {3097: 3095}  # Stormrazor


def reward_items():
    """Items only augments hand out (quest rewards); guide/build_data.py lists them in guide/augment_rules.json."""
    path = os.path.join(REPO, "guide", "augment_rules.json")
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {g["id"] for g in json.load(f).get("grantedItems", []) if g["how"] == "reward"}


REWARD_ITEMS = reward_items()


def build_rows(xs, n):
    """Item rows without the reward items; rows that become the same set are merged (pick added, win weighted)."""
    out = {}
    for x in xs or []:
        ids = tuple(ITEM_ALIASES.get(i, i) for i in x["items"] if ITEM_ALIASES.get(i, i) not in REWARD_ITEMS)
        if not ids:
            continue
        r = out.get(ids)
        if r:
            pick = r["pick"] + x["pick_rate"]
            r["win"] = round((r["win"] * r["pick"] + x["win_rate"] * x["pick_rate"]) / pick, 4) if pick else r["win"]
            r["pick"] = round(pick, 4)
        else:
            out[ids] = {"items": list(ids), "pick": x["pick_rate"], "win": x["win_rate"]}
    return list(out.values())[:n]


def load_build(cid):
    """One champion's Mayhem build stats from data/cn/builds/{id}.json (the My Stats thread refreshes them daily)."""
    path = os.path.join(REPO, "data", "cn", "builds", f"{cid}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        b = json.load(f)
    rows = build_rows
    items = b.get("items") or {}
    aug = b.get("augments") or {}
    return {
        "date": b.get("date"),
        "start": sorted(rows(items.get("starting"), 99), key=lambda r: -r["pick"])[:5],
        "boots": rows(items.get("boots"), 4),
        "first": rows(items.get("other"), 8),
        "core": rows(items.get("core"), 6),
        "full": rows(items.get("full_builds"), 6),
        # inputs for archetypes(); dropped before writing
        "_core": rows(items.get("core"), 99), "_full": rows(items.get("full_builds"), 99),
        "_other": rows(items.get("other"), 99),
        "_augs": [{"id": a["id"], "pick": a["pick_rate"]} for a in aug.get("all") or []],
        "augments": {t: [{"id": a["id"], "pick": a["pick_rate"], "grade": a.get("grade") or ""} for a in aug.get(t) or []][:10]
                     for t in ("prismatic", "gold", "silver")},
        "skills": [{"max": "".join(s["max_order"]), "pick": s["pick_rate"], "win": s["win_rate"],
                    "orders": [{"levels": "".join(o["order"]), "pick": o["pick_rate"], "win": o["win_rate"]} for o in s.get("orders") or []][:3]}
                   for s in b.get("skills") or []][:3],
        "mates": [{"id": m["id"], "win": m["win_rate"], "pick": m["pick_rate"]} for m in b.get("partners") or []][:5],
    }


def base_stats(record):
    """Level 1 stats and per-level growth from the champion's CharacterRecord; resource only for Mana and Energy."""
    def v(*names):
        for n in names:
            x = record.get(n)
            if isinstance(x, dict):
                x = x.get("baseValue")
            if x is not None:
                return round(float(x), 4)
        return 0.0
    out = {
        "hp": [v("baseHPModifiable", "baseHP"), v("hpPerLevelModifiable", "hpPerLevel")],
        "hp5": [round(v("baseStaticHPRegenModifiable") * 5, 3), round(v("hpRegenPerLevelModifiable") * 5, 3)],
        "ad": [v("baseDamageModifiable", "baseDamage"), v("damagePerLevelModifiable", "damagePerLevel")],
        "as": [v("attackSpeedModifiable", "attackSpeed"), v("attackSpeedPerLevelModifiable", "attackSpeedPerLevel")],
        "armor": [v("baseArmorModifiable", "baseArmor"), v("armorPerLevelModifiable", "armorPerLevel")],
        "mr": [v("baseMR", "baseSpellBlock"), v("mrPerLevel", "spellBlockPerLevel")],
        "range": v("attackRangeModifiable", "attackRange"),
        "ms": v("baseMoveSpeedModifiable", "baseMoveSpeed"),
    }
    res = record.get("primaryAbilityResource") or {}
    kind = {0: "Mana", 1: "Energy"}.get(res.get("arType", 0))
    num = lambda k: round(float((res.get(k) or {}).get("baseValue") or 0), 4)  # noqa: E731
    if kind and num("{726ee5cd}"):
        out["resource"] = {"kind": kind, "base": [num("{726ee5cd}"), num("{6216bf7b}")],
                           "regen": [round(num("{c4ab3550}") * 5, 3), round(num("{3a509002}") * 5, 3)]}
    return out


ROLE_NAMES = {"assassin": "Assassin", "fighter": "Fighter", "mage": "Mage", "marksman": "Marksman", "support": "Support", "tank": "Tank"}
# Riot's own champion tags (two per champion, championMetadata in game/global/champions/champions.bin.json; the names
# are the string table's champion_tag_*) and what each means, in a line.
PLAYSTYLES = {
    "Initiator": "Starts fights by jumping in.",
    "Crowd Control": "Stuns, roots, slows or otherwise locks enemies down.",
    "Burst": "Deals a lot of damage in a short combo.",
    "Mobile": "Has dashes, blinks or speed to move around the fight.",
    "AoE": "Hits several enemies at once.",
    "Duelist": "Strong in one-on-one fights.",
    "Auto-attack": "Deals most of its damage with basic attacks.",
    "Ally Protection": "Heals, shields or saves teammates.",
    "Hypercarry": "Grows into a damage threat that carries late fights.",
    "Durable": "Hard to kill.",
    "Dive": "Jumps onto targets in the enemy backline.",
    "Self Healing": "Heals itself during fights.",
    "Sustained Damage": "Keeps dealing damage over a long fight.",
    "Stealth": "Can turn invisible or camouflaged.",
    "Long Range": "Fights from far away.",
    "Summon": "Fights alongside pets, clones or other units.",
    "Battlecaster": "A mage who fights up close with a steady stream of spells.",
    "Damage-over-Time": "Damages through burns, poisons and other effects over time.",
    "Shapeshift": "Changes form to swap between sets of abilities.",
}
TAG_NAMES = {"Damage-over-Time": "damage_over_time", "Auto-attack": "auto_attack", "AoE": "aoe"}
# Playstyle ratings (1 to 3) in championMetadata; two of the five have hashed names (worked out from Leona and
# Malphite, who are 3 on both). A rating left out of the file is 1.
RATINGS = {"damage": "playStyleDamage", "toughness": "{28f8756b}", "control": "{c6585a26}",
           "mobility": "playStyleMobility", "utility": "playStyleUtility"}


def tag_key(name):
    """The string table key for an official tag name ("Crowd Control" -> champion_tag_crowd_control)."""
    return "champion_tag_" + TAG_NAMES.get(name, name.lower().replace(" ", "_").replace("-", "_"))


# One colour per tag: classes share a hue family, playstyles have their own
TAG_COLORS = {
    "Controller": "#3fb6a8", "Enchanter": "#57c7b2", "Catcher": "#2f9e8f",
    "Fighter": "#e07b39", "Juggernaut": "#c9622a", "Diver": "#f0965a",
    "Mage": "#7b6cf6", "Burst": "#9a7cff", "Battlemage": "#6a5ae0", "Artillery": "#b49bff",
    "Marksman": "#e0a83c",
    "Slayer": "#e0475b", "Assassin": "#d63c56", "Skirmisher": "#f06b7c",
    "Tank": "#4f8fd6", "Vanguard": "#3f7fc8", "Warden": "#6aa6e6",
    "Specialist": "#9bb53b",
    "Support": "#57c7b2",
    "Initiator": "#f05a3c", "Crowd Control": "#a77bd9", "Mobile": "#3fd0e0", "AoE": "#f08a3c", "Duelist": "#e05a7a",
    "Auto-attack": "#e0b23c", "Ally Protection": "#f2c14e", "Hypercarry": "#ff7a59", "Durable": "#5f9ee8",
    "Dive": "#d9534f", "Self Healing": "#4cbf6b", "Sustained Damage": "#c98a4a", "Stealth": "#8a8fa8",
    "Long Range": "#3fa7f5", "Summon": "#b07cd9", "Battlecaster": "#8f7cf6", "Damage-over-Time": "#7fbf3f",
    "Shapeshift": "#c76bd0",
}


def champion_tags(alias, info, meta):
    """Official roles (game files), Riot's subclasses (classes.py), and Riot's own playstyle tags and ratings
    (championMetadata)."""
    from classes import CLASS_OF, SUBCLASS
    subs = SUBCLASS.get(alias)
    subs = [subs] if isinstance(subs, str) else list(subs or [])
    classes = list(dict.fromkeys(CLASS_OF[s] for s in subs))
    keys = {tag_key(n): n for n in PLAYSTYLES}
    play = [keys[t] for t in (meta.get("{90d227c0}"), meta.get("{434fc710}")) if t in keys]
    out = {
        "roles": [ROLE_NAMES.get(r, r.title()) for r in info.get("roles") or []],
        "classes": classes, "subclasses": subs, "playstyles": play,
    }
    if any(meta.get(f) for f in RATINGS.values()):
        out["ratings"] = {k: max(1, min(3, int(meta.get(f) or 1))) for k, f in RATINGS.items()}
    return out


def site_paths(text):
    """Point asset URLs at the site's own copies (/assets/cd/<channel>/<path, lower case>)."""
    return re.sub(re.escape(BASE) + r"/([^\s\"']+)", lambda m: "/assets/cd/" + m.group(1).lower(), text)


# Build styles. An item's style comes from its shop categories; a build's style is the most common one among its
# items (ties go to the earlier style in STYLES).
STYLES = {"crit": "Crit", "onhit": "On-hit", "ap": "AP", "lethality": "Lethality", "fighter": "AD",
          "tank": "Tank", "enchanter": "Enchanter"}
# Each Mayhem augment's own build tags (mBuildTags in kiwi.bin, a bit field) name the builds it fits. Bits not listed
# here (4, 128, 1024, 2048) don't line up with one style yet, so they're ignored.
BUILD_TAGS = {512: "crit", 64: "onhit", 32: "ap", 2: "lethality", 16: "fighter", 256: "tank", 8: "enchanter"}
# Crowd-control codes in each champion's mAbilitySlotCC (Q, W, E, R), worked out from well-known abilities
# (Leona Q stun, E root; Ashe slows; Janna Q knock-up; Lulu W polymorph...). Codes not listed here (1, 3, 10, 20)
# aren't named yet. Hard CC stops the target acting; slow and blind don't.
CC_CODES = {2: "blind", 5: "fear", 7: "knockback", 8: "knockup", 11: "polymorph", 12: "pull", 13: "silence",
            14: "slow", 15: "root", 16: "stun", 17: "suppression", 18: "taunt"}
SOFT_CC = {"slow", "blind"}


def item_style(it):
    c = set(it.get("categories") or [])
    desc = (it.get("description") or "").lower()
    if "Boots" in c or "Consumable" in c:
        return None
    if "CriticalStrike" in c:
        return "crit"
    if "OnHit" in c and "AttackSpeed" in c:
        return "onhit"
    if "lethality" in desc:
        return "lethality"
    if "heal and shield power" in desc:
        return "enchanter"
    if "SpellDamage" in c:
        return "ap"
    if "Damage" in c:
        return "fighter"
    if c & {"Health", "Armor", "SpellBlock"}:
        return "tank"
    return None


def build_style(ids, items):
    styles = [x for x in (item_style(items[i]) for i in ids if i in items) if x]
    order = list(STYLES)  # ties go to the more specific style
    return max(styles, key=lambda x: (styles.count(x), -order.index(x))) if styles else None


def augment_styles(kiwi):
    """{augment id: set of styles it fits}, from the augment's build tags"""
    out = {}
    for a in kiwi.values():
        if not (isinstance(a, dict) and a.get("__type") == "AugmentData" and a.get("AugmentPlatformId")):
            continue
        fits = {st for bit, st in BUILD_TAGS.items() if (a.get("mBuildTags") or 0) & bit}
        if fits:
            out[a["AugmentPlatformId"]] = fits
    return out


def ability_cc(record):
    """{slot: crowd control} for Q, W, E and R, from the champion's record; None when the record doesn't list it."""
    codes = record.get("mAbilitySlotCC")
    if not codes:
        return None
    return {slot: CC_CODES[c] for slot, c in zip("QWER", codes) if c in CC_CODES}


def archetypes(b, items, aug_fits):
    """Group a champion's core paths and full builds by style, with the items and augments that go with each."""
    def weigh(rows):
        pick = sum(r["pick"] for r in rows)
        return pick, (sum(r["win"] * r["pick"] for r in rows) / pick if pick else 0)

    groups = {}
    for r in b["_core"]:
        st = build_style(r["items"], items)
        if st:
            groups.setdefault(st, {"core": [], "full": []})["core"].append(r)
    for r in b["_full"]:
        st = build_style(r["items"], items)
        if st in groups:
            groups[st]["full"].append(r)
    total = sum(r["pick"] for g in groups.values() for r in g["core"]) or 1
    out = []
    for st, g in groups.items():
        pick, win = weigh(g["core"])
        if pick / total < 0.05 and out:
            continue
        in_core = {i for r in g["core"] for i in r["items"]}
        out.append({
            "style": st, "label": STYLES[st], "share": round(pick / total, 4), "win": round(win, 4),
            "core": g["core"][:3], "full": g["full"][:2],
            "items": [r["items"][0] for r in b["_other"] if item_style(items.get(r["items"][0], {})) == st
                      and r["items"][0] not in in_core][:4],
            "augments": [a["id"] for a in b["_augs"] if st in aug_fits.get(a["id"], ())][:6],
        })
    out.sort(key=lambda a: -a["share"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    ch = ap.parse_args().channel
    gd = f"{BASE}/{ch}/plugins/rcp-be-lol-game-data/global/default"

    def asset(path):
        p = (path or "").lower()
        if not p:
            return None
        if p.startswith("/lol-game-data/assets/"):
            return f"{gd}/{p[len('/lol-game-data/assets/'):]}"
        return f"{BASE}/{ch}/game/" + re.sub(r"\.(tex|dds)$", ".png", p)

    version = get(f"{BASE}/{ch}/content-metadata.json")["version"].split("+")[0]
    cache = os.path.join(CACHE, f"{ch}-{version}")
    # ids 60000+ are the Jade copies of champions (another mode)
    summary = [c for c in get(f"{gd}/v1/champion-summary.json") if 0 < c["id"] < 10000]
    print(f"patch {version}: {len(summary)} champions")

    def load(c):
        alias = c["alias"].lower()
        return (get(f"{gd}/v1/champions/{c['id']}.json", os.path.join(cache, f"{c['id']}.json")),
                get(f"{BASE}/{ch}/game/data/characters/{alias}/{alias}.bin.json", os.path.join(cache, f"{alias}.bin.json")))

    with ThreadPoolExecutor(12) as pool:
        loaded = list(pool.map(load, summary))

    items = {i["id"]: i for i in get(f"{gd}/v1/items.json")}
    augs = {a["id"]: a for a in get(f"{gd}/v1/cherry-augments.json")}
    aug_fits = augment_styles(get(f"{BASE}/{ch}/game/maps/modespecificdata/kiwi.bin.json", os.path.join(cache, "kiwi.bin.json")))

    tier = {}
    path = os.path.join(REPO, "data", "cn", "champions.csv")
    if os.path.exists(path):
        with open(path, newline="") as f:
            rows = list(csv.DictReader(f))
        for r in rows:
            tier[int(r["champion_id"])] = {
                "rank": int(r["rank"]), "of": len(rows), "winRate": float(r["win_rate"]), "pickRate": float(r["pick_rate"]),
                "damage": float(r["avg_damage_ratio"]), "tank": float(r["avg_tank_ratio"]),
            }

    builds = {c["id"]: load_build(c["id"]) for c in summary}

    used_items, used_augs, champions = set(), set(), []
    for c, (info, bin_) in zip(summary, loaded):
        if not info:
            continue
        bin_ = bin_ or {}
        record = next((v for k, v in bin_.items() if k.endswith("/CharacterRecords/Root")), {})
        base_skin = next((s for s in info.get("skins") or [] if s.get("isBase")), {})
        abilities = [{"slot": "P", "name": info["passive"]["name"], "icon": asset(info["passive"].get("abilityIconPath")),
                      "text": clean(info["passive"].get("description"))}]
        for s in info.get("spells") or []:
            abilities.append({"slot": s["spellKey"].upper(), "name": s["name"], "icon": asset(s.get("abilityIconPath")),
                              "text": clean(s.get("description")), "cooldown": ranks([0] + s.get("cooldownCoefficients", []), s["spellKey"].upper())})
        cc = ability_cc(record) or {}
        for a in abilities:
            if a["slot"] in cc:
                a["cc"] = cc[a["slot"]]
        b = builds.get(c["id"])
        if b:
            b["styles"] = archetypes(b, items, aug_fits)
            for k in [k for k in b if k.startswith("_")]:
                del b[k]
            used_items.update(i for k in ("start", "boots", "first", "core", "full") for r in b[k] for i in r["items"])
            used_items.update(i for st in b["styles"] for r in st["core"] + st["full"] for i in r["items"])
            used_items.update(i for st in b["styles"] for i in st["items"])
            used_augs.update(a["id"] for rows in b["augments"].values() for a in rows)
            used_augs.update(a for st in b["styles"] for a in st["augments"])
        champions.append({
            "id": c["id"], "alias": c["alias"], "name": info["name"], "title": info.get("title", ""),
            "roles": info.get("roles") or [],
            "icon": asset(info.get("squarePortraitPath")),
            "splash": asset(base_skin.get("uncenteredSplashPath") or base_skin.get("splashPath")),
            "tile": asset(base_skin.get("tilePath")),
            "stats": base_stats(record) if record else None,
            "abilities": abilities,
            "mayhem": mayhem_changes(bin_, record) if record else [],
            "tier": tier.get(c["id"]),
            "builds": b,
        })
    champions.sort(key=lambda c: c["name"])

    out = {
        "patch": version,
        "champions": champions,
        "items": {i: {"name": items[i]["name"], "icon": asset(items[i]["iconPath"])} for i in sorted(used_items) if i in items},
        "augments": {a: {"name": augs[a]["nameTRA"], "icon": asset(augs[a].get("augmentSmallIconPath")),
                         "tier": {"kSilver": "Silver", "kGold": "Gold", "kPrismatic": "Prismatic"}.get(augs[a].get("rarity"), "")}
                     for a in sorted(used_augs) if a in augs},
    }
    changed = sum(1 for c in champions if c["mayhem"])
    print(f"{changed} champions with Mayhem ability changes, {sum(len(c['mayhem']) for c in champions)} changes;"
          f" {sum(1 for c in champions if c['builds'])} champions with build stats; {len(tier)} tier rows")
    with open(os.path.join(HERE, "data.js"), "w") as f:
        # no header comment: the file ships to the site, and pages don't say where data comes from
        f.write("window.CHAMPS_DATA = " + site_paths(json.dumps(out, ensure_ascii=False, separators=(",", ":"))) + ";\n")
    def cc_tags(bin_):
        record = next((v for k, v in (bin_ or {}).items() if k.endswith("/CharacterRecords/Root")), {})
        cc = ability_cc(record)
        if cc is None:
            return {}
        kinds = set(cc.values())
        return {"cc": cc, "hardCC": bool(kinds - SOFT_CC)}
    metas = get(f"{BASE}/{ch}/game/global/champions/champions.bin.json", os.path.join(cache, "champions.bin.json"))
    meta_of = {k.split("/")[-1].lower(): (v.get("championMetadata") or {}) for k, v in metas.items() if isinstance(v, dict)}
    tags = {c["alias"]: {"id": c["id"], "name": info["name"], **champion_tags(c["alias"], info, meta_of.get(c["alias"].lower(), {})),
                         **cc_tags(bin_)}
            for c, (info, bin_) in zip(summary, loaded) if info}
    from classes import CLASSES
    with open(os.path.join(HERE, "tags.json"), "w") as f:
        json.dump({"patch": version, "colors": TAG_COLORS,
                   "classes": {k: list(v) for k, v in CLASSES.items()},
                   "meanings": {**PLAYSTYLES, **{s: m for subs in CLASSES.values() for s, m in subs.items()}},
                   "ratings": list(RATINGS),
                   "champions": dict(sorted(tags.items())),
                   # each augment's build styles from its own tags, for "fits this build" filters
                   "augments": {str(a): sorted(st, key=list(STYLES).index) for a, st in sorted(aug_fits.items())}},
                  f, indent=1, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
