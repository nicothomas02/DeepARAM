"""Dashboard MCP server (tools/mcp/dashboard_mcp.py): the tool functions called directly, offline, without
starting a server. The `mcp` package is only needed by the last test, which is skipped when it is missing."""
import importlib.util
import json
import os
import sys

import pytest

from deeparam_data_helpers import REPO, load_json, walk_numbers

MCP_DIR = os.path.join(REPO, "tools", "mcp")
sys.path.insert(0, MCP_DIR)
import dashboard_mcp as mcp_tools  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_cache():
    mcp_tools.clear_cache()
    yield
    mcp_tools.clear_cache()


def _assert_compact_json(obj, max_bytes=60_000):
    text = json.dumps(obj, ensure_ascii=False)
    assert len(text.encode("utf-8")) <= max_bytes, f"tool output is {len(text)} chars"
    for path, n in walk_numbers(obj):
        assert n == n and abs(n) != float("inf"), path  # finite


# --- name matching --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("query, expected", [
    ("Teemo", "Teemo"), ("teemo", "Teemo"), ("teeemo", "Teemo"), ("17", "Teemo"),
    ("Kai Sa", "Kai'Sa"), ("kaisa", "Kai'Sa"), ("master yi", "Master Yi"), ("MasterYi", "Master Yi"),
    ("Jhinn", "Jhin"), ("twisted", "Twisted Fate"), ("nunu", "Nunu & Willump"), ("lee", "Lee Sin"),
])
def test_find_champion_matches(query, expected):
    rec, _ = mcp_tools.find_champion(query)
    assert rec and rec["name"] == expected
    assert rec["id"] < 10000, "must resolve to the real champion, not a mode variant (Jade_*)"


def test_find_champion_unknown_and_ambiguous():
    rec, suggestions = mcp_tools.find_champion("xyzzy")
    assert rec is None and suggestions == []
    rec, suggestions = mcp_tools.find_champion("ka")
    assert rec is None
    assert {"Kayle", "Karma", "Katarina"} <= set(suggestions)
    assert mcp_tools.find_champion("") == (None, [])


def test_find_champion_covers_every_mayhem_champion():
    for c in load_json("data/cn/builds/index.json")["champions"]:
        rec, _ = mcp_tools.find_champion(c["name"])
        assert rec and rec["id"] == c["id"], c


@pytest.mark.parametrize("query, expected", [
    ("Blunt Force", "Blunt Force"), ("blunt", "Blunt Force"), ("ARAM_BluntForce", "Blunt Force"),
    ("1007", "Blunt Force"), ("bees", "BEES!!!"), ("apex", "Apex Inventor"),
])
def test_find_augment_matches(query, expected):
    rec, _ = mcp_tools.find_augment(query)
    assert rec and rec["name"] == expected


def test_find_augment_unknown():
    assert mcp_tools.find_augment("zz") == (None, [])


# --- tools ----------------------------------------------------------------------------------------------------

def test_champion_stats():
    out = mcp_tools.champion_stats("teemo")
    assert out["champion"] == "Teemo" and out["id"] == 17
    assert 0 < out["win_rate"] < 100 and 0 < out["pick_rate"] < 100
    assert 0 < out["damage_share"] < 100
    assert out["meta"]["stat_date"].count("-") == 2
    assert out["best_partners"] and all(p["champion"] and not p["champion"].startswith("#") for p in out["best_partners"])
    assert out["most_picked_augments"] and not any(a.startswith("#") for a in out["most_picked_augments"])
    assert "simulator" in out and out["simulator"]["mean_dps"] > 0
    _assert_compact_json(out)


def test_champion_stats_unknown_is_graceful():
    out = mcp_tools.champion_stats("not a champion")
    assert "error" in out and "suggestions" in out
    out = mcp_tools.champion_stats("ka")
    assert "error" in out and "Kayle" in out["suggestions"]


def test_champion_stats_matches_source_file():
    row = next(r for r in load_json("data/cn/champions.json")["champions"] if r["champion_id"] == 17)
    out = mcp_tools.champion_stats("Teemo")
    assert out["win_rate"] == round(100 * row["win_rate"], 1)
    assert out["rank"] == row["rank"]


