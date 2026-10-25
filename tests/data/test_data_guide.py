"""Info tab data: guide/data.js, guide/history.js and guide/augment_rules.json (guide/build_data.py,
guide/build_history.py), plus the builders' pure text helpers."""
import math
import re

import pytest

from deeparam_data_helpers import (TIERS, asset_exists, embed_transform, load_js_data, load_json,
                                   load_module, walk_numbers)

CHALLENGE_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
PATCH_RE = re.compile(r"^\d+\.\d+\.\d+$")


@pytest.fixture(scope="module")
def guide():
    return load_js_data("guide/data.js", "GUIDE_DATA")


@pytest.fixture(scope="module")
def history():
    return load_js_data("guide/history.js", "GUIDE_HISTORY")


@pytest.fixture(scope="module")
def rules():
    return load_json("guide/augment_rules.json")


def patch_key(p):
    return tuple(int(x) for x in p.split("."))


# ---------- guide/data.js ----------

def test_guide_top_level_keys(guide):
    required = {"patch", "hero", "queues", "augmentCounts", "maps", "summons", "items", "quests", "challenges",
                "rules", "spells", "spellAugments", "itemChanges", "augmentSets", "augmentRules"}
    assert required <= set(guide)
    assert PATCH_RE.match(guide["patch"])
    # 5879fa77: the builder no longer writes which channel the data came from
    assert "channel" not in guide


def test_guide_numbers_are_finite(guide):
    for path, n in walk_numbers(guide):
        assert math.isfinite(n), path


def test_queues(guide):
    ids = [q["id"] for q in guide["queues"]]
    assert ids and len(ids) == len(set(ids))
    assert ids == sorted(ids)
    assert 2400 in ids  # the Mayhem queue
    for q in guide["queues"]:
        assert isinstance(q["id"], int) and q["id"] > 0
        assert q["name"].startswith("ARAM: Mayhem")


def test_augment_counts_match_rules(guide, rules):
    counts = guide["augmentCounts"]
    assert set(counts) == set(TIERS)
    assert all(isinstance(n, int) and n > 0 for n in counts.values())
    assert {t: o["pool"] for t, o in guide["augmentRules"]["odds"].items()} == counts
    assert {t: o["pool"] for t, o in rules["odds"].items()} == counts


def test_maps_and_summons(guide):
    assert [m["name"] for m in guide["maps"]][0] == "Howling Abyss"
    assert len({m["name"] for m in guide["maps"]}) == len(guide["maps"]) == 4
    for m in guide["maps"]:
        assert m["minimap"].startswith("/assets/cd/")
    for s in guide["summons"]:
        assert s["name"] and s["text"] and s["icon"].startswith("/assets/")


def test_items(guide):
    ids = [i["id"] for i in guide["items"]]
    assert len(ids) == len(set(ids))
    for i in guide["items"]:
        assert i["name"] and i["icon"].startswith("/assets/")
        assert len(i["text"]) <= 220


def test_quests(guide):
    keys = [q["key"] for q in guide["quests"]]
    assert keys and len(keys) == len(set(keys))
    for q in guide["quests"]:
        assert q["name"]
        assert q["tier"] in TIERS + (None,)
        assert isinstance(q["inPool"], bool)
        assert q["milestones"], q["key"]
        needs = [m["need"] for m in q["milestones"] if m["need"] is not None]
        assert all(isinstance(n, (int, float)) and n >= 0 for n in needs), q["key"]
        assert needs == sorted(needs), f"{q['key']}: milestones out of order"
        assert len(q["notes"]) <= 3
        for m in q["milestones"]:
            for text in (m["quest"], m["reward"]):
                # placeholders are filled or dropped; unknown numbers never show as "?" or "@Name@"
                assert "@" not in text and "?" not in text, (q["key"], text)
                assert "{{" not in text, (q["key"], text)
    # in-pool quests come first, then by tier
    order = [(not q["inPool"], TIERS.index(q["tier"]) if q["tier"] else 9) for q in guide["quests"]]
    assert order == sorted(order)


