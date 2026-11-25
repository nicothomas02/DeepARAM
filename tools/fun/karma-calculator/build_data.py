"""Build data.js for the Infinite Karma calculator from CommunityDragon.

Usage: python3 build_data.py [--channel latest|pbe]
Writes data.js next to this script. Python 3 standard library only.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from cdragon import Game  # noqa: E402
from cdragon import write_data_js  # noqa: E402

# Mayhem augments in Karma's pool that change how often Mantra (R) comes back.
AUGMENTS = ["ARAM_Archmage", "UltimateAwakening", "ARAM_UltimateRevolution", "UltimateRecursion", "ARAM_MysticPunch",
            "ARAM_EtherealWeapon", "ARAM_BreadAndButter", "ARAM_BreadAndJam", "ARAM_BreadAndCheese", "ARAM_Purist_Caster"]
# Numbers the game files leave out of the augment's data values (League wiki text).
WIKI_VALUES = {"UltimateRecursion": {"UltimateHaste": 50.0}, "ARAM_Purist_Caster": {"CooldownReduction": 0.1}}
SPELLS = {"Q": "KarmaQAbility/KarmaQ", "W": "KarmaSpiritBindAbility/KarmaSpiritBind",
          "E": "KarmaSolKimShieldAbility/KarmaSolKimShield", "R": "KarmaMantraAbility/KarmaMantra"}
# Inspire (E) and Mantra (R) have no cast time (League wiki); the game files' spellCastTime is their animation.
INSTANT = {"E", "R"}
# Gathering Fire: Mantra's current cooldown drops 4 s per enemy champion hit by a damaging ability (League wiki). The
# game files don't hold the number.
PASSIVE_CUT = 4.0
SOULFLARE_DELAY = 1.5   # Soulflare (RQ) explodes 1.5 s after it lands (League wiki)
TETHER = 2.0            # Focused Resolve's tether lasts 2 s, then hits again (League wiki)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="latest")
    g = Game(ap.parse_args().channel)
    b = g.champion_bin("karma")
    summary = {s["spellKey"].upper(): s for s in g._load("karma", f"{g.gd}/champions/43.json")["spells"]}
    spells = {}
    for key, path in SPELLS.items():
        sp = b[f"Characters/Karma/Spells/{path}"]["mSpell"]
        cast = 0.0 if key in INSTANT else (sp.get("mCastTime") or sp.get("spellCastTime") or 0.25)
        ranks = 4 if key == "R" else 5
        spells[key] = {"name": summary[key]["name"], "icon": g.asset_url(summary[key]["abilityIconPath"]),
                       "cooldown": sp["cooldownTime"][1:1 + ranks], "mana": (sp.get("mana") or [0] * 6)[0:ranks],
                       "castTime": round(cast, 3)}
    par = b["Characters/Karma/CharacterRecords/Root"]["primaryAbilityResource"]
    champion = {"name": "Karma", "icon": g.champion_icon(43), "spells": spells,
                "passiveCut": PASSIVE_CUT, "soulflareDelay": SOULFLARE_DELAY, "tether": TETHER,
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
    write_data_js(os.path.join(HERE, "data.js"), "KARMA_DATA",
                  {"patch": g.version, "channel": g.ch, "champion": champion, "augments": augments})


if __name__ == "__main__":
    main()
