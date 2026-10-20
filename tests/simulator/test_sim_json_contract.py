"""The JSON the website and the replay viewer read from the simulator.

Consumers (keep in sync when they change):
- web/src/components/BuildEditor.tsx: `--list --json` (SimList: champions{id,name,role,augments},
  items/augments{key,name,slot,rarity,roles}) and `--champ X --json` builds[0].summary
  {mean_dps, ci95, time_alive, survival_rate, share_by_source}.
- simulator/viewer/sim-panel.js: `--list --json` champions{id,combo,augments}, enemies{id,weight,
  items,augments,hp,armor,mr,damage_share}, settings{key,default} (the setting keys it lays out),
  `--champ X --json --trace FILE` builds[].build/summary and the trace's build/fight.team/summary.
- simulator/viewer/team.js: the 5v5 output {win_rate, fight_length, team_dps, enemy_dps,
  members/enemies[{champion,name,share,time_alive,survival,build,summary.mean_dps}], timeline[{t,side}]}.
"""
from __future__ import annotations

import math
import re

import pytest

from sim_paths import DATA_DIR, VIEWER_DIR, load_json

SUMMARY_KEYS = {"mean_dps", "ci95", "p5", "median", "p95", "single_target_dps", "kills_per_minute", "survival_rate",
                "time_alive", "damage_taken_per_s", "dps_short_fight", "dps_long_fight", "share_by_source"}


def finite_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def viewer_setting_keys():
    """Setting keys sim-panel.js lays out by name (BASIC_KEYS, DUMMY_KEYS, WHOLE_KEYS, ADVANCED, team_size)."""
    src = (VIEWER_DIR / "sim-panel.js").read_text()
    keys = {"team_size"}
    for name in ("DUMMY_KEYS", "BASIC_KEYS", "WHOLE_KEYS", "ADVANCED"):
        m = re.search(rf"const {name} = (\[.*?\]);", src, re.S)
        assert m, f"sim-panel.js no longer declares {name}; update this test"
        keys |= {k for k in re.findall(r'"([^"]+)"', m.group(1)) if re.fullmatch(r"[a-z_]+", k)}
    return keys


def check_summary(s):
    assert SUMMARY_KEYS <= set(s), SUMMARY_KEYS - set(s)
    for k in SUMMARY_KEYS - {"share_by_source"}:
        assert finite_number(s[k]) and s[k] >= 0, (k, s[k])
    assert 0 <= s["survival_rate"] <= 1
    assert s["p5"] <= s["median"] <= s["p95"]
    shares = s["share_by_source"]
    assert shares and all(finite_number(v) and 0 <= v <= 1 for v in shares.values()), shares
    if s["mean_dps"] > 0:
        assert sum(shares.values()) == pytest.approx(1.0, abs=0.01)


# ---------------------------------------------------------------- --list --json

def test_list_top_level(list_json):
    assert set(list_json) >= {"champions", "items", "augments", "settings", "enemies"}


def test_list_champions(list_json, live_data):
    champs = list_json["champions"]
    aug_keys = {a["key"] for a in list_json["augments"]}
    ids = [c["id"] for c in champs]
    assert len(ids) == len(set(ids)) == len(live_data["champions"])
    assert {"Hwei", "Yunara", "Jinx", "Veigar", "Malphite", "Lux"} <= set(ids)
    pools = load_json(DATA_DIR / "augment_pools.json")["pools"]
    for c in champs:
        assert isinstance(c["id"], str) and isinstance(c["name"], str) and c["name"]
        assert isinstance(c["key"], int) and isinstance(c["ranged"], bool) and isinstance(c["role"], str)
        assert re.fullmatch(r"[QWER]{0,4}", c["combo"]) and len(set(c["combo"])) == len(c["combo"]), c["combo"]
        assert isinstance(c["augments"], list) and c["augments"], c["id"]
        assert set(c["augments"]) <= aug_keys, (c["id"], set(c["augments"]) - aug_keys)
        assert set(c["augments"]) == set(pools[str(c["key"])]) & aug_keys, c["id"]


