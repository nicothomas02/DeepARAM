"""Build data.js for the Infinite Ezreal calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game  # noqa: E402
from cdragon import write_data_js  # noqa: E402

# Mayhem augments in Ezreal's pool that change how often he can cast Mystic Shot (Q).
AUGMENTS = ["ARAM_SkilledSniper", "ARAM_Archmage", "ARAM_MysticPunch", "ARAM_BreadAndButter", "ARAM_Purist_Caster"]
# Numbers the game files leave out of the augment's data values (League wiki text).
WIKI_VALUES = {"ARAM_Purist_Caster": {"CooldownReduction": 0.1}}
SPELLS = {"Q": "EzrealQAbility/EzrealQ", "W": "EzrealWAbility/EzrealW", "E": "EzrealEAbility/EzrealE", "R": "EzrealRAbility/EzrealR"}
INSTANT = set()
# Mystic Shot's missile speed and range (League wiki: 2,000 and 1,200); the game files keep them on the missile.
Q_SPEED, Q_RANGE = 2000.0, 1200.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    b = g.champion_bin("ezreal")
    summary = {s["spellKey"].upper(): s for s in g._load("ezreal", f"{g.gd}/champions/81.json")["spells"]}
    spells = {}
    for key, path in SPELLS.items():
        sp = b[f"Characters/Ezreal/Spells/{path}"]["mSpell"]
        dv = {d["name"]: d["values"][1] for d in sp.get("DataValues", []) if d.get("values")}
        cast = 0.0 if key in INSTANT else (sp.get("mCastTime") or sp.get("spellCastTime") or 0.25)
        ranks = 3 if key == "R" else 5
        spells[key] = {"name": summary[key]["name"], "icon": g.asset_url(summary[key]["abilityIconPath"]),
                       "cooldown": sp["cooldownTime"][1:ranks + 1], "mana": sp["mana"][1:ranks + 1], "castTime": round(cast, 3)}
        if key == "Q":
            # A Mystic Shot hit takes this many seconds off all of Ezreal's cooldowns.
            spells[key].update(refund=dv.get("CDRefund", 1.5), speed=Q_SPEED, range=Q_RANGE)
    par = b["Characters/Ezreal/CharacterRecords/Root"]["primaryAbilityResource"]
    champion = {"name": "Ezreal", "icon": g.champion_icon(81), "spells": spells,
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
    write_data_js(os.path.join(HERE, "data.js"), "EZREAL_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "augments": augments})


if __name__ == "__main__":
    main()