def test_tier_list_default_and_role():
    out = mcp_tools.tier_list()
    assert out["metric"] == "win_rate" and len(out["champions"]) == 10
    rates = [c["win_rate"] for c in out["champions"]]
    assert rates == sorted(rates, reverse=True)
    assert out["count"] == len(load_json("data/cn/champions.json")["champions"])

    mages = mcp_tools.tier_list(role="Mage", metric="damage_share", top=5)
    assert mages["role"] == "mage" and 0 < len(mages["champions"]) <= 5
    for c in mages["champions"]:
        assert "mage" in mcp_tools.find_champion(c["champion"])[0]["roles"]
    shares = [c["damage_share"] for c in mages["champions"]]
    assert shares == sorted(shares, reverse=True)

    worst = mcp_tools.tier_list(top=3, ascending=True)
    assert worst["champions"][0]["win_rate"] <= out["champions"][-1]["win_rate"]


def test_tier_list_bad_inputs():
    assert "error" in mcp_tools.tier_list(metric="nope") and "metrics" in mcp_tools.tier_list(metric="nope")
    assert "error" in mcp_tools.tier_list(role="jungler")
    assert len(mcp_tools.tier_list(top=0)["champions"]) == 1
    assert len(mcp_tools.tier_list(top=10_000)["champions"]) == mcp_tools.tier_list()["count"]


def test_best_build():
    out = mcp_tools.best_build("Teemo")
    assert out["champion"] == "Teemo" and out["date"]
    for group in ("starting", "boots", "core", "full_builds"):
        assert out[group], group
        for entry in out[group]:
            assert entry["items"] and not any(i.startswith("#") for i in entry["items"]), (group, entry)
            assert 0 <= entry["pick_rate"] <= 100
    assert len(out["core"][0]["items"]) == 3
    assert len(out["full_builds"][0]["items"]) == 6
    assert out["skill_order"][0]["max"] in {"QWE", "QEW", "WQE", "WEQ", "EQW", "EWQ"}
    assert set(out["augments"]) == {"prismatic", "gold", "silver"}
    assert out["augments"]["prismatic"][0]["grade"] in {"S", "A", "B"}
    assert out["partners"] and out["partners"][0]["win_rate"] > 0
    assert out["simulator_best"]["items"] and out["simulator_best"]["augments"]
    _assert_compact_json(out)


def test_best_build_unknown():
    assert "error" in mcp_tools.best_build("zzz")


def test_augment_stats():
    out = mcp_tools.augment_stats("blunt force")
    assert out["augment"] == "Blunt Force" and out["id"] == 1007 and out["tier"] in ("Silver", "Gold", "Prismatic")
    assert 0 < out["win_rate"] < 100 and out["win_rank"] >= 1
    assert out["best_champions"] and not any(c.startswith("#") for c in out["best_champions"])
    assert "error" in mcp_tools.augment_stats("definitely not an augment")


def test_best_duos():
    out = mcp_tools.best_duos(top=5)
    assert len(out["duos"]) == 5
    rates = [d["win_rate"] for d in out["duos"]]
    assert rates == sorted(rates, reverse=True)
    assert all(len(d["champions"]) == 2 for d in out["duos"])

    teemo = mcp_tools.best_duos("teemo", top=3)
    assert teemo["champion"] == "Teemo" and teemo["count"] > 0
    assert all("Teemo" in d["champions"] for d in teemo["duos"])
    assert "error" in mcp_tools.best_duos("zzz")


def test_champion_trend():
    out = mcp_tools.champion_trend("Teemo", patches=3)
    assert out["champion"] == "Teemo" and 1 <= len(out["patches"]) <= 3
    assert out["patches"][-1]["live"] is True
    assert isinstance(out["win_rate_change"], float)
    assert "error" in mcp_tools.champion_trend("zzz")


