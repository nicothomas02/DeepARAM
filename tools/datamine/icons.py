"""Add each Mayhem augment's icon to data/pbe/kiwi-s3.json.

Matches augments by display name against kiwi.bin (AugmentLargeIconPath), saves the
CommunityDragon PNG as web/public/assets/augments/<pbe|live>/<file name> and writes that
site path to an "icon" field, so the PBE tab loads it from the site with no internal names
in the URL. Added and changed augments
use the PBE icon; removed ones use the live icon. Changed augments also get
their tier. Run after fetch.py.

Usage: python3 icons.py DATA_DIR [JSON]
"""
import json, os, sys, urllib.parse, urllib.request
from strings import StringTable

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "..", "web", "public", "assets"))
UA = {"User-Agent": "deeparam-datamine/1.0"}

CDRAGON = "https://raw.communitydragon.org/{channel}/{root}/{path}"
# New icons often reach the client's game-data plugin before the game WAD export.
ROOTS = ("game", "plugins/rcp-be-lol-game-data/global/default")

def icons(root, channel):
    """Display name (lowercase) -> candidate CommunityDragon icon URLs, best first."""
    k = json.load(open(os.path.join(root, channel, "kiwi.bin.json")))
    st = StringTable(os.path.join(root, channel, "lol.stringtable.json"))
    out = {}
    for v in k.values():
        if not isinstance(v, dict) or v.get("__type") != "AugmentData":
            continue
        small = (v.get("AugmentSmallIconPath") or "").lower()
        large = (v.get("AugmentLargeIconPath") or "").lower()
        # Some large paths are unresolved hashes ("{a5f7...}"); their file sits next to the small one.
        candidates = [p for p in (large, small.replace("_small.", "_large."), small) if p.startswith("assets/")]
        if not candidates:
            continue
        url = [CDRAGON.format(channel=channel, root=r, path=p.replace(".tex", ".png"))
               for p in dict.fromkeys(candidates) for r in ROOTS]
        names = {v.get("AugmentNameId", "")}
        if v.get("NameTra"):
            names.add(st.get(v["NameTra"]) or "")
        for n in names:
            if n:
                out.setdefault(n.lower(), url)
    return out

def exists(url):
    req = urllib.request.Request(url, method="HEAD", headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception:
        return False

def first_live(urls):
    return next((u for u in urls if exists(u)), None)

def save(url):
    """Copy a CommunityDragon icon to web/public/assets/augments/<pbe|live>/<file name>; return its site path."""
    channel, _, rest = urllib.parse.urlsplit(url).path.lstrip("/").partition("/")
    name = os.path.basename(urllib.parse.unquote(rest)).lower()
    site = f"/assets/augments/{'pbe' if channel == 'pbe' else 'live'}/{name}"
    dest = ASSETS + site[len("/assets"):]
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            data = r.read()
        with open(dest, "wb") as f:
            f.write(data)
    return site

def tiers(root):
    """Display name (lowercase) -> silver/gold/prismatic, from the client's augment list."""
    out = {}
    for ch in ("latest", "pbe"):
        for a in json.load(open(os.path.join(root, ch, "cherry-augments.json"))):
            out[a["nameTRA"].lower()] = a["rarity"].removeprefix("k").lower()
    return out

def main(root, path):
    d = json.load(open(path))
    pbe, live, tier = icons(root, "pbe"), icons(root, "latest"), tiers(root)
    for a in d["augments"]["changed"]:
        t = tier.get(a["name"].lower())
        if t in ("silver", "gold", "prismatic") and not a.get("tier"):
            a["tier"] = t
    missing = []
    for group, table in (("added", pbe), ("changed", pbe), ("removed", live)):
        for a in d["augments"][group]:
            name = (a.get("name") or "").lower()
            url = first_live(table.get(name) or pbe.get(name) or [])
            if url:
                a["icon"] = save(url)
            else:
                a.pop("icon", None)
                missing.append(a.get("name"))
    with open(path, "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("no icon:", missing or "none")

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "../../data/pbe/kiwi-s3.json"))
