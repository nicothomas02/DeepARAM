"""Bad input gives a non-zero exit and an error message, not a crash (SIGABRT / uncaught exception) or a hang.

Every run has a timeout (conftest.RUN_TIMEOUT); a hang fails the test. Cases that crash today
were fixed in the Simulator thread's bad-input PR.
"""
from __future__ import annotations

import pytest

FAST = ["--trials", "20", "--seed", "1"]
JINX = ["--champ", "Jinx", "--items", "berserkers"]



def assert_clean_error(proc, needle=None):
    assert proc.returncode > 0, f"exit {proc.returncode} (negative = killed by a signal); stderr: {proc.stderr[-500:]}"
    assert proc.returncode != 134, "aborted"
    assert "terminate called" not in proc.stderr and "Aborted" not in proc.stderr, proc.stderr[-500:]
    assert proc.stderr.strip(), "no error message"
    if needle:
        assert needle.lower() in proc.stderr.lower(), proc.stderr[-500:]


MAYHEM_BAD = {
    "unknown-option": (["--bogus"], "unknown option"),
    "bad-search": ([*JINX, "--search", "fast", *FAST], "--search must be"),
    "unknown-champion": (["--champ", "NotAChamp", *FAST], "unknown champion"),
    "kit-unknown-champion": (["--kit", "NotAChamp"], "unknown champion"),
    "missing-value": (["--champ"], "needs a value"),
    "unknown-item": ([*JINX[:2], "--items", "nope", *FAST], "unknown item"),
    "unknown-augment": ([*JINX, "--augs", "nope", *FAST], "unknown augment"),
    "unknown-setting": ([*JINX, "--set", "nosuch=1", *FAST], "unknown setting"),
    "setting-not-number": ([*JINX, "--set", "level=abc", *FAST], "not a number"),
    "setting-overflow": ([*JINX, "--set", "level=1e400", *FAST], "not a number"),
    "setting-no-equals": ([*JINX, "--set", "level", *FAST], "key=value"),
    "bad-combo": ([*JINX, "--combo", "XYZ", *FAST], "combo"),
    "repeated-combo": ([*JINX, "--combo", "QQWE", *FAST], "combo"),
    "enemy-not-in-pool": ([*JINX, "--team", "NotAChamp", *FAST], "not in the enemy pool"),
    "enemy-is-self": ([*JINX, "--team", "Jinx", *FAST], "not in the enemy pool"),
    "enemy-bad-stat": ([*JINX, "--team", "Malphite:bogus=3", *FAST], "unknown enemy stat"),
    "enemy-stat-not-number": ([*JINX, "--team", "Malphite:hp=abc", *FAST], "error"),
    "ally-unknown": (["--champ", "Jinx", "--allies", "NotAChamp", *FAST], "unknown champion"),
    "ally-also-enemy": (["--champ", "Jinx", "--allies", "Lulu,Leona,Ahri,Darius", "--team", "Lulu", *FAST], "both teams"),
    "missing-game-data": (["--list", "--json", "--game-data", "/nonexistent-dir"], "cannot open"),
    "missing-rules": (["--list", "--rules", "/nonexistent.json"], "cannot open"),
    "unwritable-trace": ([*JINX, *FAST, "--trace", "/nonexistent-dir/t.json"], "cannot write"),
}


@pytest.mark.parametrize("name", list(MAYHEM_BAD))
def test_mayhem_sim_bad_input(run_sim, name):
    args, needle = MAYHEM_BAD[name]
    assert_clean_error(run_sim("mayhem_sim", args, timeout=30), needle)


def test_mayhem_sim_corrupt_data_files(run_sim, tmp_path):
    (tmp_path / "rules.json").write_text('{"rules": ')
    assert_clean_error(run_sim("mayhem_sim", ["--list", "--rules", tmp_path / "rules.json"], timeout=30), "parse error")
    gd = tmp_path / "gd"
    gd.mkdir()
    for n in ("items", "augments"):
        (gd / f"{n}.json").write_text('{"items": {}, "augments": {}}')
    (gd / "champions.json").write_text("{not json")
    assert_clean_error(run_sim("mayhem_sim", ["--list", "--json", "--game-data", gd], timeout=30), "parse error")


