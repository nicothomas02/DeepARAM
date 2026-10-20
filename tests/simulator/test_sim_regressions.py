"""Regression tests for Simulator bugs fixed in git history (and a few found while writing these).

Each test names the commit / PR it guards. Cases marked xfail(strict=True) are open bugs: they
fail today, and pytest reports XPASS (a failure, because strict) once the bug is fixed, as a
reminder to drop the marker.
"""
from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
import sys

import pytest

from sim_paths import DATA_DIR, PBE_DIR, SIM_DIR, VIEWER_DIR, load_json

JINX_BUILD = ["--items", "berserkers,infinity_edge,botrk,lord_dominiks,runaans,seryldas",
              "--augs", "deft,its_critical,mystic_punch,dual_wield"]
AP_ITEMS = "sorcerers,ludens,rabadons,shadowflame,void_staff,zhonyas"
DUMMIES = "fixed_target=1,until_death=0,enemy_damage_scale=0,cc_scale=0,dodge_chance=0"


def summary(out):
    return out["builds"][0]["summary"]


# ---------------------------------------------------------------- Hwei (724cab51, #113)

HWEI_FILES = [DATA_DIR / "champions.json", PBE_DIR / "champions.json", VIEWER_DIR / "replay-data/pbe/champions.json"]


@pytest.mark.parametrize("path", HWEI_FILES, ids=lambda p: str(p.relative_to(SIM_DIR)))
def test_hwei_casts_one_subspell_per_ability_in_data(path):
    """Hwei's Q, W and E each counted all three subspells on every cast (#113)."""
    hwei = next(c for c in load_json(path)["champions"] if c["id"] == "Hwei")
    abil = {a["slot"]: a for a in hwei["abilities"]}

    def counted(slot):
        return [h["calc"] for h in abil[slot]["hits"] if not h["alt"]]

    # QQ Devastating Fire, WE Stirring Lights, EQ Gaze of the Abyss; the other subspells are alternatives.
    assert counted("Q") and all(c.startswith("Tooltip_QQ") for c in counted("Q")), counted("Q")
    assert counted("W") == ["Tooltip_WEOnHitDamage"], counted("W")
    assert counted("E") and all(c.startswith("Tooltip_EQ") for c in counted("E")), counted("E")
    # Q and E are skillshots that can miss, not self-buffs that always land.
    for slot in ("Q", "E"):
        geo = abil[slot]["geometry"]
        assert geo["shape"] == "line" and not geo["on_self"] and geo["speed"] > 0, (slot, geo)
        assert abil[slot]["cast_time"] > 0
    assert abil["E"]["cc"]["type"] == "fear"


def test_hwei_kit_reads_one_subspell_each(run_sim):
    out = run_sim("mayhem_sim", ["--kit", "Hwei"], check=True).stdout
    lines = {}
    slot = None
    for line in out.splitlines():
        m = re.match(r"^  ([QWER]) Hwei\1\s", line)
        if m:
            slot = m.group(1)
            lines[slot] = 0
        elif slot and re.match(r"^\s{6}(magic|physical|true)\s", line):
            lines[slot] += 1
    assert lines.get("Q") == 2 and lines.get("W") == 1 and lines.get("E") == 1, (lines, out)


def test_hwei_does_not_outdamage_every_mage(run_json):
    """Before #113 Hwei out-damaged every other mage while barely being hit."""
    mages = ["Hwei", "Lux", "Ahri", "Syndra", "Brand", "Xerath", "Veigar", "Annie", "Viktor", "Orianna"]
    res = {m: summary(run_json("mayhem_sim", ["--champ", m, "--items", AP_ITEMS, "--trials", "400", "--seed", "3", "--json"]))
           for m in mages}
    others = [res[m]["mean_dps"] for m in mages[1:]]
    assert res["Hwei"]["mean_dps"] < max(others)
    assert res["Hwei"]["mean_dps"] < 1.3 * statistics.median(others)
    taken = statistics.median(res[m]["damage_taken_per_s"] for m in mages[1:])
    assert res["Hwei"]["damage_taken_per_s"] > 0.6 * taken


