"""Build data.js for the Mayhem Guide tab from CommunityDragon (the League client's own files).

Usage: python3 guide/build_data.py [--channel latest|pbe]
Needs: pip install xxhash (string-table keys are hashed). Writes guide/data.js.

What it reads:
  game/maps/modespecificdata/kiwi.bin.json      Mayhem quests (ModesQuestData), augments, augment data values
  game/en_us/data/menu/en_us/lol.stringtable.json  quest, augment and milestone text
  v1/challenges.json                            the permanent ARAM challenges and their tier thresholds
  v1/queues.json, v1/game-mode-mutators.json    Mayhem queues and the Howling Abyss map skins
  v1/items.json, v1/augment-lists.json          Mayhem-only items, augment pool sizes
"""
import argparse, http.client, json, os, re, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# A quest's "{{SpellName}}": the ability the player picks with the augment, named in each client language
CHOSEN_ABILITY = {
    "en_us": "your chosen ability", "ar_ae": "القدرة التي تختارها", "cs_cz": "zvolená schopnost", "de_de": "deine gewählte Fähigkeit",
    "el_gr": "η ικανότητα που επέλεξες", "es_es": "la habilidad elegida", "es_mx": "la habilidad elegida",
    "fr_fr": "la compétence choisie", "hu_hu": "a választott képesség", "id_id": "kemampuan pilihanmu",
    "it_it": "l'abilità scelta", "ja_jp": "選択したスキル", "ko_kr": "선택한 스킬", "pl_pl": "wybrana umiejętność",
    "pt_br": "a habilidade escolhida", "ro_ro": "abilitatea aleasă", "ru_ru": "выбранное умение", "th_th": "สกิลที่เลือก",
    "tr_tr": "seçtiğin yetenek", "vi_vn": "kỹ năng đã chọn", "zh_cn": "所选技能", "zh_tw": "所選技能",
}
SPELL_NAME = CHOSEN_ABILITY["en_us"]
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "datamine"))
from strings import key_hash  # noqa: E402

BASE = "https://raw.communitydragon.org"
TIERS = ["Silver", "Gold", "Prismatic"]
# the public Mayhem queue id from Riot's official constants (build_constants.py), 2400 until that file exists
_CONSTS = os.path.join(HERE, "game_constants.json")
MAYHEM_QUEUE = (json.load(open(_CONSTS)).get("mayhemQueue") if os.path.exists(_CONSTS) else None) or 2400
CHALLENGE_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
# Map skins: game-mode-mutators names them, the minimap file is per skin
MAP_SKINS = [
    ("Howling Abyss", None, "2dlevelminimap.png"),
    ("Koeshin's Crossing", "MapSkin_Map12_Bloom", "2dlevelminimap_bloom.png"),
    ("Butcher's Bridge", "MapSkin_HA_Bilgewater", "2dlevelminimap_bilgewater2.png"),
    ("Bridge of Progress", "MapSkin_HA_Crepe", "2dlevelminimap_crepe.png"),
]
SUMMONS = [
    ("Poro King", "kiwi_poroking", "kiwi_poroking_circle.png", "A Mayhem version of the Poro King, with its own King Poro model in blue and red team colors."),
    ("Tibbers", "kiwi_tibbers", "bear_circle.png", "A Mayhem copy of Annie's bear. Its spell is named \"Summon: Tibbers\"."),
    ("Viego Soul", "kiwi_viegosoul", "kiwi_viegosoul_circle.png", "A Mayhem companion unit that reuses Senna's soul model."),
]
# Augment Sets (an earlier Mayhem season's feature; the text is still in the client): string-table key stem per set
AUGMENT_SETS = [
    ("Snowball", "Snowday", ""),
    ("Ambulance", "Wee Woo Wee Woo", "Gain Movement Speed and Heal and Shield Power toward allies at low Health."),
    ("Money", "Make it Rain", ""),
    ("Gamble", "High Roller", "Minions can drop Stat Anvils, and more of the set raises the chance of Gold or Prismatic Anvils."),
    ("Stacking", "Stackosaurus Rex", ""),
    ("FullyAutomated", "Fully Automated", "Lowers your Autocast cooldown, and at the next tier Autocast cooldown scales with Ability Haste."),
    ("Firecracker", "Firecracker Set", ""),
    ("DiveBomb", "Dive Bomb Set", "Reduces your death timer."),
    ("Mana", "Archmage", ""),
]
# Augments that hand you an extra summoner spell
SPELL_AUGMENTS = ["PoroCharge_Active", "DimensionShift_Active", "Flash2"]
MAYHEM_ITEMS = [550001, 550002, 550003, 550004, 550006, 550005, 550007, 226668, 223069]


_FETCHED = {}  # files every language's build shares (the string tables are too big to keep)


def bin_hash(path):
    """A bin entry's hashed name: FNV-1a of the lower-case path, as "{xxxxxxxx}"."""
    h = 0x811C9DC5
    for c in path.lower().encode():
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return "{%08x}" % h


class Bin(dict):
    """A bin file's entries. The same entry can be named by its path or by its hash, depending on which names the
    file's converter knows: a key may be a path while references to it are still hashes, or the other way round.
    get() and key() accept either form."""

    def __init__(self, entries):
        super().__init__(entries or {})
        self.paths = {bin_hash(k): k for k in self if not k.startswith("{")}

    def key(self, ref):
        """The name this file uses for the entry ref points at (ref itself when it isn't here)."""
        if not isinstance(ref, str) or ref in self:
            return ref
        if ref.startswith("{"):
            return self.paths.get(ref, ref)
        h = bin_hash(ref)
        return h if h in self else ref

    def get(self, ref, default=None):
        return super().get(self.key(ref), default)


def get(url, tries=6):
    if url in _FETCHED:
        return _FETCHED[url]
    # CommunityDragon refuses Python's default User-Agent
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-guide"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException):  # a big file can be cut off
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    if "stringtable" not in url:
        _FETCHED[url] = data
    return data


def site_paths(text):
    """Point asset URLs at the site's own copies (/assets/cd/<channel>/<path, lower case>)."""
    return re.sub(re.escape(BASE) + r"/([^\s\"']+)", lambda m: "/assets/cd/" + m.group(1).lower(), text)


