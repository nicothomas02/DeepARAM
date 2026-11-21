"""Build data.js for the Infinite Ashe calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game  # noqa: E402
from cdragon import write_data_js  # noqa: E402

# Mayhem augments in Ashe's pool that change how often she can cast R, E or W.
AUGMENTS = ["ARAM_Archmage", "UltimateAwakening", "UltimateRecursion", "ARAM_UltimateRevolution",
            "ARAM_MysticPunch", "ARAM_BreadAndCheese", "ARAM_Purist_Caster"]
# Numbers the game files leave out of the augment's data values (League wiki text).
WIKI_VALUES = {"UltimateRecursion": {"UltimateHaste": 50.0}, "ARAM_Purist_Caster": {"CooldownReduction": 0.1}}
SPELLS = {"W": "VolleyAbility/Volley", "E": "AsheSpiritOfTheHawkAbility/AsheSpiritOfTheHawk",
          "R": "EnchantedCrystalArrowAbility/EnchantedCrystalArrow"}


def fill(text, values):
    """Put the augment's numbers into its tooltip (@Name@, @Name*100@); drop the placeholders the game fills live."""
    def sub(m):
        v = values.get(m.group(1))
        if v is None:
            return ""
        v = v * float(m.group(2)) if m.group(2) else v
        return f"{v:g}"
    text = re.sub(r"@f?([A-Za-z_]+)(?:\*(\d+))?@", sub, text)
    text = re.sub(r"%i:\w+%|\{\{[^}]*\}\}", "", text)
    return re.sub(r"\s+", " ", re.sub(r"\(\s*current:[^)]*\)", "", text)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    ashe = g.champion_bin("ashe")
    summary = {s["spellKey"].upper(): s for s in g._load("ashe", f"{g.gd}/champions/22.json")["spells"]}

    spells = {}
    for key, path in SPELLS.items():
        sp = ashe[f"Characters/Ashe/Spells/{path}"]["mSpell"]
        ranks = 3 if key == "R" else 5
        out = {"name": summary[key]["name"], "icon": g.asset_url(summary[key]["abilityIconPath"]),
               "cooldown": sp["cooldownTime"][1:ranks + 1], "castTime": sp.get("spellCastTime", 0.25)}
        if sp.get("mMaxAmmo"):
            # Hawkshot: charges that each come back after the recharge time; `cooldown` is the gap between casts.
            out["charges"] = sp["mMaxAmmo"][1]
            out["recharge"] = sp["mAmmoRechargeTime"][1:ranks + 1]
        spells[key] = out

    wiki_file = os.path.join(HERE, "..", "..", "..", "data", "wiki", "mayhem_augments.json")
    wiki = {k.lower(): v for k, v in json.load(open(wiki_file, encoding="utf-8")).items()} if os.path.exists(wiki_file) else {}
    augments = []
    for k in AUGMENTS:
        a = g.augment(k)
        if not a:
            print("skipping missing augment", k)
            continue
        a["values"] = {**WIKI_VALUES.get(k, {}), **a["values"]}
        # Tooltip: the full League wiki text when we have it, else the game's short text with its numbers filled in.
        a["text"] = wiki.get(a["name"].lower()) or fill(a["text"], a["values"])
        augments.append(a)
    champion = {"name": "Ashe", "icon": g.champion_icon(22), "spells": spells}
    write_data_js(os.path.join(HERE, "data.js"), "ASHE_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "augments": augments})
    print(f"{g.version}: {len(augments)} augments")


if __name__ == "__main__":
    main()