# ---------------------------------------------------------------- Witchful Thinking (19636998, #63)

@pytest.mark.parametrize("path", [DATA_DIR / "augments.json", PBE_DIR / "augments.json"],
                         ids=lambda p: str(p.relative_to(SIM_DIR)))
def test_witchful_thinking_data_is_20_to_80_ap(path):
    aug = load_json(path)["augments"]["witchful_thinking"]
    assert aug["effects"].get("ap_min") == 20 and aug["effects"].get("ap_max") == 80, aug
    assert "ap" not in aug.get("stats", {}), "Witchful Thinking must not also grant flat AP (the old 70)"


def test_witchful_thinking_scales_with_level(run_json):
    """20 AP at level 1 up to 80 at level 18: the level-1 gain is about a quarter of the level-18 gain."""
    def dps(level, augs):
        args = ["--champ", "Lux", "--items", "", "--set", f"{DUMMIES},level={level}", "--trials", "400", "--seed", "5", "--json"]
        if augs:
            args += ["--augs", augs]
        return summary(run_json("mayhem_sim", args))["mean_dps"]

    gain18 = dps(18, "witchful_thinking") - dps(18, "")
    gain1 = dps(1, "witchful_thinking") - dps(1, "")
    assert gain18 > 0
    assert 0 <= gain1 < 0.5 * gain18, (gain1, gain18)


# ---------------------------------------------------------------- Stormrazor id (af506266, #97)

def test_stormrazor_uses_game_id_3095():
    """Build stats name Stormrazor 3097; the game (and the simulator) use 3095."""
    for path in (DATA_DIR / "items.json", PBE_DIR / "items.json", VIEWER_DIR / "replay-data/pbe/items.json"):
        items = load_json(path)["items"]
        assert items["stormrazor"]["id"] == 3095, path
        assert not [k for k, v in items.items() if v["id"] == 3097], path
    effects = load_json(DATA_DIR / "item_effects.json")
    assert effects["items"]["3095"]["key"] == "stormrazor"
    assert "3097" not in effects["items"]


def test_stormrazor_runs_in_both_sims(run_json):
    out = run_json("mayhem_sim", ["--champ", "Jinx", "--items", "stormrazor", "--set", "fixed_target=1",
                                  "--trials", "200", "--seed", "5", "--json"])
    assert summary(out)["mean_dps"] > 0
    assert summary(out)["share_by_source"]["Items and augments"] > 0, "Stormrazor's storm damage is missing"
    y = run_json("yunara_sim", ["--builds", "stormrazor_crit", "--trials", "200", "--seed", "5", "--json"])
    assert y["builds"][0]["id"] == "stormrazor_crit" and y["builds"][0]["dps"] > 0


def test_replay_traces_carry_real_item_ids():
    """The site shows item icons by id from these committed traces; a wrong id shows a blank item."""
    items = load_json(DATA_DIR / "items.json")["items"]
    traces = load_json(VIEWER_DIR / "replay-data/traces.json")
    bad = []
    for champ, tr in traces.items():
        for it in tr["build"]["items"]:
            if it["key"] not in items or items[it["key"]]["id"] != it["id"]:
                bad.append((champ, it))
    assert not bad, bad[:10]


# ---------------------------------------------------------------- unknown ids are rejected

