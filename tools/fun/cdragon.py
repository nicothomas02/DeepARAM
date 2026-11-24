"""Shared CommunityDragon helpers for the Fun Tools data builders. Python 3 standard library only."""
import json, re, time, urllib.error, urllib.request

BASE = "https://raw.communitydragon.org"
MANA_PARTS = {"NumberCalculationPart", "NamedDataValueCalculationPart", "AbilityResourceByCoefficientCalculationPart"}


def get(url, tries=4, raw=False):
    # CommunityDragon refuses Python's default User-Agent. Retry, since many parallel requests sometimes drop.
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-fun-tools"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read() if raw else json.load(r)
        except (urllib.error.URLError, ConnectionError):
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


class Game:
    """Lazily loaded game files for one channel (latest or pbe)."""

    def __init__(self, channel="latest"):
        self.ch = channel
        self._cache = {}

    def _load(self, key, url):
        if key not in self._cache:
            self._cache[key] = get(url)
        return self._cache[key]

    @property
    def gd(self):
        return f"{BASE}/{self.ch}/plugins/rcp-be-lol-game-data/global/default/v1"

    @property
    def version(self):
        return self._load("ver", f"{BASE}/{self.ch}/content-metadata.json")["version"].split("+")[0]

    @property
    def strings(self):
        return self._load("str", f"{BASE}/{self.ch}/game/en_us/data/menu/en_us/lol.stringtable.json")["entries"]

    @property
    def items_summary(self):
        return {i["id"]: i for i in self._load("items", f"{self.gd}/items.json")}

    @property
    def items_bin(self):
        return self._load("itemsbin", f"{BASE}/{self.ch}/game/items.cdtb.bin.json")

    @property
    def kiwi(self):
        return self._load("kiwi", f"{BASE}/{self.ch}/game/maps/modespecificdata/kiwi.bin.json")

    def champion_bin(self, alias):
        a = alias.lower()
        return self._load(f"ch:{a}", f"{BASE}/{self.ch}/game/data/characters/{a}/{a}.bin.json")

    def asset_url(self, path):
        """Turn a game asset path (.tex/.dds or /lol-game-data/assets/...) into a CommunityDragon PNG URL."""
        p = path.lower()
        if p.startswith("/lol-game-data/assets/"):
            return f"{BASE}/{self.ch}/plugins/rcp-be-lol-game-data/global/default/" + p[len("/lol-game-data/assets/"):]
        return f"{BASE}/{self.ch}/game/" + re.sub(r"\.(tex|dds)$", ".png", p)

    def champion_icon(self, champ_id):
        return f"{self.gd}/champion-icons/{champ_id}.png"

    def item(self, iid):
        """Item stats and data values, with ARAM then Mayhem (Kiwi) overrides applied. None if missing."""
        b, s = self.items_bin.get(f"Items/{iid}"), self.items_summary.get(iid)
        if not b or not s:
            return None
        dv = {d["mName"]: d["mValue"] for d in b.get("mDataValues", []) if "mValue" in d}
        for mode in ("ARAM", "Kiwi"):
            for d in (b.get("DataValuesModeOverride") or {}).get(mode, {}).get("DataValues", []):
                dv[d["mName"]] = d["mValue"]
        return {
            "id": iid, "name": s["name"], "price": s["priceTotal"], "icon": self.asset_url(s["iconPath"]),
            "ap": b.get("mFlatMagicDamageMod", 0.0), "mana": b.get("flatMPPoolMod", 0.0),
            "hp": b.get("mFlatHPPoolMod", 0.0), "haste": b.get("mAbilityHasteMod", 0.0),
            "values": dv, "calcs": calcs(b.get("mItemCalculations"), dv),
            "limitGroups": [g for g in b.get("mItemGroups", []) if (self.items_bin.get(g) or {}).get("mMaxGroupOwnable") == 1],
            "text": clean(s["description"])[:400],
        }

    def augment(self, name_id):
        """Mayhem augment data values and simple calculations. None if missing."""
        a = next((v for v in self.kiwi.values() if isinstance(v, dict) and v.get("__type") == "AugmentData"
                  and v.get("AugmentNameId") == name_id), None)
        if not a:
            return None
        sp = self.kiwi.get(a["RootSpell"], {}).get("mSpell", {})
        dv = {d["name"]: d["values"][0] for d in sp.get("DataValues", []) if d.get("values")}
        return {
            "key": name_id, "id": a["AugmentPlatformId"],
            "name": self.strings.get(a["NameTra"].lower(), name_id),
            "tier": ["Silver", "Gold", "Prismatic"][a.get("rarity", 0)],
            "icon": self.asset_url(a["AugmentSmallIconPath"]),
            "values": dv, "calcs": calcs(sp.get("mSpellCalculations"), dv),
            "text": clean(self.strings.get(a["AugmentTooltipTra"].lower(), "")),
        }


def clean(text):
    text = re.sub(r"<br\s*/?>", " ", text or "")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text)).strip()


def calcs(spell_calcs, values):
    """Keep the simple calculations: a value that grows from level 1 to 18, or flat + a Mana ratio."""
    out = {}
    for name, c in (spell_calcs or {}).items():
        parts = c.get("mFormulaParts") or []
        if len(parts) == 1 and parts[0].get("__type") == "ByCharLevelInterpolationCalculationPart":
            out[name] = {"lvl1": parts[0].get("mStartValue", 0.0), "lvl18": parts[0].get("mEndValue", 0.0)}
        elif parts and all(p.get("__type") in MANA_PARTS for p in parts):
            # flat + mana ratio, e.g. Overflow's 10% + 0.5% per 100 max Mana
            flat = sum(p.get("mNumber", 0.0) for p in parts if p["__type"] == "NumberCalculationPart")
            for p in parts:
                if p["__type"] == "NamedDataValueCalculationPart":
                    flat += values.get(p["mDataValue"], 0.0)
            ratio = [p for p in parts if p["__type"] == "AbilityResourceByCoefficientCalculationPart"]
            if ratio:
                out[name] = {"flat": flat, "manaRatio": ratio[0].get("mCoefficient", 0.0),
                             "bonusOnly": ratio[0].get("mStatFormula") == 2,
                             "multiplier": (c.get("mMultiplier") or {}).get("mNumber", 1.0)}
    return out


def write_data_js(path, var, data):
    # Pages load icons from the site's own copies (/assets/cd/..., see web/scripts/fetch_assets.py).
    # The mirror keeps CommunityDragon's "kiwi" (Mayhem) folders under "mayhem", so the paths must say so too.
    text = re.sub(r'"/assets/cd/[^"]*"', lambda m: m.group(0).replace("kiwi", "mayhem"),
                  json.dumps(data, indent=1, ensure_ascii=False).replace(BASE + "/", "/assets/cd/"))
    with open(path, "w") as f:
        f.write(f"window.{var} = " + text + ";\n")