def build(ch, lo="en_us"):
    """Everything the Info page and the site read, with game text in one client language (lo, like fr_fr)."""
    global SPELL_NAME
    SPELL_NAME = CHOSEN_ABILITY.get(lo, CHOSEN_ABILITY["en_us"])
    gd = f"{BASE}/{ch}/plugins/rcp-be-lol-game-data/global/default"

    def client(path):
        """A client file with text in it, in the build's language (the English copy when that one is missing)."""
        if lo != "en_us":
            try:
                return get(f"{BASE}/{ch}/plugins/rcp-be-lol-game-data/global/{lo}/{path}")
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise
        return get(f"{gd}/{path}")

    def asset(path):
        """A game or client asset path as a CommunityDragon PNG URL."""
        p = path.lower()
        if p.startswith("/lol-game-data/assets/"):
            return f"{gd}/{p[len('/lol-game-data/assets/'):]}"
        return f"{BASE}/{ch}/game/" + re.sub(r"\.(tex|dds)$", ".png", p)

    version = get(f"{BASE}/{ch}/content-metadata.json")["version"].split("+")[0]
    kiwi = Bin(get(f"{BASE}/{ch}/game/maps/modespecificdata/kiwi.bin.json"))
    entries = get(f"{BASE}/{ch}/game/{lo}/data/menu/en_us/lol.stringtable.json")["entries"]

    def s(key, default=""):
        if not key:
            return default
        return entries.get(key.lower()) or entries.get(key_hash(key)) or default

    pool = {x["modeName"]: x["augmentList"] for x in get(f"{gd}/v1/augment-lists.json")}
    # Guest of Honor augments (a band's own augments, given by that band's rule) aren't offered in selections
    in_pool = {kiwi.key(p) for p in pool.get("KIWI", []) if "/GuestOfHonorAugments/" not in p}

    # ---- Quests: each ModesQuestData belongs to one augment that points at it
    augments = {k: v for k, v in kiwi.items() if isinstance(v, dict) and v.get("__type") == "AugmentData"}
    quests = []
    for qpath, q in kiwi.items():
        if not (isinstance(q, dict) and q.get("__type") == "ModesQuestData"):
            continue
        refs = (qpath, bin_hash(qpath)) if not qpath.startswith("{") else (qpath, kiwi.key(qpath))
        apath, a = next(((k, v) for k, v in augments.items() if any(r in json.dumps(v) for r in refs)), (None, None))
        values = {}
        if a:
            sp = kiwi.get(a.get("RootSpell"), {}).get("mSpell", {})
            values = {d["name"].lower(): d["values"][0] for d in sp.get("DataValues", []) if d.get("values")}
        milestones, notes = [], []
        for i, m in enumerate(q.get("Milestones", [])):
            parts = split_quest(fill(quest_labels(s(m.get("MilestoneDescriptionTra"))), values, m.get("{7fec0982}"), i + 1))
            milestones.append({"need": m.get("{7fec0982}"), "quest": parts["quest"], "reward": parts["reward"]})
            notes += [n for n in parts["notes"] if n not in notes]
        quests.append({
            "key": q["QuestName"],
            "name": s(q.get("QuestNameTra"), q["QuestName"]),
            "augmentId": a.get("AugmentPlatformId") if a else None,
            "tier": TIERS[a.get("rarity", 0)] if a else None,
            "inPool": apath in in_pool,
            "icon": asset(q["QuestIcon"]["texturePath"]) if q.get("QuestIcon") else None,
            "milestones": milestones,
            "notes": notes[:3],
        })
    quests.sort(key=lambda q: (not q["inPool"], TIERS.index(q["tier"]) if q["tier"] else 9, q["name"]))

    # ---- ARAM challenges: the permanent 101xxx group (seasonal copies have ended)
    data = client("v1/challenges.json")["challenges"]
    groups, challenges = {}, []
    for cid, c in data.items():
        if not cid.startswith("101") or c.get("seasons"):
            continue
        if c.get("tags", {}).get("isCapstone") == "Y":
            groups[cid] = c["name"]
            continue
        th = c["thresholds"]
        tiers = [{"tier": t, "value": th[t]["value"], "reward": any(r.get("category") == "TITLE" for r in th[t].get("rewards", []))}
                 for t in CHALLENGE_TIERS if t in th]
        top = tiers[-1]["tier"]
        challenges.append({
            "id": int(cid), "name": c["name"], "text": c["description"], "group": c.get("tags", {}).get("parent"),
            "mayhem": MAYHEM_QUEUE in (c.get("queueIds") or []), "tiers": tiers,
            "icon": asset(c["levelToIconPath"].get(top) or next(iter(c["levelToIconPath"].values()))),
        })
    for c in challenges:
        c["group"] = groups.get(c["group"], "ARAM")
    challenges.sort(key=lambda c: c["id"])

    # ---- Mode facts
    # Mayhem's queues are picked by their English names; their names come in the build's language
    listed = lambda qs: qs.values() if isinstance(qs, dict) else qs  # noqa: E731
    ids = {q["id"] for q in listed(get(f"{gd}/v1/queues.json")) if str(q.get("name", "")).startswith("ARAM: Mayhem")}
    mayhem_queues = sorted({q["id"]: q["name"] for q in listed(client("v1/queues.json")) if q["id"] in ids}.items())
    mutators = client("v1/game-mode-mutators.json")
    skin_names = {m["Mutator"]["ExpandedMutator"]: m["MapNameOverride"] for g in mutators for m in g.get("Mutators", [])}
    maps = [{"name": skin_names.get(mut, name) if mut else name,
             "minimap": f"{BASE}/{ch}/game/assets/maps/info/map12/{file}"} for name, mut, file in MAP_SKINS]

    items_by_id = {i["id"]: i for i in client("v1/items.json")}
    items = []
    for iid in MAYHEM_ITEMS:
        it = items_by_id.get(iid)
        if not it:
            continue
        desc = s(f"GeneratedTip_Item_{iid}_ExternalDescription") if "GeneratedTip" in it["description"] else it["description"]
        items.append({"id": iid, "name": it["name"], "icon": asset(it["iconPath"]), "text": clean(desc)[:220]})

    tier_counts = {t: 0 for t in TIERS}
    for path in in_pool:
        a = kiwi.get(path)
        if a and a.get("Enabled") is not False:
            tier_counts[TIERS[a.get("rarity", 0)]] += 1

    summons = [{"name": n, "text": t, "icon": f"{BASE}/{ch}/game/assets/characters/{folder}/hud/{icon}"}
               for n, folder, icon, t in SUMMONS]

    # ---- Mode rules from map12.bin
    m12 = Bin(get(f"{BASE}/{ch}/game/data/maps/shipping/map12/map12.bin.json"))
    consts = {v["mName"]: {k: c.get("mValue") for k, c in v.get("mConstants", {}).items()}
              for v in m12.values() if isinstance(v, dict) and v.get("mName", "").startswith("Kiwi_Balance")}
    spells = {p.split("/")[-1]: v for p, v in m12.items() if "/Spells/" in p and isinstance(v, dict)}
    def dv(name):
        return {d["name"]: d["values"][0] for d in (spells.get(name, {}).get("mSpell") or {}).get("DataValues", []) if d.get("values")}
    def tip(name):
        keys = ((spells.get(name, {}).get("mBuff") or {}).get("mTooltipData") or {}).get("mLocKeys") or {}
        return clean(s(keys.get("keyTooltip")))
    combo = tip("Kiwi_ComboBreaker")
    levels = [int(x) for x in re.findall(r"\d+", (re.search(r"Level\s*([\d/]+)", combo) or [None, ""])[1])]
    # The Mayhem aura's tooltip lists the mode-wide rules; the mode's own settings hold the numbers behind some
    modes = {k.split("/")[-1]: v for k, v in m12.items() if k.startswith("Maps/Shipping/Map12/Modes/")}
    def mode_consts(mode):
        groups = (m12.get(modes.get(mode, {}).get("mGameModeConstants"), {}) or {}).get("mGroups", {})
        return {k: c.get("mValue") for g in groups.values() if isinstance(g, dict)
                for k, c in (g.get("mConstants") or {}).items() if isinstance(c, dict)}
    kiwi_consts, aram_consts = mode_consts("KIWI"), mode_consts("ARAM")
    aura = re.sub(r"<titleLeft>.*?</titleLeft>|<postScriptLeft>.*?</postScriptLeft>|\{\{[^}]*\}\}", "", s("buff_desc_MayhemicMagic"))
    aura = [l.strip() for l in clean(aura).split("\n") if l.strip()]
    # each selection's card count per rarity sits in the mode's augment config
    pick = next((c for c in (m12.get(k) for k in modes.get("KIWI", {}).get("Configs", [])) if isinstance(c, dict)
                 and isinstance(c.get("{8794a0e6}"), dict)), {})
    cards_per = sorted(set(pick.get("{8794a0e6}", {}).values())) or [3]
    rules = {
        "aura": aura,
        # attacks can't come faster than this delay, so 1 / delay is the attack speed cap
        "attackSpeedCap": round(1 / kiwi_consts["gcd_AttackMinDelay"], 2) if kiwi_consts.get("gcd_AttackMinDelay") else None,
        "aramAttackSpeedCap": round(1 / aram_consts["gcd_AttackMinDelay"], 2) if aram_consts.get("gcd_AttackMinDelay") else None,
        "critOverflow": "adaptive" if any(re.search(r"Excess Critical Strike Chance .*Adaptive Force", l) for l in aura) else None,
        "runes": not kiwi_consts.get("SuppressRunesMasteriesPerks"),
        "cards": cards_per[-1],
        "augmentLevels": levels,
        "rerolls": dv("ARAM_Augment_Manager").get("InitialReroll"),
        "comboBreakerTenacity": dv("Kiwi_ComboBreaker").get("TenacityAmp"),
        "balance": consts.get("Kiwi_Balance", {}),
        "onFire": {"name": clean(s("Kiwi_OnFireBuff_Name")), "text": tip("Kiwi_OnFireBuff"), "values": dv("Kiwi_OnFireBuff")},
        "auraName": clean((re.search(r"<titleLeft>(.*?)</titleLeft>", s("buff_desc_MayhemicMagic")) or [None, ""])[1]),
    }

    rules["mechanics"] = mechanics(m12, modes, spells, dv)
    rules["economy"] = economy(m12, modes, kiwi_consts, aram_consts)
    rules["surrender"] = surrender(m12.get(modes.get("KIWI", {}).get("mSurrenderSettings"), {}))
    rules["turrets"] = turrets(get(f"{BASE}/{ch}/game/data/characters/turret/turret.bin.json"))
    configs = [c for c in (m12.get(k) for k in modes.get("KIWI", {}).get("Configs", [])) if isinstance(c, dict)]

    # ---- Champion quests that run in Mayhem: two champions in the same game each get a goal. The reward is a hidden
    # spell, so only the goals are shown. Quests that share a name (one per champion) are listed together.
    champs = {c["alias"].lower(): c for c in client("v1/champion-summary.json") if c.get("id", 0) > 0}
    rival_quests = []
    for q in next((c for c in configs if c.get("__type") == "CharacterQuestListConfig"), {}).get("CharacterQuestList", []):
        rows = []
        for side in (q.get("GeneralCondition") or {}).values():
            for x in side if isinstance(side, list) else []:
                c = champs.get(x.get("OwnerChampion", "").split("/")[-1].lower())
                if c:
                    rows.append({"id": c["id"], "name": c["name"], "icon": asset(c["squarePortraitPath"]), "text": clean(s(x.get("Tooltip")))})
        name = clean(s(q.get("QuestName")))
        same = next((r for r in rival_quests if r["name"] == name), None)
        if same:
            same["champions"] += rows
        elif name and rows:
            rival_quests.append({"key": q["QuestName"], "name": name, "champions": rows})

    # ---- When a rarity runs out of augments to offer, the game fills the selection from a fixed list. A list leaves
    # out its rarity when it's the default (Gold), so the Silver and Prismatic lists name theirs.
    fallback = next((c for c in configs if isinstance(c.get("{857c9848}"), list)), {})
    fallback_augments = []
    for f in fallback.get("{857c9848}", []):
        listed = [augments[p] for p in f.get("AugmentPool", []) if p in augments]
        fallback_augments.append({"tier": TIERS[f.get("rarity", 1)], "augments": [
            {"id": a.get("AugmentPlatformId"), "name": s(a["NameTra"], a["AugmentNameId"]), "tier": TIERS[a.get("rarity", 0)],
             "icon": asset(a["AugmentSmallIconPath"])} for a in listed]})
    fallback_augments.sort(key=lambda f: TIERS.index(f["tier"]))

    # ---- Summoner spells allowed in Mayhem, and augments that add one
    summoner_spells = client("v1/summoner-spells.json")
    allowed = [{"name": x["name"], "cooldown": x["cooldown"], "text": x["description"], "icon": asset(x["iconPath"])}
               for x in summoner_spells if "KIWI" in x.get("gameModes", [])]
    allowed.sort(key=lambda x: x["name"])
    by_key = {v["AugmentNameId"]: v for v in augments.values()}
    spell_augments = []
    for key in SPELL_AUGMENTS:
        a = by_key.get(key)
        if a:
            spell_augments.append({"name": s(a["NameTra"], key), "id": a.get("AugmentPlatformId"),
                                   "tier": TIERS[a.get("rarity", 0)], "icon": asset(a["AugmentSmallIconPath"]),
                                   "text": strip_unknown(s(a.get("DescriptionTra")).split('"')[0])})

    def expand(t):
        """Pull in strings referenced by key ({{ Some_Key }}) and drop inline icon tokens (%i:name%)."""
        t = re.sub(r"\{\{\s*spellname\s*\}\}", "{{SpellName}}", t or "", flags=re.I)
        for _ in range(3):
            t = re.sub(r"\{\{\s*(?!SpellName\b)([A-Za-z0-9_]+)\s*\}\}", lambda m: s(m.group(1)), t)
        return re.sub(r"%i:[A-Za-z0-9_]+%\s*", "", t)

    # ---- Live augments' text, for the rules below
    live = []
    for path in sorted(in_pool):
        a = kiwi.get(path)
        if a and a.get("Enabled") is not False:
            sp = (kiwi.get(a.get("RootSpell")) or {}).get("mSpell") or {}
            values = {d["name"].lower(): d["values"][0] for d in sp.get("DataValues") or [] if d.get("values")}
            text = " ".join(fill(expand(s(a.get("DescriptionTra"))), values, None, None).split())
            text = " ".join(x for x in re.split(r"(?<=[.!])\s+|(?<=[。！])", text) if not re.search(r"\?(?=[\s%.,/)s\u0e00-\u0e7f\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]|$)", x))
            raw_tip = expand(s(a.get("AugmentTooltipTra")) or s(a.get("DescriptionTra")))
            tip = fill(raw_tip, values, None, None)
            # a sentence with a number the client doesn't hold (a live counter or a formula) is dropped, not half-shown
            tip = "\n".join(" ".join(x for x in re.split(r"(?<=[.!])\s+|(?<=[。！])", l) if not re.search(r"\?(?=[\s%.,/)\u0e00-\u0e7f\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]|$)", x)).strip()
                            for l in tip.split("\n"))
            if "{{" in tip:  # a pulled-in string the client doesn't have: use the short description instead
                tip = text
            grants = re.findall(r"<spellName>([^<]+)</spellName>", raw_tip)
            m = re.search(r"Gain the (.+?) Keystone Runes?", text)
            if m:
                grants = [r.strip() for r in re.split(r",| and ", m.group(1)) if r.strip()] + grants
            nums = {}
            for d in sp.get("DataValues") or []:
                v = [round(x, 4) for x in d.get("values") or [] if x is not None]
                if v:
                    nums[d["name"]] = v[0] if len(set(v)) == 1 else v
            live.append({"id": a.get("AugmentPlatformId"), "name": s(a["NameTra"], a["AugmentNameId"]),
                         "tier": TIERS[a.get("rarity", 0)], "icon": asset(a["AugmentSmallIconPath"]), "text": text,
                         "tooltip": re.sub(r"\n{3,}", "\n\n", tip).strip(), "grants": list(dict.fromkeys(grants)),
                         "values": nums})
    live.sort(key=lambda a: (TIERS.index(a["tier"]), a["name"]))
    brief = lambda a: {k: a[k] for k in ("id", "name", "tier", "icon", "text")}  # noqa: E731

    # ---- Champion select: no rune page, so keystones only come from augments; spells regular ARAM has but Mayhem lacks
    keystones = []
    for a in live:
        m = re.search(r"Gain the (.+?) Keystone Runes?", a["text"])
        if m:
            keystones.append({**brief(a), "runes": [r.strip() for r in re.split(r",| and ", m.group(1)) if r.strip()]})
    champ_select = {
        "runes": rules["runes"],
        "keystoneAugments": keystones,
        "notInMayhem": sorted(x["name"] for x in summoner_spells
                              if "ARAM" in x.get("gameModes", []) and "KIWI" not in x.get("gameModes", [])),
    }

    # ---- Augments that change your selections: an extra augment, a random one in its place, or more rerolls
    selection_augments = [brief(a) for a in live if re.search(r"random (?:Silver |Gold |Prismatic )?Augment|reroll", a["text"], re.I)]
    golden_reroll = {"name": s("Kiwi_Golden_Reroll_Tooltip_Title"), "text": clean(s("Kiwi_Golden_Reroll_Tooltip_Desc")),
                     "icon": asset("/lol-game-data/assets/ASSETS/Rewards/Kiwi/GoldenReroll.png")}

    # ---- Items with Mayhem (or ARAM) values that differ from Summoner's Rift
    items_bin = Bin(get(f"{BASE}/{ch}/game/items.cdtb.bin.json"))
    item_changes = []
    for path, b in items_bin.items():
        o = (b.get("DataValuesModeOverride") or {}) if isinstance(b, dict) else {}
        iid = path.split("/")[-1]
        # ids above 100000 are other modes' copies of an item; keep the normal one
        if not ("Kiwi" in o or "ARAM" in o) or not iid.isdigit() or int(iid) >= 100000 or int(iid) not in items_by_id:
            continue
        base = {d["mName"]: d.get("mValue") for d in b.get("mDataValues", [])}
        mayhem = {}
        for mode in ("ARAM", "Kiwi"):  # Kiwi (Mayhem) is applied on top of the ARAM layer
            mayhem.update({d["mName"]: d.get("mValue") for d in (o.get(mode) or {}).get("DataValues", [])})
        diffs = [{"name": k, "rift": base.get(k), "mayhem": v} for k, v in mayhem.items() if base.get(k) != v]
        if diffs and not any(c["id"] == int(iid) for c in item_changes):
            it = items_by_id[int(iid)]
            item_changes.append({"id": int(iid), "name": it["name"], "icon": asset(it["iconPath"]), "changes": diffs})
    item_changes.sort(key=lambda x: x["name"])

    # ---- Items that live augments hand out. "reward" items (quest rewards, combined items) can't be bought, so
    # build stats should leave them out; "free" items are given at once but are also sold in the shop.
    names = {}
    for it in items_by_id.values():
        n = re.sub(r"<[^>]+>", "", it["name"]).strip()
        if len(n) > 3:
            names.setdefault(n, []).append(it["id"])
    granted = {}
    for path in sorted(in_pool):
        a = kiwi.get(path)
        if not a or a.get("Enabled") is False:
            continue
        text = " ".join(clean(s(a.get("DescriptionTra")) + " . " + s(a.get("AugmentTooltipTra"))).split())
        for n, ids in names.items():
            name = re.escape(n) + r"(?![\w'])"
            if re.search(r"(?:REWARD|Reward):\s*(?:Gain\s+(?:an?\s+)?)?" + name + r"|combine into\s+" + name, text):
                how = "reward"
            elif re.search(r"(?<!QUEST: )\b[Gg]ain\s+an?\s+" + name, text):
                how = "free"
            else:
                continue
            for iid in ids:
                if granted.get(iid, {}).get("how") != "reward":
                    granted[iid] = {"id": iid, "name": n, "how": how, "icon": asset(items_by_id[iid]["iconPath"]),
                                    "augmentId": a.get("AugmentPlatformId"), "augment": s(a["NameTra"], a["AugmentNameId"]),
                                    "augmentTier": TIERS[a.get("rarity", 0)]}
    granted = sorted(granted.values(), key=lambda g: (g["how"] != "reward", g["name"], g["id"]))

    # ---- Augment selections: when they come, what one shows, and the chance a given augment is in it
    cards = rules["cards"]  # each selection shows this many augments of one rarity, and each slot can be rerolled
    rerolls = int(rules["rerolls"] or 0)
    odds = {t: {"pool": n, "offer": round(min(1, cards / n), 4) if n else 0,
                "withRerolls": round(min(1, cards * (1 + rerolls) / n), 4) if n else 0}
            for t, n in tier_counts.items()}
    tier_of = {a["AugmentPlatformId"]: TIERS[a.get("rarity", 0)] for p, a in augments.items()
               if p in in_pool and a.get("Enabled") is not False}
    augment_rules = {"patch": version, "levels": rules["augmentLevels"], "cards": cards, "rerollsPerSlot": rerolls,
                     "odds": odds, "tiers": {str(k): v for k, v in sorted(tier_of.items())}, "grantedItems": granted,
                     "selectionAugments": selection_augments, "goldenReroll": golden_reroll}

    # ---- Mayhem progression track. The event hub has each track's dates and level count; the client's reward list
    # holds every track's rewards in order, one per level, so the current track is the last block of Mayhem rewards.
    track = official_track(build_track(client, asset, augments, s))
    unlocks = {r["augmentId"]: r["level"] for r in (track["levels"] if track else []) if r.get("augmentId")}
    augment_rules["unlocks"] = {str(k): v for k, v in sorted(unlocks.items())}

    # ---- Every live augment's full text, what it grants, its numbers and its track level, for the augment pages
    details = {str(a["id"]): {**{k: a[k] for k in ("name", "tier", "text", "tooltip", "grants", "values")},
                              "unlockLevel": unlocks.get(a["id"])} for a in live}

    # ---- Archive: Augment Sets
    sets = []
    for stem, fallback, fallback_bonus in AUGMENT_SETS:
        k = f"Kiwi_Augment_Set_{stem}_"
        raw = s(k + "Tracker") or s(k + "Tacker") or s(k + "Description")
        bonus = clean(raw).removeprefix("Set Bonus").strip()
        if "@" in bonus or not bonus:
            bonus = fallback_bonus or strip_unknown(bonus)
        sets.append({"name": s(k + "Name") or fallback, "bonus": bonus})

    out = {
        "patch": version,
        "hero": f"{gd}/assets/leagueclient/gamemodeassets/kiwi/kiwi-tutorial-set2.png",
        "queues": [{"id": i, "name": n} for i, n in mayhem_queues],
        "augmentCounts": tier_counts, "maps": maps, "summons": summons, "items": items,
        "quests": quests, "challenges": challenges, "rules": rules, "spells": allowed,
        "spellAugments": spell_augments, "itemChanges": item_changes, "augmentSets": sets,
        "augmentRules": {k: v for k, v in augment_rules.items() if k != "tiers"},
        "champSelect": champ_select,
        "rivalQuests": rival_quests,
        "fallbackAugments": fallback_augments,
        "track": track,
        "story": STORY,
    }
    # mode-wide numbers the simulator and site pages use
    mode_rules = {"patch": version, "attackSpeedCap": rules["attackSpeedCap"], "aramAttackSpeedCap": rules["aramAttackSpeedCap"],
                  "critOverflow": rules["critOverflow"], "runes": rules["runes"], "aura": rules["aura"],
                  "keystoneAugments": {str(a["id"]): a["runes"] for a in keystones}, **rules["mechanics"],
                  "economy": rules["economy"], "turrets": rules["turrets"]}
    return {"out": out, "mode_rules": mode_rules, "augment_rules": augment_rules, "details": details,
            # names in the build's language, by id, for the translations (localize())
            "runes": {p["id"]: p["name"] for p in client("v1/perks.json")},
            "augmentNames": {str(a["id"]): a.get("nameTRA") for a in client("v1/cherry-augments.json") if a.get("nameTRA")},
            "itemNames": {str(i): it["name"] for i, it in items_by_id.items()}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    ap.add_argument("--languages", action="store_true",
                    help="also write i18n/data and i18n/augments: the game text in each of the site's other languages")
    args = ap.parse_args()
    en = build(args.channel)
    out, version = en["out"], en["out"]["patch"]
    with open(os.path.join(HERE, "augment_details.json"), "w") as f:
        f.write(site_paths(json.dumps({"patch": version, "augments": en["details"]}, indent=1, ensure_ascii=False)) + "\n")
    with open(os.path.join(HERE, "mode_rules.json"), "w") as f:
        json.dump(en["mode_rules"], f, indent=1, ensure_ascii=False)
        f.write("\n")
    # the same rules plus each augment's rarity, for the site's augment pages and build tables
    with open(os.path.join(HERE, "augment_rules.json"), "w") as f:
        json.dump(en["augment_rules"], f, indent=1, ensure_ascii=False)
        f.write("\n")
    with open(os.path.join(HERE, "data.js"), "w") as f:
        # no header comment: the file ships to the site, and pages don't say where data comes from
        f.write("window.GUIDE_DATA = " + site_paths(json.dumps(out, indent=1, ensure_ascii=False)) + ";\n")
    print(f"{version}: {len(out['quests'])} quests, {len(out['challenges'])} challenges "
          f"({sum(c['mayhem'] for c in out['challenges'])} count Mayhem), {len(out['items'])} items, pool {out['augmentCounts']}")
    if args.languages:
        for code, lo in languages():
            data, augs = localize(en, build(args.channel, lo))
            write_json(os.path.join(HERE, "i18n", "data", f"{code}.json"), data)
            write_json(os.path.join(HERE, "i18n", "augments", f"{code}.json"), {"patch": version, "augments": augs})
            print(f"{code}: {len(json.dumps(data, ensure_ascii=False)) // 1024} KB of game text")


def languages():
    """The site's other languages as (site code, client folder): ("fr", "fr_fr"), from web/src/i18n/languages.json."""
    with open(os.path.join(os.path.dirname(HERE), "web", "src", "i18n", "languages.json"), encoding="utf-8") as f:
        return [(l["code"], l["riot"].lower()) for l in json.load(f) if l["code"] != "en"]


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")


# Text keys localize() copies from another language's build; everything else (ids, tiers, kinds, numbers) stays English
TEXT_KEYS = {"name", "title", "text", "tooltip", "quest", "reward", "notes", "bonus", "aura", "auraName", "group", "augment"}
# List items are matched by the first of these they have, so a list sorted by name still lines up
MATCH_KEYS = ("id", "key", "augmentId", "level", "icon", "minimap")


def overlay(en, lo, key=None):
    """The parts of lo (another language's build) that differ from en at text keys, as a sparse tree; lists become
    {index: ...} with items matched by MATCH_KEYS, else by position when both lists are the same length."""
    if isinstance(en, str):
        return lo if key in TEXT_KEYS and isinstance(lo, str) and lo and lo != en else None
    if isinstance(en, dict) and isinstance(lo, dict):
        out = {k: overlay(v, lo.get(k), k) for k, v in en.items() if k in lo}
        return {k: v for k, v in out.items() if v is not None} or None
    if isinstance(en, list) and isinstance(lo, list):
        match = next((m for m in MATCH_KEYS if en and all(isinstance(x, dict) and x.get(m) is not None for x in en + lo)), None)
        if match:
            by = {x[match]: x for x in lo}
            pairs = [(i, x, by.get(x[match])) for i, x in enumerate(en)]
        elif len(en) == len(lo):
            pairs = [(i, x, lo[i]) for i, x in enumerate(en)]
        else:
            return None
        out = {str(i): overlay(x, y, key) for i, x, y in pairs if y is not None}
        return {k: v for k, v in out.items() if v is not None} or None
    return None


def localize(en, lo):
    """Another language's game text for the Info page (merged into GUIDE_DATA by the page) and every live augment's
    name, text and tooltip (for the site's augment pages). Where English-only parsing leaves a gap in the other build,
    names and text are filled by id."""
    E, L = en["out"], lo["out"]
    tree = overlay(E, L) or {}
    det, names, items = lo["details"], lo["augmentNames"], lo["itemNames"]
    runes = {en["runes"][i]: n for i, n in lo["runes"].items() if i in en["runes"] and en["runes"][i] != n}

    def put(path, value, english):
        if not value or value == english:
            return
        node = tree
        for p in path[:-1]:
            node = node.setdefault(str(p), {})
        node.setdefault(str(path[-1]), value)

    for k in ("keystoneAugments",):
        for i, a in enumerate(E["champSelect"][k]):
            d = det.get(str(a["id"]), {})
            put(["champSelect", k, i, "name"], d.get("name"), a["name"])
            put(["champSelect", k, i, "text"], d.get("text"), a["text"])
            for j, r in enumerate(a["runes"]):
                put(["champSelect", k, i, "runes", j], runes.get(r), r)
    for i, a in enumerate(E["augmentRules"].get("selectionAugments") or []):
        d = det.get(str(a["id"]), {})
        put(["augmentRules", "selectionAugments", i, "name"], d.get("name"), a["name"])
        put(["augmentRules", "selectionAugments", i, "text"], d.get("text"), a["text"])
    for i, g in enumerate(E["augmentRules"].get("grantedItems") or []):
        put(["augmentRules", "grantedItems", i, "name"], items.get(str(g["id"])), g["name"])
        put(["augmentRules", "grantedItems", i, "augment"], names.get(str(g["augmentId"])), g["augment"])
    for i, it in enumerate(E["itemChanges"]):
        put(["itemChanges", i, "name"], items.get(str(it["id"])), it["name"])
    for i, r in enumerate((E.get("track") or {}).get("levels") or []):
        if r.get("augmentId"):
            put(["track", "levels", i, "name"], names.get(str(r["augmentId"])), r["name"])
    data = {"guide": tree}
    augs = {i: {k: d[k] for k in ("name", "text", "tooltip") if d.get(k)} for i, d in det.items()}
    for i, d in en["details"].items():  # an augment only English parsing found still gets its name
        if i not in augs and names.get(i):
            augs[i] = {"name": names[i]}
    return data, augs


# Mode mechanics the client files don't hold. Read from the official League wiki's ARAM, ARAM: Mayhem, Health Relic and
# map pages on 2026-10-17 (Nico allowed the official wiki that day). Everything else in mechanics() is read from map12.bin.
WIKI_MECHANICS = {
    "startLevel": 3,
    "longRangeReductionMax": 0.30,  # 85% -> 70% damage taken, by distance past the range
    "longRangeExcludes": ["damage over time", "ultimate abilities"],
    "critOverflow": {"adPerPercent": 0.45, "apPerPercent": 0.75},  # per 1% Critical Strike Chance over 100%
    "relicPickup": 0.08, "relicFirstOuter": 105, "relicFirstInner": 150, "relicRespawn": 90,
    "fastTravel": [
        {"map": "Howling Abyss", "name": "Frost Gates",
         "text": "Gates behind each Nexus send you from base to just in front of your outer turret, or your inhibitor turret once the outer turret falls. They only go one way, out of base."},
        {"map": "Koeshin's Crossing", "name": "Portals",
         "text": "One pair sends you out of base, one way only. A second pair by the side wall goes both ways. Entering takes a short channel that damage interrupts."},
        {"map": "Butcher's Bridge", "name": "Cannon Launchers",
         "text": "Launchers next to each base fire you out into the lane."},
        {"map": "Bridge of Progress", "name": "Hex gates and Acceleration Pads",
         "text": "Hex gates (manholes on the Zaun side) send you out of base. Acceleration Pads give 25% bonus Move Speed for 1 second."},
    ],
}


# How the mode has changed, in our own words from Riot's /dev posts and dev updates (read 2026-10-17)
STORY = [
    {"date": "2025-10", "text": "Mayhem arrives as its own queue next to regular ARAM, with Arena augments plus over 40 new ones. Augments with an always-on effect are left out so ten players stay readable."},
    {"date": "2026-01", "text": "The mode's run is extended, and patch 26.3 adds Augment Sets and the progression track."},
    {"date": "2026-03", "text": "Mayhem stays with no planned end date."},
    {"date": "2026-06", "text": "Patch 26.12 removes Augment Sets, since builds and games felt too alike. Popular set effects come back as single augments, and Ability Augments arrive, each one powering up a single ability."},
    {"date": "2026-07", "text": "Mayhem Classic-ish runs for a limited time in its own queue: only the 60 original champions in their current form, a Classic-style map, Classic items and Classic-themed augments."},
    {"date": "Next", "text": "A music-themed set with new augments, a musical act on stage at spawn, and missions with rewards of their own."},
]


def mechanics(m12, modes, spells, dv):
    """Mode-wide mechanics for the Info page and the Simulator: map12.bin numbers, with WIKI_MECHANICS for the rest."""
    W = WIKI_MECHANICS
    script = {v["mName"]: {k: c.get("mValue") for k, c in v.get("mConstants", {}).items()}
              for v in m12.values() if isinstance(v, dict) and v.get("__type") == "ScriptDataObject"}
    pace, trap = script.get("ARAMGamePacingScriptData", {}), script.get("ARAMMinionTrapDetectionScriptData", {})
    death = m12.get(modes.get("KIWI", {}).get("mDeathTimes"), {})
    relic_spell = (spells.get("HowlingAbyssRelicAura_AOE", {}).get("mSpell") or {})
    relic = dv("HowlingAbyssRelicAura_AOE")
    kiwi_relic = {d["name"]: d["values"][0] for d in
                  ((relic_spell.get("DataValuesModeOverride") or {}).get("Kiwi") or {}).get("SpellDataValues", [])}
    gate = dv("Bloom_Hexgate_SpeedBuff")
    per_level = death.get("mTimeDeadPerLevel") or []
    start = W["startLevel"]
    return {
        "startLevel": start,
        "respawn": {
            "byLevel": {str(lvl): per_level[lvl - 1] for lvl in range(start, len(per_level) + 1)},
            # past scaleFrom seconds, timers grow scalePerStep every scaleStep seconds, up to scaleCap times
            "scaleFrom": death.get("mScalingStartTime"), "scaleStep": death.get("mScalingIncrementTime"),
            "scalePerStep": round(death.get("mScalingPercentIncrease") or 0, 4), "scaleCap": round(death.get("mScalingPercentCap") or 0, 4),
        } if per_level else None,
        "longRange": {"range": pace.get("PokeDamageReductionRange"), "reductionMin": round(pace.get("PokeDamageReduction") or 0, 4),
                      "reductionMax": W["longRangeReductionMax"], "excludes": W["longRangeExcludes"]}
        if pace.get("PokeDamageReductionRange") else None,
        "critConversion": W["critOverflow"],
        "structures": {"bonusMax": round((pace.get("TowerDamageLateMultiplier") or 1) - 1, 4),
                       "from": pace.get("TowerDamageMultiplierMinTime"), "to": pace.get("TowerDamageMultiplierMaxTime")}
        if pace.get("TowerDamageLateMultiplier") else None,
        "minions": {"aoeMultiplier": round(pace.get("MinionAoEDamageMultiplierLate") or 0, 4) or None,
                    "blackout": {"units": ["siege", "super"], "range": trap.get("DetectionRange"),
                                 "revealSeconds": trap.get("TrapSightDuration")} if trap else None},
        "relics": {"pickup": W["relicPickup"], "beam": round(kiwi_relic.get("MissingHealthRestoreMult", relic.get("MissingHealthRestoreMult", 0)), 4),
                   "aramBeam": round(relic.get("MissingHealthRestoreMult", 0), 4),
                   "radius": relic.get("HealingRadius"), "delay": relic.get("AoEDelay"),
                   "firstOuter": W["relicFirstOuter"], "firstInner": W["relicFirstInner"], "respawn": W["relicRespawn"]}
        if relic else None,
        "fastTravel": W["fastTravel"],
        "portalSpeed": {"bonus": round(gate["BonusMS"], 4), "seconds": gate.get("Duration")} if gate.get("BonusMS") else None,
    }


MAX_LEVEL = 18


def economy(m12, modes, kiwi, aram):
    """Gold and XP numbers from the mode's settings (plain ARAM's passive gold alongside, to compare)."""
    mode = modes.get("KIWI", {})
    bounty = next((c for c in (m12.get(k) for k in mode.get("Configs", [])) if isinstance(c, dict) and "BaseGold" in c), {})
    curve = m12.get(mode.get("mExperienceCurveData"), {}) or {}
    split = (m12.get(mode.get("mExperienceModData"), {}) or {}).get("mPlayerMinionSplitXp") or []
    # total XP to reach level L is need[L - 2]; XP for killing a level L champion is kill[L - 1]
    need, kill = curve.get("mExperienceRequiredPerLevel") or [], curve.get("mExperienceGrantedForKillPerLevel") or []

    def per_minute(c, kind):
        every = c.get(f"ai_Ambient{kind}Interval")
        return round(c[f"ai_Ambient{kind}Amount"] * 60 / every, 1) if every and c.get(f"ai_Ambient{kind}Amount") else None
    gap = (curve.get("LevelDifferenceExperienceMultiplierPerLevel") or [0])[0]
    return {
        "startingGold": kiwi.get("ai_StartingGold"),
        "passiveGold": {"amount": kiwi.get("ai_AmbientGoldAmount"), "every": kiwi.get("ai_AmbientGoldInterval"),
                        "perMinute": per_minute(kiwi, "Gold"), "aramPerMinute": per_minute(aram, "Gold")},
        "passiveXp": {"amount": kiwi.get("ai_AmbientXPAmount"), "every": kiwi.get("ai_AmbientXPInterval"),
                      "perMinute": per_minute(kiwi, "XP")},
        "killGold": (bounty.get("BaseGold") or [None])[0], "firstBlood": bounty.get("FirstBloodBonus"),
        "assistSeconds": bounty.get("AssistDurationOverride"),
        "levels": [{"level": lvl, "xp": need[lvl - 2], "killXp": kill[lvl - 1]}
                   for lvl in range(WIKI_MECHANICS["startLevel"] + 1, MAX_LEVEL + 1) if lvl - 2 < len(need) and lvl - 1 < len(kill)],
        "minionXpSplit": [round(x, 4) for x in split],
        "levelGapXp": round(gap, 4) or None,
    }


TURRETS = {"outer": "HA_Outer", "inhibitor": "HA_Inhibitor", "nexus": "HA_Nexus"}


def turrets(bin_):
    """The Howling Abyss turrets' stats. A turret can carry per-mode overrides; Mayhem's (KIWI) health replaces the
    base value when there is one."""
    out = []
    for key, name in TURRETS.items():
        r = bin_.get(f"Characters/Turret/CharacterRecords/{name}")
        if not r:
            continue

        def val(f):
            v = r.get(f)
            return round(v.get("baseValue", 0), 3) if isinstance(v, dict) else v
        mode = next((o.get("{cf19cb5d}") or {} for o in r.get("{6854087e}") or []
                     if isinstance(o, dict) and str(o.get("{e4f7105d}", "")).endswith("/KIWI")), {})
        out.append({"key": key, "hp": mode.get("baseHP") or val("baseHPModifiable"),
                    "baseHp": val("baseHPModifiable") if mode.get("baseHP") else None,
                    "damage": val("baseDamageModifiable"), "armor": val("baseArmorModifiable"), "mr": val("baseMR"),
                    "range": val("attackRangeModifiable"), "attackSpeed": val("attackSpeedModifiable"),
                    "gold": r.get("globalGoldGivenOnDeath"), "xp": r.get("globalExpGivenOnDeath")})
    return out


def surrender(sd):
    """Surrender and remake timing. Type 0 is the remake vote; the vote shares of the other types aren't shown until
    they're checked in a game."""
    types = sd.get("mTypeData") or {}
    remake = types.get("0") or types.get(0) or {}
    others = [t for k, t in types.items() if str(k) != "0" and isinstance(t, dict)]
    if not others:
        return None
    return {"voteSeconds": remake.get("VoteTimeout") or others[0].get("VoteTimeout"),
            "opens": min(t["startTime"] for t in others if t.get("startTime")),
            "opensWithAfk": min(t["StartTimeWithAfk"] for t in others if t.get("StartTimeWithAfk")),
            "remakeFrom": remake.get("startTime"),
            "remakeUntil": remake["startTime"] + remake["windowLength"] if remake.get("startTime") and remake.get("windowLength") else None}


# What Riot's support article on ARAM: Mayhem adds to the client's track data (read 2026-10-17). It applies only while
# the track it was written for is live: XP per level, reward names the client leaves blank, and how XP is earned.
OFFICIAL_TRACK = {
    "size": 32,
    "xp": [150] * 6 + [200] * 6 + [250] * 6 + [350] * 6 + [400] * 6 + [450] * 2,
    "names": {5: "Blessed Card+", 9: "Ability Augment+", 23: "Celebration Selfie Icon", 29: "Agent of Chaos"},
    "notes": {1: "Rerolls have a better chance to land on a higher-tier augment.",
              5: "A better chance of the ARAM Blessing in champion select.",
              9: "A better chance of an Ability Augment at the start of the game.",
              13: "A new kind of Poro Snax.", 21: "A new hat."},
    "objectives": [{"text": "Play Mayhem", "xp": 1, "per": "minute"}, {"text": "Play a game as a Marksman or Tank", "xp": 60, "per": "day"},
                   {"text": "Play 6 games", "xp": 300, "per": "week"}, {"text": "Reroll augments 20 times", "xp": 450, "per": "once"}],
    "guaranteed": "A newly unlocked Gold or Prismatic augment is sure to be offered in your next game if it fits the draft.",
}


def official_track(track):
    """Add OFFICIAL_TRACK's XP, names and notes when the live track has its 32 levels; otherwise leave the track as is."""
    O = OFFICIAL_TRACK
    if not track or track["size"] != O["size"] or len(track["levels"]) != O["size"]:
        return track
    for row in track["levels"]:
        n = row["level"]
        row["xp"] = O["xp"][n - 1]
        row["name"] = O["names"].get(n, row["name"])
        if n in O["notes"]:
            row["note"] = O["notes"][n]
    track.update(totalXp=sum(O["xp"]), objectives=O["objectives"], guaranteed=O["guaranteed"])
    return track


def build_track(client, asset, augments, s):
    """The current Mayhem progression track: name, dates and what each level gives (augment, emote, icon or other)."""
    events = [e["event"] for e in client("v1/event-hub.json")
              if e.get("event", {}).get("seasonPassSubType") == "kMayhem"]
    if not events:
        return None
    ev = max(events, key=lambda e: e["startDate"])
    size = max((c.get("chapterEnd", 0) for c in ev.get("chapters", [])), default=0)
    def image(r):
        first = ((r or {}).get("rewards") or [None])[0] or {}
        return (first.get("media") or {}).get("image") or ""
    rewards = client("v1/rewards.json")
    mayhem = [i for i, r in enumerate(rewards) if re.search(r"/Kiwi/|/AramMayhem/", image(r))]
    if not size or not mayhem or mayhem[-1] + 1 < size:
        return None
    block = rewards[mayhem[-1] + 1 - size: mayhem[-1] + 1]
    if sum(1 for r in block if re.search(r"/Kiwi/|/AramMayhem/", image(r))) < size / 2:
        return None  # the list's layout changed; don't guess
    by_icon = {}
    for a in augments.values():
        stem = a["AugmentLargeIconPath"].split("/")[-1].lower().split(".")[0].removesuffix("_large")
        by_icon.setdefault(stem, a)
        by_icon.setdefault(a["AugmentNameId"].lower().removeprefix("aram_").removesuffix("_active"), a)
    emotes = {e["inventoryIcon"].split("/")[-1].lower(): e for e in client("v1/summoner-emotes.json") if e.get("inventoryIcon")}
    icons = {str(i["id"]): i for i in client("v1/summoner-icons.json")}
    words = lambda n: re.sub(r"(?<=[a-z])(?=[A-Z])", " ", n)  # noqa: E731
    levels = []
    for n, r in enumerate(block, 1):
        img = image(r)
        f = img.split("/")[-1]
        stem = f.lower().split(".")[0].removesuffix("_large").removeprefix("augment_").removeprefix("quest")
        # the site's asset paths swap "kiwi" for "mayhem", so a file whose real path says "mayhem" can't be mirrored
        row = {"level": n, "icon": asset(img) if img and "mayhem" not in img.lower() else None}
        if "/Augments/" in img or "/Augment_" in img:
            a = by_icon.get(stem)
            row.update(kind="Augment", name=s(a["NameTra"], a["AugmentNameId"]) if a else words(f.split(".")[0]),
                       augmentId=a.get("AugmentPlatformId") if a else None, tier=TIERS[a.get("rarity", 0)] if a else None)
        elif "SummonerEmotes" in img:
            row.update(kind="Emote", name=(emotes.get(f.lower()) or {}).get("name") or words(f.split(".")[0]))
        elif "SummonerIcons" in img:
            row.update(kind="Icon", name=(icons.get(f.split(".")[0]) or {}).get("title") or "Profile icon")
        elif "Achievement_Title" in img:
            row.update(kind="Title", name="A title")
        else:
            name = s("Kiwi_Golden_Reroll_Tooltip_Title") if stem == "goldenreroll" else words(f.split(".")[0])
            row.update(kind="Reward", name=name)
        levels.append(row)
    return {"name": ev.get("localizedName"), "start": ev["startDate"][:10], "end": ev.get("progressEndDate", ev["endDate"])[:10],
            "size": size, "levels": levels}


def fill(text, values, need, tier):
    """Fill a quest tooltip's @Name@ placeholders from the augment's data values; unknown ones become "?"."""
    def rep(m):
        name, mult = m.group(1), 1.0
        if "*" in name:
            name, factor = name.split("*", 1)
            try:
                mult = float(factor)
            except ValueError:
                pass
        key = name.lower()
        if key == "questrequirement" and need is not None:
            v = need
        elif key == "questtier":
            v = tier
        elif key == "spellname":
            return "{{SpellName}}"
        elif key in values:
            v = values[key] * mult
        else:
            return "?"
        return f"{v:g}"
    text = re.sub(r"@([A-Za-z0-9_.]+(?:\*-?[0-9.]+)?)@", rep, text or "")
    if SPELL_NAME == CHOSEN_ABILITY["en_us"]:
        text = re.sub(r"your \{\{ ?SpellName ?\}\}", SPELL_NAME, text)
    text = re.sub(r"\{\{ ?SpellName ?\}\}", SPELL_NAME, text)
    return clean(text)


def quest_labels(text):
    """A milestone's highlighted labels, in any language, as the English QUEST: and REWARD: (first and second)."""
    n = iter(("QUEST:", "REWARD:"))
    text = re.sub(r"%i:[A-Za-z0-9_]+%\s*", "", text or "")  # inline stat icons
    return re.sub(r"<font color='#F0C200'>[^<]*</font>", lambda m: next(n, m.group(0)), text)


def split_quest(text):
    """Split a milestone tooltip into the quest, its reward and any other lasting notes.
    Lines that show live progress ("Poros Fed: ?/12") or current state (anything with an unknown "?") are dropped."""
    out = {"quest": "", "reward": "", "notes": []}
    for para in re.split(r"\n\s*\n", text):
        lines = [l.strip() for l in para.split("\n") if l.strip()]
        if lines and lines[0].upper().startswith(("QUEST:", "REWARD:")):
            # keep the line, drop just the unknown number ("dealing ? damage" -> "dealing damage")
            lines = [re.sub(r"\s*\?(?=[\s%.,\u0e00-\u0e7f\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]|$)", "", l) for l in lines if not re.search(r":\s*\?", l)]
        else:
            lines = [l for l in lines if "?" not in l]
        para = re.sub(r"\s+([.,])", r"\1", " ".join(lines))
        if not para:
            continue
        if para.upper().startswith("QUEST:"):
            out["quest"] = upper_first(para[6:].strip())
        elif para.upper().startswith("REWARD:"):
            out["reward"] = upper_first(para[7:].strip())
        elif out["quest"] and (para.startswith('"') or " - " in para):
            out["notes"].append(para)
    return out


def upper_first(text):
    """Some languages start the text after "QUEST:" in lower case; on its own line it starts a sentence."""
    return text[:1].upper() + text[1:]


def strip_unknown(text):
    """Game text with its @placeholders@ dropped, for strings whose numbers aren't in the client data."""
    text = re.sub(r"\s*@[^@]+@\s*%?", " ", text or "")
    return re.sub(r"\s+([.,%)])", r"\1", clean(text)).replace("  ", " ").strip()


def clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text or "")
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()


if __name__ == "__main__":
    main()