def test_patch_changes_pbe():
    out = mcp_tools.patch_changes()
    tracker = load_json("data/pbe/tracker.json")
    assert out["source"] == "pbe" and out["pbe_build"] == tracker["builds"]["pbe"]
    assert len(out["entries"]) == len(tracker["entries"])
    assert all(isinstance(ln, str) for e in out["entries"] for ln in e["lines"])
    first = tracker["entries"][0]["name"]
    only = mcp_tools.patch_changes(champion=first)
    assert only["entries"] and all(e["name"] == first for e in only["entries"])
    _assert_compact_json(out)


def test_patch_changes_live():
    notes = load_json("data/official/patch_notes.json")
    out = mcp_tools.patch_changes(source="live")
    assert len(out["patches"]) == 1 and out["patches"][0]["patch"] == notes["patches"][0]["patch"]
    everything = mcp_tools.patch_changes(latest=False, source="live")
    assert len(everything["patches"]) == len(notes["patches"])
    name = next(c["name"] for p in notes["patches"] for c in p.get("champions", []))
    filtered = mcp_tools.patch_changes(latest=False, source="live", champion=name)
    assert filtered["patches"] and all(c["name"] == name for p in filtered["patches"] for c in p["champions"])
    assert "error" in mcp_tools.patch_changes(source="pbf")
    assert "error" in mcp_tools.patch_changes(champion="zzz")


def test_project_status_orders_todos_quickest_then_most_important(tmp_path, monkeypatch):
    todos = {"todos": [
        {"id": "a", "title": "slow important", "minutes": 120, "importance": 5},
        {"id": "b", "title": "quick low", "minutes": 5, "importance": 1},
        {"id": "c", "title": "quick high", "minutes": 5, "importance": 4, "due": "2999-01-01"},
        {"id": "d", "title": "done", "minutes": 1, "importance": 5, "done": True},
    ]}
    path = tmp_path / "todos.json"
    path.write_text(json.dumps(todos), encoding="utf-8")
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", str(path))
    out = mcp_tools.project_status(commits=2)
    assert [t["id"] for t in out["todos"]] == ["c", "b", "a"]
    assert out["open_count"] == 3 and out["todos"][0]["days_left"] > 0
    assert [t["id"] for t in mcp_tools.project_status(include_done=True)["todos"]] == ["d", "c", "b", "a"]
    assert len(out["recent_commits"]) <= 2
    assert out["data"]["mayhem_stats"] and out["data"]["pbe_tracker"]
    assert "todos_error" not in out


def test_project_status_with_shipped_todos_and_missing_file(monkeypatch):
    out = mcp_tools.project_status()
    assert out["open_count"] >= 1
    minutes = [t["minutes"] for t in out["todos"]]
    assert minutes == sorted(minutes)
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", os.path.join(MCP_DIR, "does-not-exist.json"))
    out = mcp_tools.project_status()
    assert out["todos"] == [] and "todos_error" in out


def test_every_tool_is_json_serialisable_and_compact():
    calls = [
        (mcp_tools.champion_stats, ("Jhin",)), (mcp_tools.tier_list, ()), (mcp_tools.best_build, ("Jhin",)),
        (mcp_tools.augment_stats, ("bees",)), (mcp_tools.best_duos, ()), (mcp_tools.champion_trend, ("Jhin",)),
        (mcp_tools.patch_changes, ()), (mcp_tools.project_status, ()),
    ]
    assert [fn for fn, _ in calls] == list(mcp_tools.TOOLS)
    for fn, args in calls:
        out = fn(*args)
        assert isinstance(out, dict) and "error" not in out, fn.__name__
        _assert_compact_json(out)


def test_cli_call_prints_json():
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(MCP_DIR, "dashboard_mcp.py"), "--call", "champion_stats", "Teemo"],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["champion"] == "Teemo"
    r = subprocess.run([sys.executable, os.path.join(MCP_DIR, "dashboard_mcp.py"), "--call", "nope"],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 2 and "tools:" in r.stderr


@pytest.mark.skipif(importlib.util.find_spec("mcp") is None, reason="mcp package not installed")
def test_server_registers_every_tool():
    import asyncio
    server = mcp_tools.build_server()
    names = {t.name for t in asyncio.run(server.list_tools())}
    assert names == {fn.__name__ for fn in mcp_tools.TOOLS}