@pytest.mark.parametrize("args", [
    ["--champ", "Jinx", "--items", "berserkers", "--trials", "abc"],
    ["--champ", "Jinx", "--items", "berserkers", "--trials", "99999999999"],
    ["--champ", "Jinx", "--items", "berserkers", "--seed", "xyz"],
    ["--champ", "Jinx", "--items", "berserkers", "--threads", "abc"],
], ids=["trials-abc", "trials-overflow", "seed-xyz", "threads-abc"])
def test_mayhem_sim_non_numeric_flags(run_sim, args):
    assert_clean_error(run_sim("mayhem_sim", args, timeout=30))


YUNARA_BAD = {
    "unknown-option": (["--bogus"], "unknown option"),
    "unknown-build": (["--builds", "nosuch", *FAST], "unknown build"),
    "missing-value": (["--items"], "needs a value"),
    "target-arity": (["--target", "1,2", *FAST], "3 comma-separated"),
    "clump-arity": (["--clump", "4", *FAST], "2 comma-separated"),
    "missing-data": (["--data", "/nonexistent.json"], "could not read"),
    "missing-enemies": (["--enemies", "/nonexistent.json"], "could not read"),
}


@pytest.mark.parametrize("name", list(YUNARA_BAD))
def test_yunara_sim_bad_input(run_sim, name):
    args, needle = YUNARA_BAD[name]
    assert_clean_error(run_sim("yunara_sim", args, timeout=30), needle)


def test_yunara_sim_corrupt_data_file(run_sim, tmp_path):
    (tmp_path / "bad.json").write_text('{"meta": ')
    assert_clean_error(run_sim("yunara_sim", ["--data", tmp_path / "bad.json"], timeout=30), "bad data file")


@pytest.mark.parametrize("args", [
    ["--trials", "abc"], ["--seed", "abc"], ["--level", "abc"], ["--fight", "abc"], ["--target", "a,b,c"],
    ["--items", "nope", *FAST],
], ids=["trials", "seed", "level", "fight", "target", "unknown-item"])
def test_yunara_sim_bad_values(run_sim, args):
    assert_clean_error(run_sim("yunara_sim", args, timeout=30))


# ---------------------------------------------------------------- edge values that should still run

@pytest.mark.parametrize("args", [
    [*JINX, "--set", "level=1"],
    [*JINX, "--set", "fight_mean=1e6,until_death=0"],  # a very long fight still ends (fight_cap / fight_max)
    [*JINX, "--set", "enemy_damage_scale=0"],
    [*JINX, "--set", "team_size=5"],
    ["--champ", "Jinx", "--items", ""],  # no items
    ["--champ", "Jinx", "--items", "berserkers", "--team", "Malphite:hp=1"],
    ["--champ", "Jinx", "--items", "berserkers", "--threads", "1"],
], ids=["level1", "long-fight", "no-enemy-damage", "five-enemies", "no-items", "one-hp-enemy", "one-thread"])
def test_mayhem_sim_edge_values_run(run_json, args):
    out = run_json("mayhem_sim", [*args, "--trials", "50", "--seed", "1", "--json"])
    s = out["builds"][0]["summary"]
    assert s["mean_dps"] >= 0 and s["time_alive"] >= 0


def test_mayhem_sim_help_and_list(run_sim):
    for args in (["--help"], ["--list"]):
        proc = run_sim("mayhem_sim", args, timeout=30)
        assert proc.returncode == 0 and proc.stdout.strip(), args
    assert "--champ" in run_sim("mayhem_sim", ["--help"]).stdout
    proc = run_sim("yunara_sim", ["--help"], timeout=30)
    assert proc.returncode == 0 and "--items" in proc.stdout
    proc = run_sim("yunara_sim", ["--list"], timeout=30)
    assert proc.returncode == 0 and "stormrazor" in proc.stdout
