"""The game's own item groupings, written to web/src/data/item-groups.json, for the Items tab and item pages.

From the client's item data (CommunityDragon game/items.cdtb.bin.json), for every Howling Abyss item in the
bundled Data Dragon item.json:
  e  epicness, the shop's rarity: none = basic, 1 = starter, 4 = epic, 5 = legendary, 7 = elixir, 0 = other
  g  named item groups the item belongs to (Boots, Consumable, DoransItems, ...); unnamed hashes dropped
  c  shop class filters, from the item's attributes: fighter, marksman, assassin, mage, tank, support
  m  1 when ARAM Mayhem's shop lists it (the Kiwi mode's item lists in the Howling Abyss map data)

Also web/src/data/item-limits.json: the game's ownership limits that tie two or more different shop items together
(mItemGroups whose group has mMaxGroupOwnable), e.g. the Last Whisper group (Lord Dominik's, Terminus, Mortal
Reminder, Serylda's, Black Cleaver) or Lifeline (Sterak's, Maw, Shieldbow...): you can own at most `max` of them.
Builds and swaps must respect them (Nico 2026-11-23). Shape: [{"group": name, "max": n, "items": [ids]}].

Usage (from the repo root):
  python3 web/scripts/fetch_item_groups.py
fetch_assets.py --refresh runs it too, so the groups follow each patch.
"""
import json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(WEB, "src", "data", "item-groups.json")
LIMITS = os.path.join(WEB, "src", "data", "item-limits.json")
URL = "https://raw.communitydragon.org/latest/game/items.cdtb.bin.json"
MAP = "https://raw.communitydragon.org/latest/game/data/maps/shipping/map12/map12.bin.json"
MODE = "Maps/Shipping/Map12/Modes/KIWI"
UA = {"User-Agent": "deeparam-items"}  # CommunityDragon refuses Python's default User-Agent
# mItemAttributes values: the class filters in the in-game shop.
CLASSES = {1: "fighter", 2: "marksman", 4: "assassin", 8: "tank", 16: "mage", 32: "support"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def mayhem_items():
    """Item ids in ARAM Mayhem's shop lists."""
    m = get(MAP)
    return {int(i) for ref in m[MODE]["itemLists"] for i in re.findall(r"Items/(\d+)", json.dumps(m.get(ref, {})))}


def limits(bins, keys):
    """Ownership limits shared by two or more of these items (group paths, or hashes for unnamed groups)."""
    members, cap = {}, {}
    for key in keys:
        for g in (bins.get(f"Items/{key}") or {}).get("mItemGroups", []):
            gv = bins.get(g)
            if not isinstance(gv, dict) or "mMaxGroupOwnable" not in gv:
                continue
            members.setdefault(g, set()).add(int(key))
            cap[g] = gv["mMaxGroupOwnable"]
    out = []
    for g, ids in members.items():
        if len(ids) < 2 or cap[g] >= len(ids):
            continue
        out.append({"group": g.rsplit("/", 1)[-1], "max": cap[g], "items": sorted(ids)})
    return sorted(out, key=lambda r: (r["group"].startswith("{"), r["group"], r["items"]))


def main():
    version = json.load(open(os.path.join(WEB, "src", "data", "dd-version.json")))
    version = version["version"] if isinstance(version, dict) else version
    dd = json.load(open(os.path.join(WEB, "public", "assets", "dd", version, "data", "en_US", "item.json")))["data"]
    bins = get(URL)
    mayhem = mayhem_items()
    out = {}
    for key, item in dd.items():
        if not item.get("maps", {}).get("12"):
            continue
        b = bins.get(f"Items/{key}")
        if not b:
            continue
        row = {}
        if "epicness" in b:
            row["e"] = b["epicness"]
        groups = [g.rsplit("/", 1)[-1] for g in b.get("mItemGroups", []) if g.startswith("Items/ItemGroups/")]
        groups = [g for g in groups if g != "Default"]
        if groups:
            row["g"] = groups
        classes = [CLASSES[a] for a in sorted(set(b.get("mItemAttributes", []))) if a in CLASSES]
        if classes:
            row["c"] = classes
        if int(key) in mayhem:
            row["m"] = 1
        out[key] = row
    with open(OUT, "w") as f:
        json.dump(dict(sorted(out.items(), key=lambda kv: int(kv[0]))), f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(out)} items -> {os.path.relpath(OUT, os.getcwd())}")
    lim = limits(bins, out.keys())
    with open(LIMITS, "w") as f:
        json.dump(lim, f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(lim)} item limits -> {os.path.relpath(LIMITS, os.getcwd())}")


if __name__ == "__main__":
    main()