@pytest.mark.parametrize("args, message", [
    (["--champ", "Jinx", "--items", "berserkers,not_an_item"], "unknown item 'not_an_item'"),
    (["--champ", "Jinx", "--items", "berserkers", "--augs", "not_an_aug"], "unknown augment 'not_an_aug'"),
    (["--champ", "Jinx", "--items", "3095"], "unknown item '3095'"),  # keys, not numeric ids
    (["--champ", "Jinx", "--items", "berserkers", "--team", "Malphite:items=nosuch"], "unknown item 'nosuch'"),
    (["--champ", "Jinx", "--items", "berserkers", "--team", "Malphite:augs=nosuch"], "nosuch"),
    (["--champ", "Jinx", "--allies", "Lulu:items=nosuch,Leona,Ahri,Darius"], "unknown item 'nosuch'"),
], ids=["item", "augment", "numeric-id", "enemy-item", "enemy-augment", "ally-item"])
def test_mayhem_sim_rejects_unknown_ids(run_sim, args, message):
    proc = run_sim("mayhem_sim", [*args, "--trials", "20", "--seed", "1", "--json"])
    assert proc.returncode != 0 and proc.returncode > 0
    assert message in proc.stderr
    assert "terminate called" not in proc.stderr


@pytest.mark.parametrize("args", [["--items", "berserkers,not_an_item"], ["--items", "berserkers", "--augs", "not_an_aug"]],
                         ids=["item", "augment"])
def test_yunara_sim_rejects_unknown_ids_cleanly(run_sim, args):
    proc = run_sim("yunara_sim", [*args, "--trials", "20", "--seed", "1"])
    assert proc.returncode > 0, proc.returncode
    assert "not_an_" in proc.stderr and "terminate called" not in proc.stderr


# ---------------------------------------------------------------- PBE patch (19636998 #63, 7a8978de #65)

def test_pbe_data_is_the_pbe_patch():
    live = load_json(DATA_DIR / "champions.json")["meta"]
    pbe = load_json(PBE_DIR / "champions.json")["meta"]
    assert pbe["cdragon"] == "pbe" and live["cdragon"] != "pbe"
    assert {c["id"] for c in load_json(PBE_DIR / "champions.json")["champions"]} >= \
        {c["id"] for c in load_json(DATA_DIR / "champions.json")["champions"]}


def test_viewer_pbe_copy_matches_data_pbe(tmp_path):
    """tools/refresh_pbe.sh ships data/pbe/ (notes stripped) to viewer/replay-data/pbe/, which the browser loads."""
    names = ("champions", "items", "augments", "augment_pools")
    files = [str(PBE_DIR / f"{n}.json") for n in names]
    subprocess.run([sys.executable, str(SIM_DIR / "tools/strip_notes.py"), str(tmp_path), *files], check=True, timeout=120)
    for n in names:
        assert load_json(tmp_path / f"{n}.json") == load_json(VIEWER_DIR / f"replay-data/pbe/{n}.json"), \
            f"viewer/replay-data/pbe/{n}.json is out of date; run sh simulator/tools/refresh_pbe.sh"


def test_game_data_dir_is_what_gets_loaded(run_json, tmp_path):
    """--game-data DIR (the Live/PBE switch) reads champions, items and augments from DIR.

    Uses the PBE files plus any live augment the enemy pool needs, so this checks the loading
    mechanism independently of the open PBE bug below.
    """
    for n in ("champions", "items"):
        shutil.copy(PBE_DIR / f"{n}.json", tmp_path / f"{n}.json")
    pbe_augs = load_json(PBE_DIR / "augments.json")
    live_augs = load_json(DATA_DIR / "augments.json")["augments"]
    merged = dict(pbe_augs["augments"])
    for k, v in live_augs.items():
        merged.setdefault(k, v)
    (tmp_path / "augments.json").write_text(json.dumps({"augments": merged}))
    out = run_json("mayhem_sim", ["--list", "--json", "--game-data", tmp_path])
    keys = {a["key"] for a in out["augments"]}
    assert keys == set(merged)
    pbe_only = set(pbe_augs["augments"]) - set(live_augs)
    assert pbe_only and pbe_only <= keys
    live = run_json("mayhem_sim", ["--list", "--json"])
    assert {a["key"] for a in live["augments"]} == set(live_augs)