def test_challenges(guide):
    ids = [c["id"] for c in guide["challenges"]]
    assert ids and len(ids) == len(set(ids)) and ids == sorted(ids)
    for c in guide["challenges"]:
        assert str(c["id"]).startswith("101")
        assert c["name"] and c["group"]
        assert isinstance(c["mayhem"], bool)
        tiers = [t["tier"] for t in c["tiers"]]
        assert tiers and all(t in CHALLENGE_TIERS for t in tiers)
        assert tiers == sorted(tiers, key=CHALLENGE_TIERS.index), c["id"]
        values = [t["value"] for t in c["tiers"]]
        assert all(v >= 0 for v in values)
        assert values == sorted(values), f"challenge {c['id']}: thresholds must not drop at higher tiers"
        assert c["icon"].startswith("/assets/")


def test_rules(guide):
    r = guide["rules"]
    levels = r["augmentLevels"]
    assert levels and levels == sorted(set(levels)) and all(1 <= lv <= 18 for lv in levels)
    assert r["rerolls"] is None or r["rerolls"] >= 0
    assert 0 <= (r["comboBreakerTenacity"] or 0) <= 1
    assert isinstance(r["balance"], dict)
    assert isinstance(r["onFire"]["values"], dict)


def test_spells_and_spell_augments(guide):
    names = [s["name"] for s in guide["spells"]]
    assert names == sorted(names) and len(names) == len(set(names))
    for s in guide["spells"]:
        assert s["cooldown"] > 0 and s["icon"].startswith("/assets/")
    for a in guide["spellAugments"]:
        assert a["tier"] in TIERS and isinstance(a["id"], int) and a["name"]
        assert "@" not in a["text"]


def test_item_changes(guide):
    ids = [c["id"] for c in guide["itemChanges"]]
    assert len(ids) == len(set(ids))
    names = [c["name"] for c in guide["itemChanges"]]
    assert names == sorted(names)
    for c in guide["itemChanges"]:
        # ids of 100000 and up are other modes' copies of an item
        assert 0 < c["id"] < 100000
        assert c["changes"], c["name"]
        for ch in c["changes"]:
            assert ch["name"] and ch["rift"] != ch["mayhem"], (c["name"], ch)


def test_augment_sets(guide):
    assert len(guide["augmentSets"]) == 9
    for s in guide["augmentSets"]:
        assert s["name"]
        assert "@" not in s["bonus"]


def test_augment_rules_in_data_js_match_json(guide, rules):
    r = guide["augmentRules"]
    assert "tiers" not in r  # the per-augment map lives only in augment_rules.json
    for k in ("patch", "levels", "cards", "rerollsPerSlot", "odds"):
        assert r[k] == rules[k], k
    assert r["patch"] == guide["patch"]
    assert r["levels"] == guide["rules"]["augmentLevels"]


def test_offer_odds_follow_pool_sizes(rules):
    cards, rerolls = rules["cards"], rules["rerollsPerSlot"]
    assert cards == 3 and rerolls >= 0
    for tier, o in rules["odds"].items():
        assert tier in TIERS
        n = o["pool"]
        assert o["offer"] == pytest.approx(round(min(1, cards / n), 4))
        assert o["withRerolls"] == pytest.approx(round(min(1, cards * (1 + rerolls) / n), 4))
        assert 0 < o["offer"] <= o["withRerolls"] <= 1


def test_augment_rules_tiers_match_pool(rules):
    tiers = rules["tiers"]
    assert all(k.isdigit() for k in tiers)
    assert all(v in TIERS for v in tiers.values())
    for tier in TIERS:
        assert sum(1 for v in tiers.values() if v == tier) == rules["odds"][tier]["pool"], tier


def test_mode_rules(guide):
    m = load_json("guide/mode_rules.json")
    assert m["patch"] == guide["patch"]
    assert m["attackSpeedCap"] >= m["aramAttackSpeedCap"] > 2  # Mayhem raises the cap above regular ARAM's
    assert m["critOverflow"] in ("adaptive", None)
    assert m["runes"] in (True, False)
    assert m["aura"] and all(l and "@" not in l and "{{" not in l for l in m["aura"])
    tiers = load_json("guide/augment_rules.json")["tiers"]
    for aid, runes in m["keystoneAugments"].items():
        assert aid in tiers and runes and all(runes)
    r = guide["rules"]
    for k in ("attackSpeedCap", "critOverflow", "runes", "aura"):
        assert r[k] == m[k], k


