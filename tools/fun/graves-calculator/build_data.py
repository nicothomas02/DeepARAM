"""Build data.js for the Infinite Graves calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game  # noqa: E402
from cdragon import write_data_js  # noqa: E402

# Mayhem augments in Graves' pool that change how often Quickdraw (E) comes back.
AUGMENTS = ["ARAM_MysticPunch", "ARAM_Archmage", "UltimateAwakening", "ARAM_BreadAndCheese", "ARAM_Purist_Caster"]
# Numbers the game files leave out of the augment's data values (League wiki text).
WIKI_VALUES = {"ARAM_Purist_Caster": {"CooldownReduction": 0.1}}
SPELLS = {"Q": "GravesQLineSpellAbility/GravesQLineSpell", "W": "GravesSmokeGrenadeAbility/GravesSmokeGrenade",
          "E": "GravesMoveAbility/GravesMove", "R": "GravesChargeShotAbility/GravesChargeShot"}
# From the League wiki (Graves' champion data and New Destiny's notes); the game files don't hold them in one place.
ATTACK = {
    "baseAS": 0.475, "ratioAS": 0.49,
    "pellets": 4, "critPellets": 6,
    # Reloading 2 shells takes 2.08 s and speeds up with bonus attack speed up to a cap (level 18: 0.891 reloads a
    # second, reached at 150% bonus attack speed). How it scales in between is not documented: the page assumes a
    # straight line to the cap (an estimate).
    "reload2": 2.08, "reloadCap": 0.891, "reloadCapBonusAS": 1.5,
}
DASH_TIME = 0.4  # Quickdraw dashes 275-375 units at 750 speed: about 0.4 s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    b = g.champion_bin("graves")
    summary = {s["spellKey"].upper(): s for s in g._load("graves", f"{g.gd}/champions/104.json")["spells"]}
    spells = {}
    for key, path in SPELLS.items():
        sp = b[f"Characters/Graves/Spells/{path}"]["mSpell"]
        ranks = 3 if key == "R" else 5
        dv = {d["name"]: d["values"][1:1 + ranks] for d in sp.get("DataValues", []) if d.get("values")}
        spells[key] = {"name": summary[key]["name"], "icon": g.asset_url(summary[key]["abilityIconPath"]),
                       "cooldown": sp["cooldownTime"][1:1 + ranks], "mana": (sp.get("mana") or [0] * 6)[0:ranks],
                       "castTime": DASH_TIME if key == "E" else round(sp.get("mCastTime") or sp.get("spellCastTime") or 0.25, 3)}
        if key == "E":
            spells[key].update({"cutPerPellet": dv["CooldownPerHit"][0], "armorPerStack": dv["ArmorPerStack"],
                                "maxStacks": dv["MaxStacks"][0], "stackTime": dv["BuffDuration"][0]})
    par = b["Characters/Graves/CharacterRecords/Root"]["primaryAbilityResource"]
    champion = {"name": "Graves", "icon": g.champion_icon(104), "spells": spells, "attack": ATTACK,
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
    write_data_js(os.path.join(HERE, "data.js"), "GRAVES_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "augments": augments})


if __name__ == "__main__":
    main()
