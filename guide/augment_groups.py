"""Group the live Mayhem augments by how their icons look, and say what each group has in common.

Usage: python3 guide/augment_groups.py [--strings lol.stringtable.json] [--kiwi kiwi.bin.json]
Needs: Pillow, numpy, xxhash. Run guide/build_data.py first (it writes guide/augment_rules.json).
Writes guide/augment_groups.json.

How it works:
  Icons     web/public/icons/augments/{id}.webp (the site's own copies). Each icon's centre (the glyph, without
            the dark ring) becomes a bright-pixel mask plus its edges; augments are clustered by cosine distance
            with average linkage. Only a dozen pairs share an identical file, so this groups by look instead.
  Labels    a hand-kept name per glyph (GLYPHS, keyed by one member that has carried the glyph), then the traits
            most members share: rarity, build style (champions/build_data.py's augment styles), stat and effect
            words in the augment text, and the group's win-rate range (data/cn/augments.json).
"""
import argparse, json, os, re, sys, urllib.request
from collections import Counter

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "tools", "datamine"))
sys.path.insert(0, os.path.join(REPO, "champions"))
from strings import key_hash  # noqa: E402
from build_data import STYLES, augment_styles  # noqa: E402

BASE = "https://raw.communitydragon.org/latest"
ICONS = os.path.join(REPO, "web", "public", "icons", "augments")
SIZE = 24
THRESHOLD = 0.44  # largest average cosine distance inside a group; lower makes more, tighter groups

