"""The Lab (tools/fun/): Infinite Ryze, Infinite Ashe, Infinite Zilean, Infinite Karma, Infinite Graves and Cook Builds generated data.js (tools/fun/*/build_data.py via tools/fun/cdragon.py)."""
import glob
import json
import math
import os
import re

import pytest

from deeparam_data_helpers import (REPO, TIERS, champion_aliases, champion_names, js_var, load_js_data, load_json,
                                   read, walk_numbers)

TOOLS = {
    "cook-builds": "COOK_DATA",
    "ryze-calculator": "RYZE_DATA",
    "ashe-calculator": "ASHE_DATA",
    "zilean-calculator": "ZILEAN_DATA",
    "karma-calculator": "KARMA_DATA",
    "graves-calculator": "GRAVES_DATA",
}
GAME_TOOLS = sorted(t for t in TOOLS if t != "cook-builds")


def data(tool):
    return load_js_data(f"tools/fun/{tool}/data.js", TOOLS[tool])


def test_every_tool_folder_is_covered():
    folders = {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(REPO, "tools", "fun", "*", "data.js"))}
    assert folders == set(TOOLS)


@pytest.mark.parametrize("tool", sorted(TOOLS))
def test_parses_and_ships_without_header(tool):
    assert js_var(f"tools/fun/{tool}/data.js") == TOOLS[tool]
    # 172b6e1d: no "Generated from ... by build_data.py" comment in shipped data
    assert read(f"tools/fun/{tool}/data.js").startswith(f"window.{TOOLS[tool]} = ")


@pytest.mark.parametrize("tool", sorted(TOOLS))
def test_numbers_finite(tool):
    for path, n in walk_numbers(data(tool)):
        assert math.isfinite(n), path


def _minor(patch):
    return tuple(int(x) for x in patch.split(".")[:2])


@pytest.mark.parametrize("tool", GAME_TOOLS)
def test_patch_is_a_live_patch(tool):
    """Built from the live channel, never ahead of the champion pages (which the daily job rebuilds)."""
    d = data(tool)
    assert re.match(r"^\d+\.\d+\.\d+$", d["patch"])
    assert d["channel"] == "latest"
    assert _minor(d["patch"]) <= _minor(load_js_data("champions/data.js")["patch"])


@pytest.mark.parametrize("tool", GAME_TOOLS)
def test_champions_items_augments(tool):
    d = data(tool)
    aliases, names = champion_aliases(), champion_names()
    rules = load_json("guide/augment_rules.json")["tiers"]
    for c in d.get("champions") or []:
        assert c["alias"] in aliases and c["name"] in names, c
        assert c["icon"].startswith("/assets/cd/")
    if isinstance(d.get("champions"), list):
        al = [c["alias"] for c in d["champions"]]
        assert len(al) == len(set(al))
    items = d.get("items") or []
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids))
    for i in items:
        assert i["name"] and i["price"] >= 0 and i["icon"].startswith("/assets/"), i["id"]
    augs = d.get("augments") or []
    keys = [a["key"] for a in augs]
    assert len(keys) == len(set(keys))
    for a in augs:
        assert a["name"] and a["tier"] in TIERS and a["icon"].startswith("/assets/"), a["key"]
        if "id" in a and str(a["id"]) in rules:
            assert rules[str(a["id"])] == a["tier"], (tool, a["key"])


def test_site_tab_manifest():
    m = json.loads(read("tools/fun/site-tab.json"))
    assert m["label"] and m["entry"] == "index.html" and isinstance(m["order"], int)
    assert os.path.exists(os.path.join(REPO, "tools", "fun", m["entry"]))
    for folder in ("guide", "champions"):
        mm = json.loads(read(f"{folder}/site-tab.json"))
        assert os.path.exists(os.path.join(REPO, folder, mm["entry"]))


def test_kitchen_router_reaches_every_page():
    # The Kitchen's entry page opens the Chef Specials; old Lab links to the calculators still reach them.
    html = read("tools/fun/index.html")
    for tool in TOOLS:
        assert re.search(rf"['\"/]{re.escape(tool)}[/'\"#]", html) or tool in html, tool


