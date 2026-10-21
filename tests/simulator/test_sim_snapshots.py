"""Pinned regression values: fixed builds, fixed seeds, exact outputs.

The simulator is deterministic per seed (simulator/README.md, "Reproducibility"), and thread
count doesn't change results, so each case below should reproduce snapshots.json exactly. The
comparison uses a relative tolerance of 1e-6 (SIM_SNAPSHOT_REL overrides it, e.g. when a
different compiler or libm rounds a printed digit the other way).

These values move whenever the model or the data is tuned on purpose (the Simulator thread's
daily patch-day accuracy tuning, a data rebuild, a kit fix). When that happens, check the diff
this test prints is what the change intended, then re-pin:

    UPDATE_SNAPSHOTS=1 python3 -m pytest tests/simulator/test_sim_snapshots.py

which rewrites tests/simulator/snapshots.json (only the cases listed here; stale ones are
dropped). Commit it with the change. A case whose build stops being valid (an item or augment
renamed) fails with the simulator's error; fix its args below and re-pin.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import pytest

SNAPSHOT_FILE = Path(__file__).with_name("snapshots.json")
UPDATE = os.environ.get("UPDATE_SNAPSHOTS", "") not in ("", "0", "false", "no")
REL = float(os.environ.get("SIM_SNAPSHOT_REL", "1e-6"))
ABS = 1e-9
SEED = "20261017"

# name -> (binary, args). Keep trial counts small: the whole file runs in a few seconds.
CASES = {
    # Marksman crit/on-hit, the README's example build.
    "mayhem_jinx_crit": ("mayhem_sim", [
        "--champ", "Jinx", "--items", "berserkers,infinity_edge,botrk,lord_dominiks,runaans,seryldas",
        "--augs", "deft,its_critical,mystic_punch,dual_wield", "--trials", "1000", "--seed", SEED, "--json"]),
    # Hwei: one subspell per ability (#113).
    "mayhem_hwei_ap": ("mayhem_sim", [
        "--champ", "Hwei", "--items", "sorcerers,nashors,rabadons,shadowflame,stormsurge,void_staff",
        "--augs", "skilled_sniper,back_to_basics,cruelty,witchful_thinking", "--trials", "1000", "--seed", SEED, "--json"]),
    # Yunara in the all-champion sim, a classic crit build.
    "mayhem_yunara_crit": ("mayhem_sim", [
        "--champ", "Yunara", "--items", "berserkers,yuntal,infinity_edge,phantom_dancer,lord_dominiks,runaans",
        "--augs", "dual_wield,its_critical,upgrade_infinity_edge,deft", "--trials", "1000", "--seed", SEED, "--json"]),
    # Veigar: Phenomenal Evil kit stacks (kit_passives.json) and an AP build.
    "mayhem_veigar_ap": ("mayhem_sim", [
        "--champ", "Veigar", "--items", "sorcerers,lich_bane,nashors,rabadons,stormsurge,void_staff",
        "--augs", "giant_slayer,marksmage,forged_by_the_master,en_passant", "--trials", "1000", "--seed", SEED, "--json"]),
    # A tank on a tank build.
    "mayhem_malphite_tank": ("mayhem_sim", [
        "--champ", "Malphite", "--items", "plated,sunfire,thornmail,jaksho,randuins,frozen_heart",
        "--augs", "goliath,courage_of_the_colossus,mountain_soul,tank_engine", "--trials", "1000", "--seed", SEED, "--json"]),
    # An AP mage at level 13 with mana costs.
    "mayhem_lux_ap_level13": ("mayhem_sim", [
        "--champ", "Lux", "--items", "sorcerers,ludens,rabadons,shadowflame,void_staff,zhonyas",
        "--augs", "back_to_basics,marksmage,witchful_thinking,archmage", "--set", "level=13",
        "--trials", "1000", "--seed", SEED, "--json"]),
    # A fighter (passives, healing, Sterak's shield).
    "mayhem_darius_bruiser": ("mayhem_sim", [
        "--champ", "Darius", "--items", "berserkers,black_cleaver,botrk,heartsteel,overlords_bloodmail,steraks",
        "--augs", "tank_engine,triggered_inferno,giant_slayer,goliath", "--trials", "1000", "--seed", SEED, "--json"]),
    # Training dummies, no damage back: pure kit damage.
    "mayhem_ahri_dummies": ("mayhem_sim", [
        "--champ", "Ahri", "--items", "sorcerers,ludens,rabadons,shadowflame,void_staff,zhonyas",
        "--augs", "marksmage,giant_slayer", "--set", "fixed_target=1,until_death=0,enemy_damage_scale=0,cc_scale=0",
        "--trials", "1000", "--seed", SEED, "--json"]),
    # A picked enemy team with changed stats and gear.
    "mayhem_jinx_vs_team": ("mayhem_sim", [
        "--champ", "Jinx", "--items", "berserkers,infinity_edge,botrk,lord_dominiks,runaans,seryldas",
        "--augs", "deft,its_critical,mystic_punch,dual_wield",
        "--team", "Malphite:hp=6000:armor=300,Brand,Sivir:items=infinity_edge+runaans,Nami,Trundle",
        "--set", "team_size=5", "--trials", "500", "--seed", SEED, "--json"]),
    # 5v5 teamfight.
    "mayhem_5v5_jinx": ("mayhem_sim", [
        "--champ", "Jinx", "--allies", "Lulu,Leona,Ahri,Darius", "--team", "Malphite,Brand,Sivir,Nami,Trundle",
        "--trials", "200", "--seed", SEED, "--json"]),
    # The optimizer (search, then a 100-fight final comparison).
    "mayhem_ahri_optimizer": ("mayhem_sim", ["--champ", "Ahri", "--trials", "100", "--seed", SEED, "--json"]),
    # yunara_sim: every preset build.
    "yunara_presets": ("yunara_sim", ["--trials", "1000", "--seed", SEED, "--json"]),
    # yunara_sim: a custom build against the archetype enemies and a fixed target.
    "yunara_custom_archetypes": ("yunara_sim", [
        "--items", "berserkers,yuntal,ie,pd,ldr,runaan", "--augs", "symphony_of_war,critical_rhythm,upgrade_ie,double_tap",
        "--enemies", "archetypes", "--trials", "1000", "--seed", SEED, "--json"]),
    "yunara_fixed_target_level11": ("yunara_sim", [
        "--builds", "meta_crit,stormrazor_crit", "--target", "3000,120,80", "--level", "11",
        "--enemy-dps", "0,0", "--trials", "1000", "--seed", SEED, "--json"]),
}

# Lists longer than this (fight timelines) are pinned by length only.
MAX_LIST = 40


def flatten(value, prefix=""):
    """{"a": {"b": [1, 2]}} -> {"a.b[0]": 1, "a.b[1]": 2}; long lists keep only their length."""
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(value, list):
        if len(value) > MAX_LIST:
            out[prefix + ".length"] = len(value)
        else:
            for i, v in enumerate(value):
                out.update(flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = value
    return out


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool) or not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return a == b
    return math.isclose(a, b, rel_tol=REL, abs_tol=ABS)


@pytest.fixture(scope="module")
def snapshots():
    data = json.loads(SNAPSHOT_FILE.read_text()) if SNAPSHOT_FILE.exists() else {}
    data.setdefault("cases", {})
    yield data
    if UPDATE:
        data["_about"] = (
            "Pinned simulator outputs for tests/simulator/test_sim_snapshots.py. Re-pin after a deliberate "
            "tuning change: UPDATE_SNAPSHOTS=1 python3 -m pytest tests/simulator/test_sim_snapshots.py"
        )
        data["cases"] = {k: data["cases"][k] for k in CASES if k in data["cases"]}
        SNAPSHOT_FILE.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")


@pytest.mark.parametrize("name", list(CASES))
def test_snapshot(name, snapshots, run_json):
    binary, args = CASES[name]
    actual = flatten(run_json(binary, args))
    if UPDATE:
        snapshots["cases"][name] = {"command": " ".join([binary, *args]), "values": actual}
        return
    pinned = snapshots["cases"].get(name)
    assert pinned is not None, (
        f"no snapshot for {name!r}; create it with UPDATE_SNAPSHOTS=1 python3 -m pytest {Path(__file__).name}")
    expected = pinned["values"]
    diffs = []
    for key, want in expected.items():
        if key not in actual:
            diffs.append(f"  {key}: pinned {want!r}, now missing from the output")
        elif not same(actual[key], want):
            diffs.append(f"  {key}: pinned {want!r}, now {actual[key]!r}")
    assert not diffs, (
        f"{name} ({binary} {' '.join(args)}) no longer matches snapshots.json:\n" + "\n".join(diffs[:60])
        + ("\n  ..." if len(diffs) > 60 else "")
        + "\nIf this change is intended (tuning, data rebuild, kit fix), re-pin with:\n"
        "  UPDATE_SNAPSHOTS=1 python3 -m pytest tests/simulator/test_sim_snapshots.py")


def test_snapshot_file_has_no_stale_cases(snapshots):
    if UPDATE:
        pytest.skip("rewriting snapshots")
    stale = sorted(set(snapshots["cases"]) - set(CASES))
    assert not stale, f"snapshots.json has cases no test runs: {stale}; re-pin to drop them"


def test_thread_count_does_not_change_results(run_sim):
    """README: results are identical however trials are split across threads."""
    _, args = CASES["mayhem_jinx_crit"]
    outs = {t: run_sim("mayhem_sim", [*args, "--threads", t], check=True).stdout for t in ("1", "3", "8")}
    assert outs["1"] == outs["3"] == outs["8"]
    _, yargs = CASES["yunara_presets"]
    youts = {t: run_sim("yunara_sim", [*yargs, "--threads", t], check=True).stdout for t in ("1", "5")}
    assert youts["1"] == youts["5"]


def test_same_seed_same_output_different_seed_differs(run_sim):
    _, args = CASES["mayhem_veigar_ap"]
    a = run_sim("mayhem_sim", args, check=True).stdout
    b = run_sim("mayhem_sim", args, check=True).stdout
    other = [*args[:-3], "--seed", "7", "--json"]
    c = run_sim("mayhem_sim", other, check=True).stdout
    assert a == b
    assert a != c