def test_list_items_and_augments(list_json, live_data):
    items, augs = list_json["items"], list_json["augments"]
    assert {i["key"] for i in items} == set(live_data["items"])
    assert {a["key"] for a in augs} == set(live_data["augments"])
    for entry in items + augs:
        assert set(entry) >= {"key", "name", "slot", "rarity", "roles"}, entry
        assert entry["name"] and isinstance(entry["roles"], list) and isinstance(entry["rarity"], str)
    assert {i["slot"] for i in items} >= {"boots", "legendary"}
    assert {a["rarity"] for a in augs} <= {"prismatic", "gold", "silver"}
    assert len([k for k in (i["key"] for i in items)]) == len({i["key"] for i in items})


def test_list_settings(list_json):
    settings = list_json["settings"]
    keys = [s["key"] for s in settings]
    assert len(keys) == len(set(keys))
    for s in settings:
        assert finite_number(s["default"]) and isinstance(s["description"], str) and s["description"], s
    missing = viewer_setting_keys() - set(keys)
    assert not missing, f"sim-panel.js lays out settings the engine no longer lists: {sorted(missing)}"


def test_list_settings_defaults_round_trip(list_json, run_sim):
    """The page sends changed settings back with --set; every listed default must be accepted and change nothing."""
    pairs = ",".join(f"{s['key']}={s['default']:g}" for s in list_json["settings"])
    base = ["--champ", "Ahri", "--items", "sorcerers,ludens", "--trials", "100", "--seed", "9", "--json"]
    plain = run_sim("mayhem_sim", base, check=True).stdout
    with_defaults = run_sim("mayhem_sim", [*base, "--set", pairs], check=True).stdout
    assert plain == with_defaults


def test_list_enemies(list_json, live_data):
    enemies = list_json["enemies"]
    champ_ids = {c["id"].lower() for c in live_data["champions"]}
    ids = [e["id"] for e in enemies]
    assert len(ids) == len(set(ids)) and len(ids) > 100
    for e in enemies:
        assert e["id"].lower() in champ_ids, e["id"]
        for k in ("weight", "hp", "armor", "mr", "damage_share"):
            assert finite_number(e[k]) and e[k] >= 0, (e["id"], k, e[k])
        assert e["weight"] > 0 and e["hp"] > 0
        assert len(e["items"]) == 6 and set(e["items"]) <= set(live_data["items"]), e["id"]
        assert len(e["augments"]) == 4 and set(e["augments"]) <= set(live_data["augments"]), e["id"]


# ---------------------------------------------------------------- --champ --json

def test_fixed_build_json(run_json):
    out = run_json("mayhem_sim", ["--champ", "Jinx", "--items", "berserkers,infinity_edge", "--augs", "deft",
                                  "--trials", "200", "--seed", "1", "--json"])
    assert out["champion"] == "Jinx" and len(out["builds"]) == 1
    b = out["builds"][0]
    assert b["build"] == {"items": ["berserkers", "infinity_edge"], "augments": ["deft"]}
    check_summary(b["summary"])


def test_optimizer_json(run_json, list_json):
    out = run_json("mayhem_sim", ["--champ", "Ahri", "--trials", "100", "--seed", "20261017", "--json"])
    ahri = next(c for c in list_json["champions"] if c["id"] == "Ahri")
    boots = {i["key"] for i in list_json["items"] if i["slot"] == "boots"}
    assert len(out["builds"]) >= 2
    dps = [b["summary"]["mean_dps"] for b in out["builds"]]
    assert dps == sorted(dps, reverse=True), "builds are ranked best first"
    for b in out["builds"]:
        check_summary(b["summary"])
        items, augs = b["build"]["items"], b["build"]["augments"]
        assert len(items) == 6 and len(set(items)) == 6 and sum(i in boots for i in items) == 1, items
        assert len(augs) == 4 and len(set(augs)) == 4 and set(augs) <= set(ahri["augments"]), augs


