"""Traps and Bug finder (data/checks/): stat-loop search, the build checker and the shipped findings.json."""
import json
import re

import pytest

from deeparam_data_helpers import load_json, load_module

F = load_module("data/checks/findings.py", "checks_findings", extra_path=["data/checks"])
C = load_module("data/checks/check_build.py", "checks_build", extra_path=["data/checks"])


def tiny(pools, kitchen=(), best=(), builds=None, no_data=()):
    """A small made-up world: three champions and the augments the loop search cares about."""
    augs = {
        "tickle_monster": {"id": 1, "name": "Tickle Monster", "effects": {"ad_to_as": 0.0175}},
        "adapt": {"id": 2, "name": "ADAPt", "stats": {"ad_to_ap": 1.6}},
        "escapade": {"id": 3, "name": "escAPADe", "stats": {"ap_to_ad": 0.6}},
        "skilled_sniper": {"id": 4, "name": "Skilled Sniper", "effects": {}},
        "overflow": {"id": 5, "name": "Overflow", "effects": {"overflow_amp_per_mana": 5e-05}},
        "spirit_bomb": {"id": 6, "name": "Spirit Bomb", "effects": {}},
    }
    champs = [
        {"id": "Jhin", "name": "Jhin", "champion_id": 202, "ranged": True, "resource": {"kind": "mana"}},
        {"id": "Ashe", "name": "Ashe", "champion_id": 22, "ranged": True, "resource": {"kind": "mana"}},
        {"id": "Garen", "name": "Garen", "champion_id": 86, "ranged": False, "resource": {"kind": "none"}},
    ]
    return {
        "augments": augs, "pools": pools, "champions": champs,
        "items": {"botrk": {"id": 3153, "name": "Blade of The Ruined King"}, "ie": {"id": 3031, "name": "Infinity Edge"}},
        "best": list(best), "real": {"202": {"pick_rate": 0.1}, "22": {"pick_rate": 0.1}, "86": {"pick_rate": 0.1}},
        "builds": builds or {}, "kitchen": list(kitchen), "no_data": set(no_data), "patch": "26.22",
    }


def test_jhin_and_tickle_monster_make_a_loop():
    d = tiny({"202": ["tickle_monster"], "22": [], "86": []})
    loops = F.find_loops(d)
    assert [f["id"] for f in loops] == ["loop-tickle_monster-Jhin"]
    assert "Whisper turns Attack Speed into Attack Damage" in loops[0]["theory"]


def test_no_loop_without_the_augment_in_the_pool():
    assert F.find_loops(tiny({"202": [], "22": [], "86": []})) == []


def test_augment_only_loops_group_champions():
    d = tiny({"202": ["adapt", "escapade"], "22": ["adapt", "escapade"], "86": ["adapt"]})
    loops = {f["id"]: f for f in F.find_loops(d)}
    assert loops["loop-adapt+escapade"]["champions"] == ["Ashe", "Jhin"]


def test_curated_result_moves_a_loop_to_traps():
    d = tiny({"202": ["tickle_monster"], "22": [], "86": []})
    out = F.build(d, curated=[{"id": "loop-tickle_monster-Jhin", "status": "trap", "practice": "It settles."}])
    assert [f["id"] for f in out["traps"]] == ["loop-tickle_monster-Jhin"]
    assert out["traps"][0]["practice"] == "It settles."
    assert not [f for f in out["bugs"] if f["kind"] == "loop"]
    out = F.build(d, curated=[{"id": "loop-tickle_monster-Jhin", "status": "fine"}])
    assert not out["traps"] and not [f for f in out["bugs"] if f["kind"] == "loop"]


def test_ranged_only_augment_on_a_melee_champion():
    d = tiny({"202": ["skilled_sniper"], "22": ["skilled_sniper"], "86": ["adapt"]})
    assert F.check_pool(d, "Garen", ["Skilled Sniper"]) == [("Skilled Sniper", "range")]
    problems = C.check("Garen", ["Skilled Sniper"], d=d, findings={"traps": [], "bugs": []})
    assert problems and problems[0]["level"] == "block" and "ranged champions" in problems[0]["message"]


def test_no_stats_yet_is_only_a_warning():
    d = tiny({"202": [], "22": [], "86": []}, no_data={6})
    assert C.check("Jhin", ["Spirit Bomb"], d=d, findings={"traps": [], "bugs": []}) == [
        {"level": "warn", "message": "There are no stats on Spirit Bomb yet this patch: check that Jhin can still be offered it."}
    ]


