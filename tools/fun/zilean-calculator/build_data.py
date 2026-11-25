"""Build data.js for the Infinite Zilean calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game  # noqa: E402
from cdragon import write_data_js  # noqa: E402

# Mayhem augments in Zilean's pool that change how often he can cast Time Bomb (Q), Rewind (W) or Time Warp (E).
AUGMENTS = ["ARAM_Archmage", "ARAM_BreadAndButter", "ARAM_BreadAndJam", "ARAM_BreadAndCheese", "ARAM_Purist_Caster"]
# Numbers the game files leave out of the augment's data values (League wiki text).
WIKI_VALUES = {"ARAM_Purist_Caster": {"CooldownReduction": 0.1}}
SPELLS = {"Q": "ZileanQAbility/ZileanQ", "W": "ZileanWAbility/ZileanW", "E": "TimeWarpAbility/TimeWarp"}
# Rewind and Time Warp have no cast time (League wiki); the game files' spellCastTime is their animation.
INSTANT = {"W", "E"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    b = g.champion_bin("zilean")
    summary = {s["spellKey"].upper(): s for s in g._load("zilean", f"{g.gd}/champions/26.json")["spells"]}
    spells = {}
    for key, path in SPELLS.items():
        sp = b[f"Characters/Zilean/Spells/{path}"]["mSpell"]
        dv = {d["name"]: d["values"][1] for d in sp.get("DataValues", []) if d.get("values")}
        cast = 0.0 if key in INSTANT else (sp.get("mCastTime") or sp.get("spellCastTime") or 0.25)
        spells[key] = {"name": summary[key]["name"], "icon": g.asset_url(summary[key]["abilityIconPath"]),
                       "cooldown": sp["cooldownTime"][1:6], "mana": sp["mana"][0:5], "castTime": round(cast, 3)}
        if key == "W":
            spells[key]["reduction"] = dv.get("CooldownReduction", 10.0)
    par = b["Characters/Zilean/CharacterRecords/Root"]["primaryAbilityResource"]
    champion = {"name": "Zilean", "icon": g.champion_icon(26), "spells": spells,
                "baseMana": par["{726ee5cd}"]["baseValue"], "manaPerLevel": par["{6216bf7b}"]["baseValue"],
                "manaRegen": par["{c4ab3550}"]["baseValue"], "manaRegenPerLevel": par["{3a509002}"]["baseValue"]}

    wiki_file = os.path.join(HERE, "..", "..", "..", "data", "wiki", "mayhem_augments.json")
    wiki = {k.lower(): v for k, v in json.load(open(wiki_file, encoding="utf-8")).items()} if os.path.exists(wiki_file) else {}
    augments = []
    for k in AUGMENTS:
        a = g.augment(k)
        if not a:
            print("skipping missing augment", k)
            continue
        a["values"] = {**WIKI_VALUES.get(k, {}), **a["values"]}
        a["text"] = wiki.get(a["name"].lower()) or a["text"]
        augments.append(a)
    write_data_js(os.path.join(HERE, "data.js"), "ZILEAN_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "augments": augments})


if __name__ == "__main__":
    main()
