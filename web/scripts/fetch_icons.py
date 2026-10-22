"""Download champion and augment icons into web/public/icons/.

The icons are the League client's own files, as CommunityDragon extracts them from each patch:
- champions/<Alias>.webp, from the client's champion-icons (Alias as in data/cn/champions.csv, e.g. MonkeyKing)
- augments/<id>.webp, from each Mayhem (KIWI) augment's large icon, which carries its rarity colour (the small one is grey)
and writes src/data/champion-ids.json (alias → the client's numeric champion id).

Each icon is resized to 64x64 WebP so the whole set stays small.

Usage:
  python3 -m pip install pillow
  python3 web/scripts/fetch_icons.py [--force]
"""
import argparse, io, json, os, re, time, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "icons")
CD = "https://raw.communitydragon.org/latest"
GD = CD + "/plugins/rcp-be-lol-game-data/global/default/v1"
SIZE = 64


def fetch(url, tries=4):
    # CommunityDragon refuses Python's default User-Agent.
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-icons"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def save(url, path, force):
    if os.path.exists(path) and not force:
        return False
    img = Image.open(io.BytesIO(fetch(url))).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=88, method=6)
    return True


# Some new augments' large icons sit at unresolved (hashed) paths in the extracted files, so only the plain white
# small glyph can be downloaded. Tint it with its rarity's colour (silver, gold, prismatic) so it still reads as one.
RARITY_TINT = {0: (190, 205, 215), 1: (232, 196, 120), 2: (205, 170, 235)}


def save_tinted(url, path, rarity, force):
    if os.path.exists(path) and not force:
        return False
    img = Image.open(io.BytesIO(fetch(url))).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    r, g, b = RARITY_TINT.get(rarity, RARITY_TINT[0])
    lum = img.convert("L")
    tinted = Image.merge("RGBA", (lum.point(lambda v: v * r // 255), lum.point(lambda v: v * g // 255), lum.point(lambda v: v * b // 255), img.getchannel("A")))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tinted.save(path, "WEBP", quality=88, method=6)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="download icons that already exist again")
    force = ap.parse_args().force

    champs = json.loads(fetch(GD + "/champion-summary.json"))
    n = 0
    for c in champs:
        if c["id"] > 0:
            n += save(f"{GD}/champion-icons/{c['id']}.png", os.path.join(OUT, "champions", c["alias"] + ".webp"), force)
    print(f"champions: {n} new of {sum(c['id'] > 0 for c in champs)}")
    # Alias → numeric id, for the champion panel's client files (splash, pick quote, abilities).
    ids = {c["alias"]: c["id"] for c in sorted(champs, key=lambda c: c["alias"]) if c["id"] > 0}
    with open(os.path.join(HERE, "..", "src", "data", "champion-ids.json"), "w") as f:
        json.dump(ids, f, indent=0)

    kiwi = json.loads(fetch(CD + "/game/maps/modespecificdata/kiwi.bin.json"))
    augs = [e for e in kiwi.values() if isinstance(e, dict) and e.get("AugmentPlatformId") and e.get("AugmentLargeIconPath")]
    n = 0
    for e in augs:
        path = os.path.join(OUT, "augments", f"{e['AugmentPlatformId']}.webp")
        try:
            if e["AugmentLargeIconPath"].startswith("{") and e.get("AugmentSmallIconPath"):
                small = CD + "/game/" + re.sub(r"\.(tex|dds)$", ".png", e["AugmentSmallIconPath"].lower())
                n += save_tinted(small, path, e.get("rarity", 0), force)
            else:
                url = CD + "/game/" + re.sub(r"\.(tex|dds)$", ".png", e["AugmentLargeIconPath"].lower())
                n += save(url, path, force)
        except OSError as err:
            print("skipped augment", e["AugmentPlatformId"], err)
    print(f"augments: {n} new of {len(augs)}")


if __name__ == "__main__":
    main()
