"""Build data.js for the Infinite Ryze calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game, write_data_js  # noqa: E402

# Items worth putting on an AP / mana / health Ryze. Wooglet's Witchcap comes from a Mayhem quest augment.
ITEMS = [3040, 3003, 3089, 228002, 6657, 2503, 3118, 6655, 2522, 4633, 3041, 3121, 3119, 3110,
         3157, 3102, 3135, 3137, 4645, 4646, 6653, 3116, 4629, 3165, 3100, 3128, 4628, 3152,
         4010, 3802, 1058]

# Mayhem augments that change Ryze's AP, mana or health, or how hard his abilities hit.
AUGMENTS = ["ARAM_WitchfulThinking", "OminousPact", "ARAM_Goliath", "HandOfBaron", "ARAM_MadScientist",
            "ARAM_ADAPt", "ARAM_PhenomenalEvil", "ARAM_MasterofDuality", "ARAM_SlapAround", "MightyShield",
            "ARAM_ImTheJuggernaut", "ARAM_MindtoMatter", "ARAM_Overflow", "ARAM_Quest_WoogletsWitchcap",
            "LichBrain", "ARAM_CelestialBody", "DoubleTime", "ARAM_Eureka"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    ryze = g.champion_bin("ryze")

    root = ryze["Characters/Ryze/CharacterRecords/Root"]
    par = root["primaryAbilityResource"]
    passive = ryze["Characters/Ryze/Spells/RyzePassiveAbility/RyzePassive"]["mSpell"]
    pdv = {d["name"]: d["values"][1] for d in passive["DataValues"]}
    spells = {}
    for key, path in (("Q", "RyzeQWrapperAbility/RyzeQWrapper"), ("W", "RyzeWAbility/RyzeW"), ("E", "RyzeEAbility/RyzeE")):
        sp = ryze[f"Characters/Ryze/Spells/{path}"]["mSpell"]
        dv = {d["name"]: d.get("values", [0] * 7)[1:6] for d in sp.get("DataValues", [])}
        calc = next(c for n, c in sp["mSpellCalculations"].items() if n.endswith("DamageCalc"))
        ap_ratio = next(p["mCoefficient"] for p in calc["mFormulaParts"] if p["__type"] == "StatByCoefficientCalculationPart")
        mana_ratio = next(p["mCoefficient"] for p in calc["mFormulaParts"] if p["__type"] == "AbilityResourceByCoefficientCalculationPart")
        spells[key] = {"base": dv["BaseDamage"], "apRatio": round(ap_ratio, 4), "bonusManaRatio": round(mana_ratio, 4),
                       "cooldown": sp["cooldownTime"][1:6], "mana": (sp.get("mana") or [0] * 6)[1:6],
                       "castTime": sp.get("mCastTime", 0.25)}
    champion = {
        "name": "Ryze", "icon": g.champion_icon(13),
        "baseHP": root["baseHPModifiable"]["baseValue"], "hpPerLevel": root["hpPerLevelModifiable"]["baseValue"],
        "baseMana": par["{726ee5cd}"]["baseValue"], "manaPerLevel": par["{6216bf7b}"]["baseValue"],
        "passiveManaPctPer100AP": pdv["PercentManaIncrease"] / 100, "passiveAPStep": pdv["APAmount"],
        "spells": spells,
    }

    items = [x for x in (g.item(i) for i in ITEMS) if x]
    augments = [x for x in (g.augment(a) for a in AUGMENTS) if x]
    for name in set(AUGMENTS) - {a["key"] for a in augments}:
        print("skipping missing augment", name)
    write_data_js(os.path.join(HERE, "data.js"), "RYZE_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "items": items, "augments": augments})
    print(f"{g.version}: {len(items)} items, {len(augments)} augments")


if __name__ == "__main__":
    main()