# ---------------------------------------------------------------- PBE augment pools (PBE best builds)

def _norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _datamine_augments():
    return load_json(SIM_DIR.parent / "data/pbe/kiwi-s3.json")["augments"]


def test_pbe_augments_follow_the_datamine():
    """The PBE patch's augments: live, less the removed and disabled ones, plus the added ones."""
    dm = _datamine_augments()
    live = {_norm(a["name"]) for a in load_json(DATA_DIR / "augments.json")["augments"].values()}
    pbe = {_norm(a["name"]) for a in load_json(PBE_DIR / "augments.json")["augments"].values()}
    added = {_norm(a["name"]) for a in dm["added"]} - {_norm("Pentakill (choose any ability)")}
    gone = {_norm(a["name"]) for a in dm["removed"]} | {
        _norm(c["name"]) for c in dm["changed"]
        if any("disabled" in str(x.get("pbe", "")).lower() for x in c["changes"])}
    assert pbe == (live - gone) | added


def test_pbe_pools_offer_only_pbe_augments_and_every_new_one():
    pbe = load_json(PBE_DIR / "augments.json")["augments"]
    live = set(load_json(DATA_DIR / "augments.json")["augments"])
    new = set(pbe) - live
    pools = load_json(PBE_DIR / "augment_pools.json")["pools"]
    assert pools.keys() == load_json(DATA_DIR / "augment_pools.json")["pools"].keys()
    for cid, pool in pools.items():
        assert set(pool) <= set(pbe), cid
        assert new <= set(pool), cid


def test_pbe_switch_uses_pbe_pools(run_json):
    live = run_json("mayhem_sim", ["--list", "--json"])
    pbe = run_json("mayhem_sim", ["--list", "--json", "--game-data", "data/pbe"])
    jinx = {c["id"]: set(c["augments"]) for c in pbe["champions"]}["Jinx"]
    assert "big_shot" in jinx and "big_shot" not in {a["key"] for a in live["augments"]}
    gone = {a["key"] for a in live["augments"]} - {a["key"] for a in pbe["augments"]}
    assert gone and not gone & jinx


def test_most_new_pbe_augments_are_modeled():
    """New PBE augments get effects from the PBE client's numbers; the rest say why they have none."""
    pbe = load_json(PBE_DIR / "augments.json")["augments"]
    new = [a for k, a in pbe.items() if k not in load_json(DATA_DIR / "augments.json")["augments"]]
    modeled = [a for a in new if a.get("stats") or a.get("effects")]
    assert len(modeled) >= 29, sorted(a["name"] for a in new if a not in modeled)
    for a in new:
        assert a in modeled or a.get("note", "").startswith("No effect in the simulator"), a["name"]


def test_pbe_list_json_loads(run_sim):
    proc = run_sim("mayhem_sim", ["--list", "--json", "--game-data", "data/pbe"])
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert {a["key"] for a in out["augments"]} == set(load_json(PBE_DIR / "augments.json")["augments"])


def test_pbe_fixed_build_runs(run_sim):
    proc = run_sim("mayhem_sim", ["--champ", "Jinx", *JINX_BUILD, "--game-data", "data/pbe",
                                  "--trials", "200", "--seed", "1", "--json"])
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["builds"][0]["summary"]["mean_dps"] > 0


# ---------------------------------------------------------------- other behaviour the site relies on

def test_combo_changes_cast_order(run_json):
    """--combo / combo_order (ffed6fa3): a different cast order changes the fight."""
    base = ["--champ", "Ahri", "--items", AP_ITEMS, "--trials", "300", "--seed", "2", "--json"]
    default = summary(run_json("mayhem_sim", base))
    explicit = summary(run_json("mayhem_sim", [*base, "--combo", "EQRW"]))  # Ahri's recommended combo
    other = summary(run_json("mayhem_sim", [*base, "--combo", "WRQE"]))
    strongest = summary(run_json("mayhem_sim", [*base, "--set", "combo_order=0"]))
    assert default == explicit
    assert other != default and strongest != default