def test_champ_select(guide):
    cs = guide["champSelect"]
    assert cs["runes"] == guide["rules"]["runes"]
    allowed = {x["name"] for x in guide["spells"]}
    assert not allowed & set(cs["notInMayhem"])
    for a in cs["keystoneAugments"]:
        assert a["tier"] in TIERS and a["runes"] and "Keystone" in a["text"]


def test_selection_augments(rules):
    for a in rules["selectionAugments"]:
        assert str(a["id"]) in rules["tiers"] and a["tier"] in TIERS
        assert "@" not in a["text"] and re.search(r"augment|reroll", a["text"], re.I)
    assert rules["goldenReroll"]["name"] and rules["goldenReroll"]["text"]


def test_progression_track(guide, rules):
    t = guide["track"]
    if t is None:
        pytest.skip("no Mayhem track on this patch")
    assert t["name"] and t["start"] <= t["end"]
    assert [r["level"] for r in t["levels"]] == list(range(1, t["size"] + 1))
    assert all(r["kind"] in ("Augment", "Emote", "Icon", "Title", "Reward") and r["name"] for r in t["levels"])
    unlocks = {int(k): v for k, v in rules["unlocks"].items()}
    assert unlocks == {r["augmentId"]: r["level"] for r in t["levels"] if r.get("augmentId")}
    assert sum(r["kind"] == "Augment" for r in t["levels"]) >= t["size"] / 3


def test_augment_details(guide, rules):
    d = load_json("guide/augment_details.json")
    assert d["patch"] == guide["patch"]
    assert set(d["augments"]) == set(rules["tiers"])
    unlocks = rules.get("unlocks", {})
    for aid, a in d["augments"].items():
        assert a["name"] and a["tier"] == rules["tiers"][aid]
        for t in (a["text"], a["tooltip"]):
            assert not re.search(r"@|\{\{|%i:|\?(?=[\s%.,/)]|$)", t), (a["name"], t)
        assert all(isinstance(v, (int, float, list)) for v in a["values"].values())
        assert a["unlockLevel"] == unlocks.get(aid)
    assert any(a["grants"] for a in d["augments"].values())


def test_granted_items(rules):
    ids = [g["id"] for g in rules["grantedItems"]]
    assert len(ids) == len(set(ids))
    for g in rules["grantedItems"]:
        assert g["how"] in ("reward", "free")
        assert g["augmentTier"] in TIERS
        assert str(g["augmentId"]) in rules["tiers"], f"{g['name']} comes from an augment not in the live pool"
    hows = [g["how"] for g in rules["grantedItems"]]
    assert hows == sorted(hows, key=lambda h: h != "reward")  # reward items first


# ---------- guide/history.js ----------

def test_history_shape(history):
    assert {"from", "to", "startPool", "pool", "augments", "patches"} <= set(history)
    assert patch_key(history["from"]) <= patch_key(history["to"])
    assert history["startPool"] > 0 and history["pool"] > 0


def test_history_patches_newest_first(history):
    patches = [e["patch"] for e in history["patches"]]
    assert patches and len(patches) == len(set(patches))
    assert patches == sorted(patches, key=patch_key, reverse=True)
    assert patch_key(patches[0]) <= patch_key(history["to"])
    assert patch_key(patches[-1]) > patch_key(history["from"])