# The Lab in the site's languages: tools/fun/i18n/<code>.json translates every English string The Lab shows
# (tools/fun/i18n/en.json, written by tools/fun/i18n/build_keys.py).
LAB_I18N = os.path.join(REPO, "tools", "fun", "i18n")
TOKENS = re.compile(r"\{\w+\}|@[^@\s]+@|%i:\w+%")


def _site_languages():
    return sorted(l["code"] for l in load_json("web/src/i18n/languages.json") if l["code"] != "en")


def test_lab_keys_are_current():
    import subprocess, sys
    before = read("tools/fun/i18n/en.json")
    subprocess.run([sys.executable, os.path.join(LAB_I18N, "build_keys.py")], check=True, capture_output=True)
    assert read("tools/fun/i18n/en.json") == before, "run tools/fun/i18n/build_keys.py and translate the new keys"


@pytest.mark.parametrize("code", _site_languages())
def test_lab_translation_complete(code):
    en = load_json("tools/fun/i18n/en.json")
    tr = load_json(f"tools/fun/i18n/{code}.json")
    assert set(tr) == set(en), f"{code}: missing {sorted(set(en) - set(tr))[:5]}, extra {sorted(set(tr) - set(en))[:5]}"
    for k, v in tr.items():
        assert isinstance(v, str) and v.strip(), (code, k)
        assert sorted(TOKENS.findall(v)) == sorted(TOKENS.findall(k)), (code, k, v)


def test_chefs_special_carries_every_language():
    special = load_json("data/cook-builds/chefs-special.json")
    if not special:
        return
    assert sorted(special["i18n"]) == _site_languages()
    assert os.path.exists(os.path.join(REPO, "tools", "fun", "cook-builds", "share", special["id"] + ".png"))


def test_every_cook_build_has_a_share_image():
    share = os.path.join(REPO, "tools", "fun", "cook-builds", "share")
    assert sorted(os.listdir(share)) == sorted(b["id"] + ".png" for b in data("cook-builds")["builds"])


