"""Champion pages data: champions/data.js (champions/build_data.py), and the builder's
build-row helpers."""
import math
import os
import re

import pytest

from deeparam_data_helpers import REPO, TIERS, load_js_data, load_json, load_module, read, walk_numbers

SLOTS = ["P", "Q", "W", "E", "R"]
ROLES = {"assassin", "fighter", "mage", "marksman", "support", "tank"}
BUILD_KEYS = ("start", "boots", "first", "core", "full")
STYLES = {"crit", "onhit", "ap", "lethality", "fighter", "tank", "enchanter"}
CC = {"stun", "root", "slow", "knockup", "knockback", "pull", "silence", "fear", "taunt", "suppression", "polymorph", "blind"}
STORMRAZOR_TENCENT, STORMRAZOR = 3097, 3095


@pytest.fixture(scope="module")
def data():
    return load_js_data("champions/data.js", "CHAMPS_DATA")


def all_build_rows(b):
    for k in BUILD_KEYS:
        yield from b[k]
    for st in b["styles"]:
        yield from st["core"]
        yield from st["full"]


def all_build_items(b):
    for r in all_build_rows(b):
        yield from r["items"]
    for st in b["styles"]:
        yield from st["items"]


def test_top_level(data):
    assert set(data) == {"patch", "champions", "items", "augments"}
    assert re.match(r"^\d+\.\d+\.\d+$", data["patch"])
    assert read("champions/data.js").startswith("window.CHAMPS_DATA = ")  # no header comment (5879fa77)


def test_numbers_are_finite(data):
    for path, n in walk_numbers(data):
        assert math.isfinite(n), path


def test_champion_identity(data):
    champs = data["champions"]
    assert len(champs) >= 150
    for key in ("id", "alias", "name"):
        vals = [c[key] for c in champs]
        assert len(vals) == len(set(vals)), f"duplicate champion {key}"
    names = [c["name"] for c in champs]
    assert names == sorted(names)
    for c in champs:
        assert isinstance(c["id"], int) and 0 < c["id"] < 10000, c["alias"]  # 60000+ are another mode's copies
        assert re.match(r"^[A-Za-z]+$", c["alias"]), c["alias"]
        assert c["roles"] and set(c["roles"]) <= ROLES, c["alias"]
        for k in ("icon", "splash", "tile"):
            assert c[k] and c[k].startswith("/assets/cd/"), (c["alias"], k)


def test_abilities(data):
    for c in data["champions"]:
        assert [a["slot"] for a in c["abilities"]] == SLOTS, c["alias"]
        for a in c["abilities"]:
            assert a["name"], (c["alias"], a["slot"])
            assert a["icon"] is None or a["icon"].startswith("/assets/")
            if a["slot"] != "P":
                n = 3 if a["slot"] == "R" else 5
                assert len(a["cooldown"]) <= n, (c["alias"], a["slot"])
                assert all(x >= 0 for x in a["cooldown"]), (c["alias"], a["slot"])
            assert a.get("cc") is None or a["cc"] in CC, (c["alias"], a["slot"])


def test_base_stats(data):
    for c in data["champions"]:
        s = c["stats"]
        assert s, c["alias"]
        assert s["hp"][0] > 0 and s["ad"][0] > 0 and s["ms"] > 0 and s["range"] > 0, c["alias"]
        assert 0 < s["as"][0] < 2, c["alias"]
        for k in ("hp", "hp5", "ad", "as", "armor", "mr"):
            assert len(s[k]) == 2 and min(s[k]) >= 0, (c["alias"], k)
        if "resource" in s:
            assert s["resource"]["kind"] in ("Mana", "Energy")
            assert s["resource"]["base"][0] > 0


def test_mayhem_changes(data):
    for c in data["champions"]:
        rows = c["mayhem"]
        for r in rows:
            assert r["slot"] in SLOTS
            assert r["rift"] != r["mayhem"], (c["alias"], r)
            if r["slot"] in ("Q", "W", "E"):
                assert len(r["mayhem"]) <= 5
            if r["slot"] == "R":
                assert len(r["mayhem"]) <= 3
        order = ["Q", "W", "E", "R", "P"]  # the builder's slot order
        keys = [(order.index(r["slot"]), r["name"] != "Cooldown", r["name"]) for r in rows]
        assert keys == sorted(keys), c["alias"]