def test_history_events_reference_known_augments(history):
    augs = history["augments"]
    used = set()
    for e in history["patches"]:
        added, removed = set(e["added"]), set(e["removed"])
        assert e["added"] or e["removed"] or e["changed"], e["patch"]
        assert not added & removed, e["patch"]
        changed = [c["id"] for c in e["changed"]]
        assert len(changed) == len(set(changed)), e["patch"]
        assert not set(changed) & added, f"{e['patch']}: a newly added augment is not also a change"
        for c in e["changed"]:
            assert c["changes"]
            for row in c["changes"]:
                assert row["old"] != row["new"], (e["patch"], c["id"], row)
                assert row["name"] != "MaxLevel"  # internal bookkeeping, skipped by the builder
        used |= added | removed | set(changed)
    assert used <= set(augs), sorted(used - set(augs))
    assert set(augs) == used, "every listed augment appears in some patch"


def test_history_augment_entries(history):
    for aid, a in history["augments"].items():
        assert aid.isdigit()
        assert a["name"], aid
        assert a["tier"] in TIERS, (aid, a["tier"])
        assert a["icon"] is None or a["icon"].startswith("/assets/cd/"), aid


def test_history_icons_resolve_or_are_empty(history):
    """babec446 (#87): retired augments whose icon is gone from the game files get no icon instead of a broken
    one. Every icon left in the file must be served by the site."""
    missing = [(aid, a["icon"]) for aid, a in history["augments"].items()
               if a["icon"] and not asset_exists(embed_transform(a["icon"]))]
    assert not missing


def test_history_ships_without_header_comment():
    from deeparam_data_helpers import read
    for f in ("guide/data.js", "guide/history.js"):
        assert read(f).startswith("window."), f"{f}: 5879fa77 removed the generator header comment"


# ---------- builder helpers (guide/build_data.py, guide/build_history.py) ----------

@pytest.fixture(scope="module")
def build_data():
    return load_module("guide/build_data.py", "deeparam_guide_build_data", extra_path=["tools/datamine"])


@pytest.fixture(scope="module")
def build_history():
    return load_module("guide/build_history.py", "deeparam_guide_build_history")


def test_fill_placeholders(build_data):
    fill = build_data.fill
    assert fill("Deal @QuestRequirement@ damage", {}, 1500, 1) == "Deal 1500 damage"
    assert fill("Tier @QuestTier@", {}, None, 3) == "Tier 3"
    assert fill("Gain @Bonus*100@% speed", {"bonus": 0.25}, None, 1) == "Gain 25% speed"
    assert fill("Gain @Unknown@ AP", {}, None, 1) == "Gain ? AP"
    assert fill("Hit with your {{ SpellName }} twice", {}, None, 1) == "Hit with your chosen ability twice"
    assert fill("<br>Line<b>bold</b>", {}, None, 1) == "Linebold"


def test_split_quest_drops_unknowns(build_data):
    text = "QUEST: Deal ? damage to champions.\n\nREWARD: Gain 5 AP.\n\nPoros Fed: ?/12"
    out = build_data.split_quest(text)
    assert out == {"quest": "Deal damage to champions.", "reward": "Gain 5 AP.", "notes": []}
    out = build_data.split_quest('QUEST: Do it.\n\n"A flavour line"\n\nREWARD: Something.')
    assert out["quest"] == "Do it." and out["reward"] == "Something." and out["notes"] == ['"A flavour line"']


def test_strip_unknown_and_clean(build_data):
    assert build_data.strip_unknown("Gain @AP@ Ability Power.") == "Gain Ability Power."
    assert build_data.clean("a<br/>b  <i>c</i>") == "a\nb c"


def test_site_paths_point_at_mirror(build_data, build_history):
    url = "https://raw.communitydragon.org/latest/game/ASSETS/UX/Kiwi/Icon.PNG"
    for mod in (build_data, build_history):
        out = mod.site_paths(f'"{url}"')
        assert out == '"/assets/cd/latest/game/assets/ux/kiwi/icon.png"'
        assert "communitydragon" not in out