def test_trace_json(run_sim, tmp_path):
    path = tmp_path / "trace.json"
    run_sim("mayhem_sim", ["--champ", "Lux", "--items", "sorcerers,ludens", "--augs", "marksmage", "--trials", "200",
                           "--seed", "1", "--json", "--trace", path], check=True)
    tr = load_json(path)
    assert tr["champion"] == "Lux"
    assert [i["key"] for i in tr["build"]["items"]] == ["sorcerers", "ludens"]
    assert all({"key", "id", "name"} <= set(i) for i in tr["build"]["items"])
    assert [a["key"] for a in tr["build"]["augments"]] == ["marksmage"]
    check_summary(tr["summary"])
    team = tr["fight"]["team"]
    assert isinstance(team, list) and team and all(isinstance(t, str) for t in team)
    events = tr["events"]
    assert events and events[-1]["k"] == "end"
    times = [e["t"] for e in events]
    assert times == sorted(times)


# ---------------------------------------------------------------- Teamfight and 2v2 (team.js)

def test_team_json(run_json):
    out = run_json("mayhem_sim", ["--champ", "Jinx", "--allies", "Lulu,Leona,Ahri,Darius", "--trials", "100",
                                  "--seed", "1", "--json"])
    assert out["mode"] == "team" and out["trials"] == 100
    assert 0 <= out["win_rate"] <= 1
    for k in ("fight_length", "team_dps", "enemy_dps"):
        assert finite_number(out[k]) and out[k] > 0, k
    assert len(out["members"]) == 5 and len(out["enemies"]) == 5
    assert out["members"][0]["champion"] == "Jinx"
    assert {m["champion"] for m in out["members"]}.isdisjoint({m["champion"] for m in out["enemies"]})
    for side in ("members", "enemies"):
        assert sum(m["share"] for m in out[side]) == pytest.approx(1.0, abs=0.01)
        for m in out[side]:
            assert set(m) >= {"champion", "name", "share", "time_alive", "survival", "build", "summary"}
            assert 0 <= m["survival"] <= 1 and m["time_alive"] >= 0
            assert len(m["build"]["items"]) > 0
            check_summary(m["summary"])
    assert out["timeline"] and all(e["side"] in ("ally", "enemy") and finite_number(e["t"]) for e in out["timeline"])


@pytest.mark.parametrize("allies,foes", [("", "Ahri"), ("", "Ahri,Garen,Lux"), ("Lulu", "Ahri,Garen"), ("Lulu,Leona,Darius,Lux", "Ahri")])
def test_team_json_any_sizes(run_json, allies, foes):
    """The Teamfight tab lets each side have 1 to 5 champions ("" = no allies, just you)."""
    out = run_json("mayhem_sim", ["--champ", "Jinx", "--allies", allies, "--team", foes, "--trials", "40", "--seed", "1", "--json"])
    assert out["mode"] == "team" and out["trials"] == 40
    assert len(out["members"]) == 1 + len([a for a in allies.split(",") if a]) and len(out["enemies"]) == len(foes.split(","))
    assert 0 <= out["win_rate"] <= 1 and out["fight_length"] > 0


# ---------------------------------------------------------------- yunara_sim --json

def test_yunara_json(run_json):
    data = load_json(DATA_DIR / "yunara_mayhem.json")
    out = run_json("yunara_sim", ["--trials", "200", "--seed", "1", "--json"])
    assert out["trials"] == 200 and out["seed"] == 1 and out["level"] == 18
    assert sorted(b["id"] for b in out["builds"]) == sorted(data["builds"])
    dps = [b["dps"] for b in out["builds"]]
    assert dps == sorted(dps, reverse=True), "builds are ranked best first"
    for b in out["builds"]:
        for k in ("dps", "ci95", "p5", "median", "p95", "single_target_dps", "survival_rate", "time_alive"):
            assert finite_number(b[k]) and b[k] >= 0, (b["id"], k)
        assert sum(b["share"].values()) == pytest.approx(1.0, abs=0.01)