def test_5v5_swapping_teams_gives_opposite_odds(run_json):
    """README: swapping the teams gives exactly the opposite odds (f1d9139b, #121)."""
    a = run_json("mayhem_sim", ["--champ", "Jinx", "--allies", "Lulu,Leona,Ahri,Darius",
                                "--team", "Malphite,Brand,Sivir,Nami,Trundle", "--trials", "200", "--seed", "5", "--json"])
    b = run_json("mayhem_sim", ["--champ", "Malphite", "--allies", "Brand,Sivir,Nami,Trundle",
                                "--team", "Jinx,Lulu,Leona,Ahri,Darius", "--trials", "200", "--seed", "5", "--json"])
    assert a["win_rate"] + b["win_rate"] == pytest.approx(1.0, abs=1e-9)


def test_trace_does_not_change_the_result(run_json, tmp_path):
    """Recording a replay never changes the random draws (README, Fight replays)."""
    args = ["--champ", "Veigar", "--items", AP_ITEMS, "--trials", "300", "--seed", "4", "--json"]
    plain = run_json("mayhem_sim", args)
    traced = run_json("mayhem_sim", [*args, "--trace", tmp_path / "t.json"])
    assert plain == traced
    tr = load_json(tmp_path / "t.json")
    assert tr["summary"]["mean_dps"] == plain["builds"][0]["summary"]["mean_dps"]


def test_short_and_long_fight_dps_are_reported(run_json):
    """#130: every summary reports dps_short_fight (first 6 s) and dps_long_fight (first 20 s)."""
    s = summary(run_json("mayhem_sim", ["--champ", "Jinx", *JINX_BUILD, "--trials", "300", "--seed", "1", "--json"]))
    assert s["dps_short_fight"] > 0 and s["dps_long_fight"] > 0


def test_5v5_rejects_duplicate_allies(run_sim):
    proc = run_sim("mayhem_sim", ["--champ", "Jinx", "--allies", "Lulu,Lulu,Leona,Ahri", "--trials", "20", "--seed", "1"])
    assert proc.returncode > 0


# ---------------------------------------------------------------- a new enemy after each kill

SHYVANA = ["--champ", "Shyvana", "--items", "sorcerers,gunblade,rabadons,shadowflame,stormsurge,void_staff",
           "--augs", "overloaded,eureka,ominous_pact,back_to_basics", "--seed", "3"]


def _traced(run_sim, tmp_path, extra=()):
    path = tmp_path / "trace.json"
    proc = run_sim("mayhem_sim", [*SHYVANA, *extra, "--json", "--trace", path])
    assert proc.returncode == 0, proc.stderr
    return load_json(path)


def test_fallen_enemy_is_replaced_by_a_new_random_champion(run_sim, tmp_path):
    fight = _traced(run_sim, tmp_path)["fight"]
    assert fight["kills"] >= 2
    assert len(fight["team"]) == len(set(fight["team"])) and len(fight["team"]) >= 3


def test_same_enemy_comes_back_when_asked(run_sim, tmp_path):
    assert len(_traced(run_sim, tmp_path, ["--set", "random_respawn=0"])["fight"]["team"]) == 1
    fight = _traced(run_sim, tmp_path, ["--team", "Ashe"])["fight"]
    assert fight["kills"] >= 1 and fight["team"] == ["Ashe"]


def test_trace_has_cooldowns_with_the_builds_haste(run_sim, tmp_path):
    for a in _traced(run_sim, tmp_path)["abilities"]:
        assert 0 < a["build_cooldown"] <= a["cooldown"], a


# ---------------------------------------------------------------- Kit fixes for the furthest-off champions (2026-10-20)