def test_tier_rows(data):
    for c in data["champions"]:
        t = c["tier"]
        if t is None:
            continue
        assert 1 <= t["rank"] <= t["of"], c["alias"]
        for k in ("winRate", "pickRate", "damage", "tank"):
            assert 0 <= t[k] <= 1, (c["alias"], k)
    ranks = [c["tier"]["rank"] for c in data["champions"] if c["tier"]]
    assert len(ranks) == len(set(ranks))


def test_build_rows(data):
    for c in data["champions"]:
        b = c["builds"]
        if b is None:
            continue
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", b["date"])
        assert len(b["start"]) <= 5 and len(b["boots"]) <= 4 and len(b["first"]) <= 8
        assert len(b["core"]) <= 6 and len(b["full"]) <= 6
        assert not any(k.startswith("_") for k in b), "builder-only inputs are dropped before writing"
        for r in all_build_rows(b):
            assert r["items"], c["alias"]
            assert 0 <= r["pick"] <= 1 and 0 <= r["win"] <= 1, (c["alias"], r)
        for k in BUILD_KEYS:
            sets = [tuple(r["items"]) for r in b[k]]
            assert len(sets) == len(set(sets)), f"{c['alias']} {k}: rows with the same items are merged"
        starts = [r["pick"] for r in b["start"]]
        assert starts == sorted(starts, reverse=True)
        for tier, rows in b["augments"].items():
            assert tier in ("prismatic", "gold", "silver")
            assert len(rows) <= 10
            for a in rows:
                assert 0 <= a["pick"] <= 1 and a["grade"] in ("S", "A", "B", "C", "D", "")
        for s in b["skills"]:
            assert re.match(r"^[QWE]{3}$", s["max"]) or re.match(r"^[QWER]+$", s["max"]), s
            for o in s["orders"]:
                assert re.match(r"^[QWER]+$", o["levels"]) and len(o["levels"]) <= 18
        for m in b["mates"]:
            assert 0 <= m["win"] <= 1 and 0 <= m["pick"] <= 1


def test_build_styles(data):
    for c in data["champions"]:
        b = c["builds"]
        if not b:
            continue
        shares = [st["share"] for st in b["styles"]]
        assert shares == sorted(shares, reverse=True), c["alias"]
        assert sum(shares) <= 1.0001
        assert len({st["style"] for st in b["styles"]}) == len(b["styles"])
        for st in b["styles"]:
            assert st["style"] in STYLES and st["label"]
            assert 0 <= st["win"] <= 1
            assert len(st["core"]) <= 3 and len(st["full"]) <= 2 and len(st["items"]) <= 4 and len(st["augments"]) <= 6


def test_every_build_item_has_name_and_icon(data):
    """A build item missing from the item map shows as a blank slot on the page (the Stormrazor bug, af506266)."""
    items = data["items"]
    for iid, it in items.items():
        assert iid.isdigit() and it["name"] and it["icon"] and it["icon"].startswith("/assets/"), iid
    missing = {(c["alias"], i) for c in data["champions"] if c["builds"]
               for i in all_build_items(c["builds"]) if str(i) not in items}
    assert not missing


def test_every_build_augment_has_name_and_icon(data):
    augs = data["augments"]
    for aid, a in augs.items():
        assert aid.isdigit() and a["name"] and a["tier"] in TIERS + ("",), aid
        assert a["icon"] is None or a["icon"].startswith("/assets/")
    for c in data["champions"]:
        b = c["builds"]
        if not b:
            continue
        used = [a["id"] for rows in b["augments"].values() for a in rows] + [a for st in b["styles"] for a in st["augments"]]
        assert all(str(a) in augs for a in used), c["alias"]


def test_teammates_are_champions(data):
    ids = {c["id"] for c in data["champions"]}
    for c in data["champions"]:
        if c["builds"]:
            for m in c["builds"]["mates"]:
                assert m["id"] in ids and m["id"] != c["id"], (c["alias"], m)


def test_stormrazor_uses_client_id(data):
    """af506266 (#97): build stats name Stormrazor 3097, the game uses 3095."""
    assert str(STORMRAZOR_TENCENT) not in data["items"]
    for c in data["champions"]:
        if c["builds"]:
            assert STORMRAZOR_TENCENT not in set(all_build_items(c["builds"])), c["alias"]


