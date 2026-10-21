"""Integrity of simulator/data/*.json (live and PBE) and the committed simulator outputs the site reads.

Pure data checks: no simulator run needed except where noted.
"""
from __future__ import annotations

import json
import math
import re

import pytest

from sim_paths import DATA_DIR, PBE_DIR, SIM_DIR, VIEWER_DIR, load_json

PATCHES = {"live": DATA_DIR, "pbe": PBE_DIR}
DATA_FILES = sorted(DATA_DIR.glob("*.json")) + sorted(PBE_DIR.glob("*.json")) + \
    sorted((VIEWER_DIR / "replay-data").glob("*.json")) + sorted((VIEWER_DIR / "replay-data/pbe").glob("*.json"))
RARITIES = {"prismatic", "gold", "silver"}


def rel(p):
    return str(p.relative_to(SIM_DIR))


def strict_load(path):
    def bad_constant(c):
        raise ValueError(f"{path}: non-standard JSON constant {c}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh, parse_constant=bad_constant)


def leaves(x, path=""):
    if isinstance(x, dict):
        for k, v in x.items():
            yield from leaves(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from leaves(v, f"{path}[{i}]")
    else:
        yield path, x


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def champions(patch):
    return load_json(PATCHES[patch] / "champions.json")["champions"]


def items(patch):
    return load_json(PATCHES[patch] / "items.json")["items"]


def augments(patch):
    return load_json(PATCHES[patch] / "augments.json")["augments"]


# ---------------------------------------------------------------- every file parses, no NaN / Infinity

@pytest.mark.parametrize("path", DATA_FILES, ids=rel)
def test_file_parses_without_nan(path):
    data = strict_load(path)  # rejects NaN / Infinity tokens
    bad = [p for p, v in leaves(data) if is_num(v) and not math.isfinite(v)]
    assert not bad, bad[:10]


# Negative numbers are legitimate only for these keys (penalties and reductions).
NEGATIVE_OK = re.compile(r"\.(ability_haste|crit_damage|damage_amp|hp_mult|ms_pct)$")


# Inputs only (outputs such as replay positions and fight-length edges are legitimately negative);
# champions.json gets its own, alt-aware check below.
INPUT_FILES = [p for p in DATA_FILES if "replay-data" not in p.parts or p.parent.name == "pbe"]


@pytest.mark.parametrize("path", [p for p in INPUT_FILES if p.name != "champions.json"], ids=rel)
def test_no_unexpected_negative_numbers(path):
    bad = [(p, v) for p, v in leaves(strict_load(path)) if is_num(v) and v < 0 and not NEGATIVE_OK.search(p)]
    assert not bad, bad[:10]


# ---------------------------------------------------------------- champions.json

@pytest.mark.parametrize("patch", PATCHES)
def test_champion_stats_are_sane(patch):
    champs = champions(patch)
    assert len(champs) >= 170
    ids = [c["id"] for c in champs]
    nums = [c["champion_id"] for c in champs]
    assert len(set(ids)) == len(ids) and len(set(nums)) == len(nums)
    problems = []
    for c in champs:
        st = c["stats"]
        for k in ("hp", "ad", "attack_speed", "move_speed", "attack_range", "attack_speed_ratio"):
            if not st.get(k, 0) > 0:
                problems.append((c["id"], k, st.get(k)))
        for k, v in st.items():
            if not (is_num(v) and math.isfinite(v) and v >= 0):
                problems.append((c["id"], k, v))
        for a in c["abilities"]:
            if a["slot"] not in "QWER" or not a.get("cooldown", 0) >= 0 or not a.get("cast_time", 0) >= 0:
                problems.append((c["id"], a["slot"], a.get("cooldown"), a.get("cast_time")))
            for g, v in a.get("geometry", {}).items():
                if is_num(v) and v < 0:
                    problems.append((c["id"], a["slot"], g, v))
            for h in a["hits"]:
                if h["type"] not in ("magic", "physical", "true"):
                    problems.append((c["id"], a["slot"], h["calc"], h["type"]))
                # Alternatives aren't counted (Lucian R's bullet count is stored as one).
                if not h["alt"] and any(v < 0 for v in h["scaling"].values()):
                    problems.append((c["id"], a["slot"], h["calc"], h["scaling"]))
        if c["mayhem"]["damage_dealt"] <= 0 or c["mayhem"]["damage_taken"] <= 0:
            problems.append((c["id"], "mayhem", c["mayhem"]))
    assert not problems, problems[:15]


@pytest.mark.parametrize("name", ["champion_overrides.json", "passives.json", "kit_passives.json", "combos.json"])
def test_hand_written_files_name_real_champions(name):
    ids = {c["id"] for c in champions("live")}
    keys = {k for k in load_json(DATA_DIR / name) if not k.startswith("_")}
    assert keys <= ids, f"{name} names champions champions.json doesn't have: {sorted(keys - ids)}"
    assert {c["id"] for c in champions("pbe")} >= keys


def test_champion_overrides_target_real_slots():
    for champ, ov in load_json(DATA_DIR / "champion_overrides.json").items():
        if champ.startswith("_"):
            continue
        assert set(ov) <= {"Q", "W", "E", "R", "death"}, (champ, set(ov))


def test_every_champion_has_a_valid_combo():
    combos = load_json(DATA_DIR / "combos.json")
    for c in champions("live"):
        combo = combos.get(c["id"])
        assert combo and re.fullmatch(r"[QWER]{1,4}", combo) and len(set(combo)) == len(combo), (c["id"], combo)


# ---------------------------------------------------------------- items and augments

@pytest.mark.parametrize("patch", PATCHES)
def test_items(patch):
    its = items(patch)
    ids = [v["id"] for v in its.values()]
    assert len(set(ids)) == len(ids)
    for k, v in its.items():
        assert v["slot"] in ("boots", "legendary", "component", "starter", "reward"), k
        assert v["name"] and v["cost"] >= 0, k
        assert all(is_num(x) and x >= 0 for x in v["stats"].values()), (k, v["stats"])
    assert sum(v["slot"] == "boots" for v in its.values()) >= 3
    # The whole Howling Abyss shop (consumables aside), so components and starters are there too.
    for key in ("sheen", "tiamat", "guardians_blade", "gluttonous", "golden_spatula"):
        assert key in its, key
    # Mayhem's shop doesn't sell the Doran's items.
    assert not [k for k in its if k.startswith("dorans_")]


def test_item_effects_match_items():
    its = items("live")
    by_id = {str(v["id"]): k for k, v in its.items()}
    eff = load_json(DATA_DIR / "item_effects.json")
    entries = {k: e for g in ("boots", "items", "components", "starters", "rewards") for k, e in eff[g].items()}
    for item_id, e in entries.items():
        assert by_id.get(item_id) == e["key"], (item_id, e["key"])
    assert set(by_id) == set(entries), "items.json and item_effects.json list different items"


@pytest.mark.parametrize("patch", PATCHES)
def test_augments(patch):
    augs = augments(patch)
    ids = [v["id"] for v in augs.values()]
    assert len(set(ids)) == len(ids)
    for k, v in augs.items():
        assert v["name"] and v["rarity"] in RARITIES, k
        modeled = bool(v.get("stats")) or bool(v.get("effects"))
        assert modeled or v.get("note"), f"{k} has no effect and no note saying why"


def test_list_json_modeled_flag_matches_data(list_json):
    augs = augments("live")
    for a in list_json["augments"]:
        d = augs[a["key"]]
        assert a["modeled"] == (bool(d.get("stats")) or bool(d.get("effects"))), a["key"]


# ---------------------------------------------------------------- augment pools

def test_augment_pools_reference_real_champions_and_augments():
    pools = load_json(DATA_DIR / "augment_pools.json")["pools"]
    champ_nums = {str(c["champion_id"]): c["id"] for c in champions("live")}
    augs = augments("live")
    assert set(pools) == set(champ_nums), (sorted(set(pools) - set(champ_nums)), sorted(set(champ_nums) - set(pools)))
    for num, pool in pools.items():
        assert len(pool) == len(set(pool)) and len(pool) >= 40, champ_nums[num]
        missing = set(pool) - set(augs)
        assert not missing, (champ_nums[num], sorted(missing))


# ---------------------------------------------------------------- builds reference real ids

def check_build(where, build, item_keys, aug_keys, sizes=None):
    bad_items = [i for i in build["items"] if i not in item_keys]
    bad_augs = [a for a in build["augments"] if a not in aug_keys]
    assert not bad_items and not bad_augs, (where, bad_items, bad_augs)
    if sizes:
        assert (len(build["items"]), len(build["augments"])) == sizes, (where, build)


def test_enemy_pool_builds_live():
    pool = load_json(DATA_DIR / "cn_enemy_pool.json")
    nums = {c["champion_id"] for c in champions("live")}
    its, augs = set(items("live")), set(augments("live"))
    for e in pool["enemies"]:
        assert e["champion_id"] in nums, e["id"]
        assert e["weight"] > 0 and e["hp"] > 0, e["id"]
        check_build(e["id"], e["build"], its, augs, (6, 4))


def test_enemy_pool_builds_pbe():
    """Pool builds come from live games; gear the PBE patch removed is left out of them there (not an error)."""
    pool = load_json(DATA_DIR / "cn_enemy_pool.json")
    live = set(items("live")) | set(augments("live"))
    its, augs = set(items("pbe")), set(augments("pbe"))
    for e in pool["enemies"]:
        missing = [k for k in e["build"]["items"] if k not in its] + [k for k in e["build"]["augments"] if k not in augs]
        assert all(k in live for k in missing), (e["id"], missing)
    assert "" not in augs


def test_yunara_presets_reference_its_items_and_augments():
    data = load_json(DATA_DIR / "yunara_mayhem.json")
    for key, b in data["builds"].items():
        check_build(key, b, set(data["items"]), set(data["augments"]))
        assert len(b["items"]) == 6 and len(b["augments"]) <= 4, key


def test_best_builds_reference_real_ids():
    """viewer/replay-data/best-builds.json is read by the site (Simulator page, Build Editor, compare, highlights)."""
    best = load_json(VIEWER_DIR / "replay-data/best-builds.json")["champions"]
    champ_by_id = {c["id"]: c for c in champions("live")}
    pools = load_json(DATA_DIR / "augment_pools.json")["pools"]
    its, augs = set(items("live")), set(augments("live"))
    assert {b["champion"] for b in best} == set(champ_by_id)
    for b in best:
        check_build(b["champion"], b["build"], its, augs, (6, 4))
        pool = set(pools[str(champ_by_id[b["champion"]]["champion_id"])])
        assert set(b["build"]["augments"]) <= pool, (b["champion"], set(b["build"]["augments"]) - pool)


def test_dummy_dps_covers_every_best_build():
    """viewer/replay-data/dummy-dps.json ranks the home page's "Most simulated damage": every champion
    with a best build, highest first, on the half-Health dummy (tools/build_dummy_dps.py)."""
    dummy = load_json(VIEWER_DIR / "replay-data/dummy-dps.json")
    best = load_json(VIEWER_DIR / "replay-data/best-builds.json")["champions"]
    rows = dummy["champions"]
    assert dummy["dummy_hp"] == 0.5
    assert {r["champion"] for r in rows} == {b["champion"] for b in best}
    assert all(r["dps"] > 0 for r in rows)
    assert [r["dps"] for r in rows] == sorted((r["dps"] for r in rows), reverse=True)


def test_replay_traces_and_fight_length_name_real_champions():
    ids = {c["id"] for c in champions("live")}
    traces = load_json(VIEWER_DIR / "replay-data/traces.json")
    assert set(traces) == ids
    its, augs = set(items("live")), set(augments("live"))
    for champ, tr in traces.items():
        check_build(champ, {"items": [i["key"] for i in tr["build"]["items"]],
                            "augments": [a["key"] for a in tr["build"]["augments"]]}, its, augs)
    fl = load_json(VIEWER_DIR / "replay-data/fight-length.json")["champions"]
    assert {f["champion"] for f in fl} <= ids


def test_tuned_patch_is_a_version():
    assert re.fullmatch(r"\d+\.\d+", (DATA_DIR / "tuned_patch.txt").read_text().strip())


def test_mayhem_rules_probabilities_in_range():
    model = load_json(DATA_DIR / "mayhem_rules.json")["model"]
    for k in ("dodge_chance", "enemy_hit_chance", "aim_lead", "enemy_ability_share", "enemy_ability_share_marksman"):
        assert 0 <= model[k] <= 1, (k, model[k])
