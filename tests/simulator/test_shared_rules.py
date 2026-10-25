"""The simulator reads the same mode rules and per-champion Mayhem modifiers as the guide:
guide/mode_rules.json and data/wiki/mayhem_modifiers.json are the one source."""
from __future__ import annotations

import importlib.util
import re

import pytest

from sim_paths import DATA_DIR, PBE_DIR, REPO, SIM_DIR, load_json


def _tool(name):
    spec = importlib.util.spec_from_file_location(name, SIM_DIR / "tools" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mode_rules_match_guide():
    sync = _tool("sync_mode_rules")
    stale = sync.stale(load_json(DATA_DIR / "mayhem_rules.json"), load_json(REPO / "guide" / "mode_rules.json"))
    assert not stale, f"run python3 simulator/tools/sync_mode_rules.py: {stale}"


@pytest.mark.parametrize("data_dir", [DATA_DIR, PBE_DIR], ids=["live", "pbe"])
def test_champion_modifiers_match_wiki_file(data_dir):
    src = load_json(REPO / "data" / "wiki" / "mayhem_modifiers.json")["champions"]
    norm = lambda s: re.sub(r"[^a-z]", "", s.lower())  # noqa: E731
    wiki = {norm(k): v.get("mayhem") or {} for k, v in src.items()}
    bad = []
    for c in load_json(data_dir / "champions.json")["champions"]:
        m = wiki.get(norm(c["name"]), wiki.get(norm(c["id"]), {}))
        want = {"damage_dealt": 1 + m.get("damage_dealt", 0), "damage_taken": 1 + m.get("damage_taken", 0),
                "healing": 1 + m.get("healing", 0), "shielding": 1 + m.get("shielding", 0),
                "tenacity": m.get("tenacity", 0), "ability_haste": m.get("ability_haste", 0),
                "attack_speed": m.get("attack_speed", 0)}
        have = c.get("mayhem") or {}
        bad += [f"{c['id']} {k}: {have.get(k)} != {v}" for k, v in want.items() if abs(have.get(k, -99) - v) > 1e-6]
    assert not bad, bad