def test_quest_reward_items_left_out_of_builds(data):
    """9d1ef617 (#156): items only an augment hands out can't be bought, so builds leave them out."""
    reward = {g["id"] for g in load_json("guide/augment_rules.json")["grantedItems"] if g["how"] == "reward"}
    assert reward
    for c in data["champions"]:
        if c["builds"]:
            assert not reward & set(all_build_items(c["builds"])), c["alias"]


def test_no_skins():
    """The site doesn't show skins (Nico, 2026-10-17): no skin file, section or skin names ship."""
    assert not os.path.exists(os.path.join(REPO, "champions/skins.js"))
    assert not os.path.exists(os.path.join(REPO, "champions/i18n/skins"))
    assert "skin" not in read("champions/app.js").lower()


def test_champion_list_matches_site_ids(data):
    """The web app's id table (web/src/data/champion-ids.json) covers the same champions as the champion pages."""
    ids = load_json("web/src/data/champion-ids.json")
    for c in data["champions"]:
        assert ids.get(c["alias"]) == c["id"], c["alias"]
    # the only extras are another mode's copies (ids 60000+)
    assert all(ids[a] >= 60000 for a in set(ids) - {c["alias"] for c in data["champions"]})


def test_every_stats_alias_has_a_display_name(data):
    """Pages look champion names up by the alias the stats files use (web/src/data/champion-names.json)."""
    import csv
    names = load_json("web/src/data/champion-names.json")
    with open(os.path.join(REPO, "data", "cn", "champions.csv"), encoding="utf-8") as f:
        aliases = {r["name"] for r in csv.DictReader(f)} | {c["alias"] for c in data["champions"]}
    # Regression: the "FiddleSticks" alias had no name entry, so the Tier List showed "Fiddle Sticks" (#168).
    missing = {a for a in aliases if a not in names}
    assert not missing, sorted(missing)
    for c in data["champions"]:
        if c["alias"] in names:
            assert names[c["alias"]] == c["name"], c["alias"]


# ---------- champions/build_data.py helpers ----------

@pytest.fixture(scope="module")
def builder():
    return load_module("champions/build_data.py", "deeparam_champions_build_data")


def test_item_alias_maps_stormrazor(builder):
    assert builder.ITEM_ALIASES == {STORMRAZOR_TENCENT: STORMRAZOR}


def test_build_rows_maps_aliases_and_merges(builder, monkeypatch):
    monkeypatch.setattr(builder, "REWARD_ITEMS", {9999})
    rows = [
        {"items": [3097, 3006], "pick_rate": 0.2, "win_rate": 0.5},
        {"items": [3095, 3006], "pick_rate": 0.1, "win_rate": 0.8},   # same set once 3097 is mapped
        {"items": [9999, 3006], "pick_rate": 0.3, "win_rate": 0.6},   # reward item dropped -> [3006]
        {"items": [9999], "pick_rate": 0.4, "win_rate": 0.4},         # nothing left: dropped
    ]
    out = builder.build_rows(rows, 10)
    assert out[0] == {"items": [3095, 3006], "pick": pytest.approx(0.3), "win": pytest.approx(0.6)}
    assert out[1] == {"items": [3006], "pick": 0.3, "win": 0.6}
    assert len(out) == 2
    assert builder.build_rows(rows, 1) == out[:1]
    assert builder.build_rows(None, 5) == []


def test_ranks_trim_to_ability_ranks(builder):
    assert builder.ranks([0, 1, 2, 3, 4, 5, 6], "Q") == [1, 2, 3, 4, 5]
    assert builder.ranks([0, 1, 2, 3, 4, 5, 6], "R") == [1, 2, 3]
    assert builder.ranks([0, 1.23456, None], "P") == [1.2346]


def test_build_style(builder):
    items = {1: {"categories": ["CriticalStrike"]}, 2: {"categories": ["SpellDamage"]},
             3: {"categories": ["SpellDamage"]}, 4: {"categories": ["Boots"]}}
    assert builder.build_style([1, 2, 3, 4], items) == "ap"
    assert builder.build_style([1, 2], items) == "crit"  # ties go to the earlier style
    assert builder.build_style([4], items) is None