def test_attacks_take_time_off_senna_q(run_sim, tmp_path):
    """Senna's attacks take 1 s off Piercing Darkness's cooldown (attack_cdr), so with no ability haste
    Q comes back sooner than its 15 s cooldown."""
    path = tmp_path / "senna.json"
    proc = run_sim("mayhem_sim", ["--champ", "Senna", "--items", "infinity_edge,berserkers", "--augs", "",
                                  "--seed", "3", "--json", "--trace", path,
                                  "--set", DUMMIES + ",fight_min=40,fight_max=40,target_hp=1000000"])
    assert proc.returncode == 0, proc.stderr
    casts = [e["t"] for e in load_json(path)["events"] if e["k"] == "cast" and e.get("s") == "Q"]
    assert len(casts) >= 3
    assert max(b - a for a, b in zip(casts, casts[1:])) < 14


@pytest.mark.parametrize("path", [DATA_DIR / "champions.json", PBE_DIR / "champions.json"], ids=["live", "pbe"])
def test_kit_fixes_in_data(path):
    """Requiem hits every enemy champion, Equinox's root hit counts at extra-hit weight, and Tormented
    Shadow and High Note grow with the target's missing Health."""
    champs = {c["id"]: {a["slot"]: a for a in c["abilities"]} for c in load_json(path)["champions"]}
    assert champs["Karthus"]["R"]["hits"][0]["scaling"]["const"] >= 4 * 200
    assert [h["calc"] for h in champs["Soraka"]["E"]["hits"]] == ["TotalDamage", "RootDamage"]
    assert champs["Morgana"]["W"]["missing_amp"] == 1.0
    assert champs["Seraphine"]["Q"]["missing_amp"] == 1.0 and champs["Seraphine"]["Q"]["missing_max"] == 0.75
    for champ, slot in (("Senna", "Q"), ("Kaisa", "E"), ("Shyvana", "Q"), ("Zeri", "E"), ("Graves", "E")):
        assert champs[champ][slot]["attack_cdr"] > 0, (champ, slot)


# ---------------------------------------------------------------- Optimize for shielding (2026-10-20)

def test_shielding_is_reported_and_ranked(run_json, run_sim, tmp_path):
    """The summary reports the damage your shields absorbed per fight, the trace carries it as a running
    total ("ab"), and --metric shielding is accepted."""
    args = ["--champ", "Riven", "--trials", "100", "--seed", "2", "--json"]  # Valor (E) shields herself
    assert summary(run_json("mayhem_sim", args))["shielding"] > 0
    assert summary(run_json("mayhem_sim", ["--champ", "Jinx", *JINX_BUILD, "--trials", "100", "--seed", "2", "--json"]))["shielding"] == 0
    run_json("mayhem_sim", [*args, "--trace", tmp_path / "t.json"])
    tr = load_json(tmp_path / "t.json")
    absorbed = [e["ab"] for e in tr["events"] if e["k"] in ("self", "death") and "ab" in e]
    assert absorbed and absorbed == sorted(absorbed)
    assert abs(absorbed[-1] - tr["fight"]["shielding"]) <= 1
    proc = run_sim("mayhem_sim", ["--champ", "Riven", "--metric", "shielding", "--trials", "20", "--seed", "1", "--json"])
    assert proc.returncode == 0, proc.stderr


# ---------------------------------------------------------------- Training dummy like the game's (2026-10-20)

def test_training_dummy_is_like_the_practice_dummy(run_json):
    """The dummy never dies (its Health refills), never hits back or crowd controls you, and every
    fight lasts the usual fight length (fight_mean), so the result is the champion's pure DPS."""
    s = summary(run_json("mayhem_sim", ["--champ", "Jinx", *JINX_BUILD, "--set", "fixed_target=1,target_hp=500",
                                        "--trials", "50", "--seed", "1", "--json"]))
    assert s["kills_per_minute"] == 0 and s["damage_taken"] == 0 and s["survival_rate"] == 1
    assert s["time_alive"] == 18.0 and s["mean_dps"] > 1000