def test_checker_blocks_a_known_trap_and_passes_a_clean_build():
    d = tiny({"202": ["tickle_monster", "adapt"], "22": [], "86": []})
    found = F.build(d, curated=[{"id": "loop-tickle_monster-Jhin", "status": "trap", "practice": "It settles."}])
    assert any(p["level"] == "block" and "Traps list" in p["message"] for p in C.check("Jhin", ["Tickle Monster"], d=d, findings=found))
    assert C.check("Jhin", ["ADAPt"], d=d, findings=found) == []
    assert C.check("Jhin", ["Not An Augment"], d=d, findings=found)[0]["level"] == "block"


def test_mana_augment_on_a_champion_without_mana():
    d = tiny({"202": [], "22": [], "86": ["overflow"]})
    assert [f["id"] for f in F.find_wasted(d)] == ["wasted-overflow-Garen"]


def test_simulator_favourite_that_loses_in_real_games():
    full = [
        {"items": [3153, 1, 2, 3, 4, 5], "pick_rate": 0.1, "win_rate": 0.45},
        {"items": [3153, 1, 2, 3, 4, 6], "pick_rate": 0.1, "win_rate": 0.46},
        {"items": [3031, 1, 2, 3, 4, 5], "pick_rate": 0.1, "win_rate": 0.52},
        {"items": [3031, 1, 2, 3, 4, 6], "pick_rate": 0.1, "win_rate": 0.51},
    ]
    best = [{"champion": "Jhin", "build": {"items": ["botrk", "ie"]}}]
    d = tiny({"202": [], "22": [], "86": []}, best=best, builds={"202": {"items": {"full_builds": full}}})
    gaps = F.find_sim_gaps(d)
    assert [f["id"] for f in gaps] == ["sim-Jhin-botrk"]
    assert gaps[0]["gap"] == pytest.approx(-0.06)
    assert "6.0 points less" in gaps[0]["practice"]


# The shipped file the Kitchen's Traps and Bug finder tabs read.

@pytest.fixture(scope="module")
def shipped():
    return load_json("data/checks/findings.json")


def test_shipped_findings_shape(shipped):
    assert shipped["patch"]
    ids = [f["id"] for f in shipped["traps"] + shipped["bugs"]]
    assert len(ids) == len(set(ids))
    for f in shipped["traps"]:
        assert f["status"] == "trap" and f["practice"], f["id"]
    for f in shipped["bugs"]:
        assert f["status"] in ("to_test", "confirmed") and f["test"], f["id"]
    for f in shipped["traps"] + shipped["bugs"]:
        assert f["kind"] in ("loop", "gap", "sim", "wasted"), f["id"]
        assert f["title"] and f["theory"], f["id"]


def test_tickle_monster_jhin_is_a_trap(shipped):
    assert "loop-tickle_monster-Jhin" in {f["id"] for f in shipped["traps"]}


def test_site_text_names_no_data_source(shipped):
    """Nothing shown on the site names where the numbers come from (project rule)."""
    text = json.dumps(shipped["traps"] + shipped["bugs"]).lower()
    for word in ("tencent", "qq.com", "101.qq", "communitydragon", "cdragon", "wegame", "game files", "the feed", "stats feed"):
        assert word not in text, word


def test_no_augment_win_rates(shipped):
    """Riot's policy: no win rates for augments anywhere, so augment findings never quote one."""
    for f in shipped["traps"] + shipped["bugs"]:
        if f["augments"]:
            assert not re.search(r"\bwin", f["theory"] + f.get("practice", "") + f.get("test", ""), re.I), f["id"]


def test_curated_ids_are_well_formed():
    cur = load_json("data/checks/curated.json")
    for e in cur["entries"]:
        assert re.match(r"^(loop|sim|wasted|gap|pool)-", e["id"]), e["id"]
        assert e["status"] in ("trap", "bug", "fine"), e["id"]


def test_fun_builds_only_note_unseen_augments():
    """Chef Specials are for fun (Nico, 2026-11-12): an augment the champion never takes is a note, not a block,
    while practical builds still block it."""
    d = tiny({"202": ["skilled_sniper"], "22": ["skilled_sniper"], "86": ["adapt"]})
    none = {"traps": [], "bugs": []}
    assert C.check("Garen", ["Skilled Sniper"], d=d, findings=none)[0]["level"] == "block"
    assert [p["level"] for p in C.check("Garen", ["Skilled Sniper"], d=d, findings=none, fun=True)] == ["note"]
    assert C.check("Garen", ["Not An Augment"], d=d, findings=none, fun=True)[0]["level"] == "block"