# Infinite Ashe: the fight math in tools/fun/ashe-calculator/calc.js, run through Node.
def _ashe(builds):
    import shutil, subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = (
        "global.window = global; require('./tools/fun/ashe-calculator/data.js');"
        "const C = require('./tools/fun/ashe-calculator/calc.js');"
        "const out = JSON.parse(process.argv[1]).map((b) => C.compute(window.ASHE_DATA, b, { runs: 40 }));"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run([node, "-e", script, json.dumps(builds)], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


ASHE = {"rRank": 3, "eRank": 5, "wRank": 5, "haste": 100, "ultHaste": 0, "attackSpeed": 1.5, "castW": True, "onlyOnCooldown": False}


def test_ashe_calculator_math():
    plain, archmage, more_haste, preset = _ashe([
        {**ASHE, "augments": []},
        {**ASHE, "augments": ["ARAM_Archmage"]},
        {**ASHE, "haste": 300, "augments": ["ARAM_Archmage"]},
        {**ASHE, "haste": 150, "eRank": 1, "castW": False, "onlyOnCooldown": True,
         "augments": ["ARAM_Archmage", "UltimateAwakening", "UltimateRecursion", "ARAM_MysticPunch"]},
    ])
    # No augments: R only comes back on its own cooldown (60 s at rank 3, 30 s at 100 haste).
    assert plain["cooldowns"]["R"] == pytest.approx(30)
    assert plain["perMinute"] == pytest.approx(2)
    # Archmage refunds 30% of the base cooldown: 15 s from a rank 5 Hawkshot, 18 s from a rank 3 R.
    assert archmage["refunds"]["fromE"] == pytest.approx(15, abs=0.01)
    assert archmage["refunds"]["fromR"] == pytest.approx(18, abs=0.01)
    assert plain["perMinute"] < archmage["perMinute"] < more_haste["perMinute"]
    # The page's preset closes the loop: an R for (nearly) every Hawkshot. Haste shortens Hawkshot's 5 s gap
    # (checked against AramHex's Ashe page), so the full loop runs far above 12 a minute.
    assert preset["loop"] >= 0.9 and preset["perMinute"] > 40


# Infinite Zilean: tools/fun/zilean-calculator/calc.js, run through Node.
def _zilean(builds):
    import shutil, subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = (
        "global.window = global; require('./tools/fun/zilean-calculator/data.js');"
        "const C = require('./tools/fun/zilean-calculator/calc.js');"
        "const out = JSON.parse(process.argv[1]).map((b) => ({ ...C.compute(window.ZILEAN_DATA, b, { runs: 20 }),"
        " need: C.threshold(window.ZILEAN_DATA, b) }));"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run([node, "-e", script, json.dumps(builds)], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


ZILEAN = {"qRank": 1, "wRank": 5, "eRank": 1, "haste": 100, "castE": False, "rOnCooldown": False}


def test_zilean_calculator_math():
    plain, q1, q5, r_cd = _zilean([
        {**ZILEAN, "haste": 500, "augments": []},
        {**ZILEAN, "augments": ["ARAM_Archmage"]},
        {**ZILEAN, "qRank": 5, "augments": ["ARAM_Archmage"]},
        {**ZILEAN, "rOnCooldown": True, "augments": ["ARAM_Archmage"]},
    ])
    # Without Archmage, Rewind brings Time Bomb back once per Rewind cooldown: 6 s at rank 5, 1 s at 500 haste.
    assert plain["perMinute"] == pytest.approx(60, abs=0.5)
    # With Archmage, each Time Bomb takes 30% of its base cooldown (10 s at rank 1) off Rewind. Q-W-Q-W never waits
    # once Rewind's 6 s fits in that 3 s plus the 0.25 s cast: 6 x 100 / (100 + h) <= 3.25 at about 85 haste.
    assert q1["refundFromQ"] == pytest.approx(3, abs=0.01)
    assert 80 <= q1["need"] <= 86 and q1["loop"] == pytest.approx(1)
    assert q1["perMinute"] == pytest.approx(240, abs=1)
    # A rank 5 Time Bomb (8 s base) refunds less, so the loop needs more haste (about 127).
    assert 120 <= q5["need"] <= 130
    # Every second bomb lands on a bombed target: a stun.
    assert q1["stunsPerMinute"] == pytest.approx(120, abs=1)
    # Mana stops it within seconds at level 18 with no items.
    assert q1["withMana"]["runsOut"] and q1["withMana"]["lastsFor"] < 10
    # When Chronoshift is on cooldown, half the refunds land on it and the loop doesn't close.
    assert r_cd["need"] is None




# Infinite Karma and Infinite Graves: tools/fun/karma-calculator/calc.js and tools/fun/graves-calculator/calc.js.
def _node(tool, var, calc_expr, builds):
    import shutil, subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = (
        f"global.window = global; require('./tools/fun/{tool}/data.js');"
        f"const C = require('./tools/fun/{tool}/calc.js'); const D = window.{var};"
        f"const out = JSON.parse(process.argv[1]).map((b) => ({calc_expr}));"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run([node, "-e", script, json.dumps(builds)], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


KARMA = {"qRank": 5, "wRank": 1, "eRank": 1, "rRank": 4, "haste": 100, "qTargets": 2, "flareTargets": 2, "tetherHolds": True}
KARMA_FULL = ["ARAM_Archmage", "UltimateAwakening", "ARAM_MysticPunch", "ARAM_EtherealWeapon"]


def test_karma_calculator_math():
    plain, no_ethereal, three, full = _node(
        "karma-calculator", "KARMA_DATA", "({ ...C.compute(D, b, { runs: 20 }), need: C.threshold(D, b) })", [
            {**KARMA, "augments": []},
            {**KARMA, "qTargets": 3, "flareTargets": 3, "augments": ["ARAM_Archmage", "UltimateAwakening", "ARAM_MysticPunch"]},
            {**KARMA, "qTargets": 3, "flareTargets": 3, "augments": ["ARAM_Archmage", "ARAM_MysticPunch", "ARAM_EtherealWeapon"]},
            {**KARMA, "qTargets": 3, "flareTargets": 3, "augments": KARMA_FULL},
        ])
    # Gathering Fire: 4 s off Mantra per enemy hit per damage instance. Q hits once, Soulflare twice, W twice (cast and
    # tether end).
    assert plain["cutPerQ"] == pytest.approx(8) and plain["cutPerRQ"] == pytest.approx(16) and plain["cutPerW"] == pytest.approx(8)
    assert plain["cooldowns"]["R"] == pytest.approx(17, abs=0.01)    # rank 4 Mantra (34 s) at 100 haste
    assert plain["loop"] < 0.9 and plain["perMinute"] > 0
    # Mystic Punch needs Ethereal Weapon (or basic attacks): without it, the loop needs more haste.
    assert no_ethereal["need"] is None or no_ethereal["need"] > full["need"] + 20
    # Archmage, Ultimate Awakening, Mystic Punch and Ethereal Weapon with three enemies hit: every Q and W empowered,
    # one per 0.25 s cast, from about 80 Ability Haste. Without Ultimate Awakening it needs far more.
    assert full["loop"] >= 0.99 and full["perMinute"] == pytest.approx(240, abs=2)
    assert 60 <= full["need"] <= 100
    assert three["loop"] < full["loop"] and (three["need"] is None or three["need"] > full["need"])
    # Mana stops it within seconds at level 18 with no items.
    assert full["withMana"]["runsOut"] and full["withMana"]["lastsFor"] < 15


GRAVES = {"qRank": 1, "wRank": 1, "eRank": 5, "rRank": 3, "haste": 50, "attackSpeed": 1.2, "crit": 0, "pellets": 4, "targets": 1}


def test_graves_calculator_math():
    slow, capped = _node("graves-calculator", "GRAVES_DATA", "C.reloadTime(D.champion.attack, b)", [0.475, 0.475 + 1.5 * 0.49])
    # Reloading both shells: 2.08 s with no bonus attack speed, the level-18 cap (1 / 0.891 s) at 150% bonus.
    assert slow == pytest.approx(2.08) and capped == pytest.approx(1 / 0.891, abs=0.001)

    plain, punch, purist, preset = _node(
        "graves-calculator", "GRAVES_DATA",
        "({ ...C.compute(D, b, { runs: 20 }), need: C.threshold(D, b), haste: C.setup(D, b).haste })", [
            {**GRAVES, "augments": []},
            {**GRAVES, "augments": ["ARAM_MysticPunch"]},
            {**GRAVES, "augments": ["ARAM_MysticPunch", "ARAM_Purist_Caster"]},
            {**GRAVES, "attackSpeed": 1.5, "augments": ["ARAM_MysticPunch", "ARAM_Purist_Caster", "ARAM_BreadAndCheese"]},
        ])
    # Quickdraw already adds shots over plain shoot-shoot-reload, but Graves still reloads most of the time.
    assert plain["perMinute"] > plain["plainShotsPerMinute"] and plain["loop"] < 0.5
    # Each shot: 4 pellets x 0.5 s off Quickdraw, plus Mystic Punch's 1.25 s per enemy hit.
    assert punch["cutPerShot"] == pytest.approx(3.25)
    # Purist - Caster turns bonus attack speed into haste (0.65 per 1%): 1.2 AS is 148% bonus, about 96 haste more.
    assert purist["haste"] == pytest.approx(50 + 0.65 * (1.2 - 0.475) / 0.49 * 100, abs=0.01)
    assert purist["loop"] >= 0.99 and purist["plainShotsPerMinute"] < plain["plainShotsPerMinute"]
    # The page's preset: Quickdraw back after every shot, a dash and a shot every 0.4 s.
    assert preset["loop"] >= 0.99 and preset["perMinute"] == pytest.approx(150, abs=2)
    assert preset["withMana"]["runsOut"]