def test_mode_mechanics():
    r = load_json("guide/mode_rules.json")
    assert r["startLevel"] == 3
    times = list(r["respawn"]["byLevel"].values())
    assert list(r["respawn"]["byLevel"])[0] == "3" and times == sorted(times) and len(times) == 16
    assert 0 < r["longRange"]["reductionMin"] < r["longRange"]["reductionMax"] < 1 and r["longRange"]["range"] > 0
    assert r["critConversion"]["adPerPercent"] > 0 and r["critConversion"]["apPerPercent"] > 0
    assert 0 < r["structures"]["bonusMax"] < 1 and r["structures"]["from"] < r["structures"]["to"]
    assert 0 < r["minions"]["aoeMultiplier"] <= 1 and r["minions"]["blackout"]["range"] > 0
    assert 0 < r["relics"]["pickup"] < r["relics"]["beam"] < 1
    assert {f["map"] for f in r["fastTravel"]} >= {"Howling Abyss", "Koeshin's Crossing", "Butcher's Bridge"}



def test_official_track_and_story(guide):
    t = guide["track"]  # None between tracks, when the event hub has no live Mayhem track
    if t and t.get("totalXp"):
        assert sum(r["xp"] for r in t["levels"]) == t["totalXp"] and all(o["xp"] > 0 for o in t["objectives"])
        assert "A title" not in [r["name"] for r in t["levels"]]
    assert guide["story"] and all(e["date"] and e["text"] for e in guide["story"])

def test_game_constants():
    c = load_json("guide/game_constants.json")
    assert c["mayhemQueue"] in c["mayhemQueues"] and {m["id"] for m in c["maps"]} >= {12}
    assert all(q["id"] and q["name"] for q in c["queues"])


def test_economy(guide):
    """Gold & XP card: the mode's passive income, kill gold and XP curve (Simulator reads the same block)."""
    e = guide["rules"]["economy"]
    assert e == load_json("guide/mode_rules.json")["economy"]
    assert e["startingGold"] > 0 and e["killGold"] > 0 and e["firstBlood"] > 0 and e["assistSeconds"] > 0
    g = e["passiveGold"]
    assert g["perMinute"] == round(g["amount"] * 60 / g["every"], 1) and g["aramPerMinute"] > 0
    levels = [l["level"] for l in e["levels"]]
    assert levels == list(range(levels[0], 19)) and levels[0] > 1
    xp = [l["xp"] for l in e["levels"]]
    assert xp == sorted(xp) and all(l["killXp"] > 0 for l in e["levels"])
    assert len(e["minionXpSplit"]) == 5 and e["minionXpSplit"] == sorted(e["minionXpSplit"], reverse=True)


def test_surrender(guide):
    s = guide["rules"]["surrender"]
    assert s["voteSeconds"] > 0 and 0 < s["opensWithAfk"] <= s["opens"]
    assert 0 < s["remakeFrom"] < s["remakeUntil"] <= s["opens"]


def test_rival_quests(guide):
    """Champion quests that run in Mayhem: each has a name and, per champion, a goal; ids are real champions."""
    qs = guide["rivalQuests"]
    assert len(qs) >= 3 and len({q["name"] for q in qs}) == len(qs)
    champs = {c["id"] for c in load_js_data("champions/data.js", "CHAMPS_DATA")["champions"]}
    for q in qs:
        assert q["name"] and q["champions"]
        for c in q["champions"]:
            assert c["id"] in champs and c["name"] and c["text"] and "<" not in c["text"] and "@" not in c["text"]


def test_fallback_augments(guide, rules):
    """When a rarity runs out, the game offers from a fixed list per rarity; each augment there has that rarity."""
    fb = guide["fallbackAugments"]
    assert [f["tier"] for f in fb] == ["Silver", "Gold", "Prismatic"]
    for f in fb:
        assert f["augments"] and all(a["tier"] == f["tier"] and a["name"] and a["id"] for a in f["augments"])


def test_turrets(guide):
    """Turrets card: the three Howling Abyss turrets, with Mayhem's own health where it overrides the base."""
    t = guide["rules"]["turrets"]
    assert t == load_json("guide/mode_rules.json")["turrets"]
    assert [x["key"] for x in t] == ["outer", "inhibitor", "nexus"]
    for x in t:
        assert x["hp"] > 0 and x["damage"] > 0 and x["armor"] > 0 and x["range"] > 0 and 0 < x["attackSpeed"] < 2
        assert x["baseHp"] is None or x["baseHp"] != x["hp"]
