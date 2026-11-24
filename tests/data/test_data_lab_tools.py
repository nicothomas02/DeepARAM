"""The Lab (tools/fun/): Infinite Ryze, Infinite Ashe, Infinite Zilean, Infinite Ezreal and Cook Builds generated data.js (tools/fun/*/build_data.py via tools/fun/cdragon.py)."""
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
    "ezreal-calculator": "EZREAL_DATA",
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


# Infinite Ezreal: tools/fun/ezreal-calculator/calc.js, run through Node.
def _ezreal(builds):
    import shutil, subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = (
        "global.window = global; require('./tools/fun/ezreal-calculator/data.js');"
        "const C = require('./tools/fun/ezreal-calculator/calc.js');"
        "const out = JSON.parse(process.argv[1]).map((b) => ({ ...C.compute(window.EZREAL_DATA, b, { runs: 10 }),"
        " need: C.threshold(window.EZREAL_DATA, b) }));"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run([node, "-e", script, json.dumps(builds)], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


EZREAL = {"qRank": 5, "haste": 0, "distance": 1000, "castW": False, "othersOnCooldown": False}


def test_ezreal_calculator_math():
    plain, sniper, close, sniper600 = _ezreal([
        {**EZREAL, "augments": []},
        {**EZREAL, "augments": ["ARAM_SkilledSniper"]},
        {**EZREAL, "distance": 500, "augments": ["ARAM_SkilledSniper"]},
        {**EZREAL, "distance": 600, "augments": ["ARAM_SkilledSniper"]},
    ])
    # Mystic Shot flies 2,000 units a second: 0.5 s to 1,000 units.
    assert sniper["flight"] == pytest.approx(0.5)
    # Skilled Sniper from 600+ units: Q is back the moment it lands, at any haste. One Q per 0.25 s cast + flight.
    assert sniper["need"] == 0 and sniper["perMinute"] == pytest.approx(80, abs=0.5)
    assert sniper600["perMinute"] == pytest.approx(60 / 0.55, abs=0.5)
    # Under 600 units Skilled Sniper does nothing, so haste has to bring Q down to flight + 1.5 s.
    assert close["perMinute"] == pytest.approx(plain["perMinute"], rel=0.2) and close["loop"] < 0.5
    # Without it, rank 5 Q (4.5 s) needs 4.5 x 100 / (100 + h) <= 2 at 1,000 units: about 125 haste (90% rule: less).
    assert 105 <= plain["need"] <= 125
    # Mana runs out within a minute at level 18 with no items.
    assert sniper["withMana"]["runsOut"] and sniper["withMana"]["lastsFor"] < 60