# What each glyph shows, keyed by an augment that carries it. A group takes the name of the first key it contains.
GLYPHS = {
    1028: "Spell bolt", 1006: "Starburst", 1001: "Shield", 1002: "Loot bag", 1051: "Sword", 1019: "Runner",
    1104: "Fork", 1004: "Crossed wand", 1005: "Heart", 1018: "Anchor", 1062: "Dice", 1054: "Rising chart",
    1036: "Flame", 1047: "Impact", 1071: "Arrow", 1389: "Two figures", 1030: "Hourglass", 1061: "Cog",
    1098: "Winged boot", 1025: "Broken heart",
}
# Stat and effect words looked for in augment text (pattern, label)
WORDS = [
    (r"attack speed", "Attack speed"), (r"ability haste|cooldown", "Cooldowns"), (r"ability power", "Ability power"),
    (r"attack damage|\bAD\b", "Attack damage"), (r"critical strike|crit", "Critical strikes"),
    (r"max(imum)? health|bonus health|\bhealth\b", "Health"), (r"\barmor\b", "Armor"), (r"magic resist", "Magic resist"),
    (r"move(ment)? speed", "Move speed"), (r"\bheal", "Healing"), (r"\bshield", "Shields"), (r"\bgold\b", "Gold"),
    (r"lethality|armor penetration", "Lethality"), (r"omnivamp|life steal", "Life steal"), (r"tenacity", "Tenacity"),
    (r"\bslow", "Slows"), (r"\bstun|\broot|knock|immobiliz|\bcharm|\btaunt|\bfear", "Crowd control"),
    (r"\bdash|blink|leap", "Dashes"), (r"\bultimate|\bR\b", "Ultimate"), (r"attacks? |on-hit", "Basic attacks"),
    (r"\bmana\b", "Mana"), (r"\bstack", "Stacking"), (r"\ball(y|ies)\b", "Allies"), (r"\bminion", "Minions"),
    (r"snowball|mark\b", "Snowball"), (r"quest", "Quest"), (r"summoner spell", "Summoner spell"),
    (r"execut", "Execute"), (r"\bburn", "Burn"), (r"\btrue damage", "True damage"), (r"random", "Random"),
    (r"\bsize|bigger|larger", "Size"), (r"\babilit(y|ies)\b", "Abilities"), (r"projectile|missile", "Projectiles"), (r"\bstat anvil|anvil", "Anvils"),
]
TIERS = ["Silver", "Gold", "Prismatic"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-guide"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def features(aid):
    im = Image.open(os.path.join(ICONS, f"{aid}.webp")).convert("RGBA")
    w = im.size[0]
    im = im.crop((int(w * .17), int(w * .17), int(w * .83), int(w * .83))).resize((SIZE, SIZE), Image.LANCZOS)
    alpha = np.asarray(im, dtype=float)[..., 3] / 255
    value = np.asarray(im.convert("RGB").convert("HSV"), dtype=float)[..., 2] / 255
    glyph = np.clip((value - 0.45) * 3, 0, 1) * alpha  # bright, opaque pixels: the glyph, not the ring or tint
    gy, gx = np.gradient(glyph)
    v = np.concatenate([glyph.ravel(), np.hypot(gx, gy).ravel() * 2])
    v -= v.mean()
    return v / (np.linalg.norm(v) or 1)


def cluster(ids):
    X = np.stack([features(i) for i in ids])
    D = 1 - X @ X.T
    groups = [[i] for i in range(len(ids))]
    while len(groups) > 1:
        best = None
        for x in range(len(groups)):
            for y in range(x + 1, len(groups)):
                d = D[np.ix_(groups[x], groups[y])].mean()
                if best is None or d < best[0]:
                    best = (d, x, y)
        if best[0] > THRESHOLD:
            break
        _, x, y = best
        groups[x] += groups.pop(y)
    return [sorted(ids[j] for j in g) for g in groups]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strings", help="a local lol.stringtable.json (default: download)")
    ap.add_argument("--kiwi", help="a local kiwi.bin.json (default: download)")
    args = ap.parse_args()
    load = lambda path, url: json.load(open(path)) if path else get(url)  # noqa: E731
    entries = load(args.strings, f"{BASE}/game/en_us/data/menu/en_us/lol.stringtable.json")["entries"]
    kiwi = load(args.kiwi, f"{BASE}/game/maps/modespecificdata/kiwi.bin.json")
    s = lambda k: (entries.get(k.lower()) or entries.get(key_hash(k)) or "") if k else ""  # noqa: E731

    rules = json.load(open(os.path.join(HERE, "augment_rules.json")))
    tier = {int(k): v for k, v in rules["tiers"].items()}
    ids = sorted(i for i in tier if os.path.exists(os.path.join(ICONS, f"{i}.webp")))
    by_id = {a["AugmentPlatformId"]: a for a in kiwi.values() if isinstance(a, dict) and a.get("__type") == "AugmentData"}
    name = {i: re.sub(r"<[^>]+>", "", s(by_id[i]["NameTra"])) or by_id[i]["AugmentNameId"] for i in ids}
    text = {i: re.sub(r"<[^>]+>", " ", s(by_id[i].get("DescriptionTra")) + " " + s(by_id[i].get("AugmentTooltipTra"))) for i in ids}
    words = {i: {label for pat, label in WORDS if re.search(pat, text[i], re.I)} for i in ids}
    styles = augment_styles(kiwi)
    stats = {}
    path = os.path.join(REPO, "data", "cn", "augments.json")
    if os.path.exists(path):
        stats = {a["augment_id"]: a for a in json.load(open(path))["augments"]}

    base_rate = Counter(w for i in ids for w in words[i])
    out = []
    for members in sorted(cluster(ids), key=lambda g: -len(g)):
        n = len(members)
        rarity = Counter(tier[i] for i in members)
        style = Counter(st for i in members for st in styles.get(i, ()))
        found = Counter(w for i in members for w in words[i])
        # shared: at least a third of the group has it, and it is half again as common here as across all augments
        shared = [{"word": w, "share": round(c / n, 2)} for w, c in found.most_common()
                  if n > 1 and c / n >= 0.33 and c / n >= 1.5 * base_rate[w] / len(ids)]
        wins = [stats[i]["win_rate"] for i in members if i in stats]
        glyph = next((GLYPHS[i] for i in members if i in GLYPHS), None)
        out.append({
            "name": glyph or (shared[0]["word"] if shared else name[members[0]]),
            "size": n,
            "augments": [{"id": i, "name": name[i], "tier": tier[i]} for i in members],
            "common": {
                "rarity": [t for t in TIERS if rarity[t]] if len(rarity) < 3 else [],
                "styles": [STYLES[k] for k, c in style.most_common() if n > 1 and c / n >= 0.33],
                "words": shared[:5],
                "winRate": {"min": min(wins), "max": max(wins), "avg": round(sum(wins) / len(wins), 4)} if wins else None,
            },
        })
    with open(os.path.join(HERE, "augment_groups.json"), "w") as f:
        json.dump({"patch": rules["patch"], "groups": out}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(ids)} augments in {len(out)} groups: {[g['size'] for g in out]}")


if __name__ == "__main__":
    main()