def test_regions():
    r = load_json("champions/regions.json")
    keys = [x["key"] for x in r["regions"]]
    assert len(keys) == len(set(keys)) and all(x["name"] for x in r["regions"])
    tags = load_json("champions/tags.json")["champions"]
    assert set(r["champions"]) == set(tags)
    for alias, regions in r["champions"].items():
        assert regions and set(regions) <= set(keys), alias


MOD_STATS = {"damage_dealt", "damage_taken", "healing", "shielding", "tenacity", "ability_haste", "attack_speed",
             "energy_regen"}


def test_mayhem_modifiers():
    full = load_json("data/wiki/mayhem_modifiers.json")
    shipped = load_js_data("champions/modifiers.js", "CHAMPS_MODIFIERS")
    tags = load_json("champions/tags.json")["champions"]
    assert len(full["champions"]) > 100 and set(full["champions"]) <= set(tags)
    assert shipped == {a: c["mayhem"] for a, c in full["champions"].items() if c["mayhem"]}
    for alias, c in full["champions"].items():
        assert c["source"] in full["pages"].values(), alias
        for side in ("aram", "mayhem"):
            assert set(c[side]) <= MOD_STATS, alias
            assert all(isinstance(v, (int, float)) and abs(v) <= 100 for v in c[side].values()), alias


def test_official_patch_notes():
    notes = load_json("data/official/patch_notes.json")["patches"]
    patches = [p["patch"] for p in notes]
    assert len(patches) == len(set(patches)) >= 20
    for p in notes:
        assert p["url"].startswith("https://www.leagueoflegends.com/"), p["patch"]
        for c in p["champions"] + p["augments"]:
            assert c["name"] and all(isinstance(x, str) and x for x in c["changes"]), (p["patch"], c["name"])

def test_official_profile():
    o = load_json("champions/official.json")
    tags = load_json("champions/tags.json")["champions"]
    assert set(o["champions"]) == set(tags) and len(o["difficulty"]) == 3
    for alias, c in o["champions"].items():
        assert c["roles"] and set(c["roles"]) <= {"Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"}, alias
        assert 1 <= c["difficulty"] <= len(o["difficulty"]), alias
    profile = load_js_data("champions/profile.js", "CHAMPS_PROFILE")
    assert set(profile) == set(tags) and all(p["difficulty"] in o["difficulty"] for p in profile.values())


def test_augment_styles_from_build_tags(builder):
    """Augments fit a build style through their own build tags; untagged augments fit none."""
    kiwi = {"a": {"__type": "AugmentData", "AugmentPlatformId": 1, "mBuildTags": 512 | 64},
            "b": {"__type": "AugmentData", "AugmentPlatformId": 2, "mBuildTags": 256 | 8 | 1024},
            "c": {"__type": "AugmentData", "AugmentPlatformId": 3},
            "d": {"__type": "AugmentData", "AugmentPlatformId": 4, "mBuildTags": 4}}
    assert builder.augment_styles(kiwi) == {1: {"crit", "onhit"}, 2: {"tank", "enchanter"}}
    assert set(builder.BUILD_TAGS.values()) == STYLES


def test_ability_cc(builder):
    assert builder.ability_cc({"mAbilitySlotCC": [16, 0, 15, 14]}) == {"Q": "stun", "E": "root", "R": "slow"}
    assert builder.ability_cc({"mAbilitySlotCC": [0, 1, 0, 0]}) == {}  # unnamed codes are left out
    assert builder.ability_cc({}) is None
    assert set(builder.CC_CODES.values()) == CC


def test_tags_crowd_control_and_augments(data):
    T = load_json("champions/tags.json")
    with_cc = [v for v in T["champions"].values() if "cc" in v]
    assert len(with_cc) > 100
    for v in with_cc:
        assert set(v["cc"]) <= {"Q", "W", "E", "R"} and set(v["cc"].values()) <= CC
        assert v["hardCC"] == bool(set(v["cc"].values()) - {"slow", "blind"})
    assert T["champions"]["Leona"]["cc"]["Q"] == "stun"
    assert len(T["augments"]) > 50
    assert all(st and set(st) <= STYLES for st in T["augments"].values())
