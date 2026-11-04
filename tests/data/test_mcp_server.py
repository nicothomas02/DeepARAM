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
        (mcp_tools.patch_changes, ()), (mcp_tools.search, ("teemo",)), (mcp_tools.project_status, ()),
        (mcp_tools.desk_todos, ()), (mcp_tools.add_todo, ("x", 1)), (mcp_tools.complete_todo, ("x",)),
    ]
    assert [fn for fn, _ in calls] == list(mcp_tools.TOOLS)
    for fn, args in calls:
        if fn in (mcp_tools.add_todo, mcp_tools.complete_todo):
            continue  # exercised against a temp file in the to-do tests below
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


# --- to-dos ---------------------------------------------------------------------------------------------------

@pytest.fixture
def todo_file(tmp_path, monkeypatch):
    path = tmp_path / "todos.json"
    path.write_text(json.dumps({"_note": "keep me", "todos": [
        {"id": "a", "title": "slow important", "minutes": 120, "importance": 5, "project": "dashboard"},
        {"id": "b", "title": "quick low", "minutes": 5, "importance": 1},
        {"id": "c", "title": "quick high", "minutes": 5, "importance": 4, "due": "2999-01-01"},
        {"id": "d", "title": "done", "minutes": 1, "importance": 5, "done": True},
    ]}), encoding="utf-8")
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", str(path))
    return path


def test_desk_todos_desk_order_quickest_then_most_important(todo_file):
    out = mcp_tools.desk_todos()
    assert out["sort"] == "desk" and [t["id"] for t in out["todos"]] == ["c", "b", "a"]
    assert out["open_count"] == 3 and out["count"] == 3 and out["total_minutes"] == 130
    assert out["todos"][0]["days_left"] > 0
    lines = out["text"].splitlines()
    assert len(lines) == 3 and lines[0].startswith("[ ] 5m  !4  quick high") and lines[0].endswith("#c")
    assert "due 2999-01-01" in lines[0]
    assert [t["id"] for t in mcp_tools.desk_todos(include_done=True)["todos"]] == ["d", "c", "b", "a"]
    assert mcp_tools.desk_todos(include_done=True)["text"].startswith("[x] 1m  !5  done")


def test_desk_todos_other_sorts_and_filters(todo_file):
    assert [t["id"] for t in mcp_tools.desk_todos(sort="importance")["todos"]] == ["a", "c", "b"]
    assert [t["id"] for t in mcp_tools.desk_todos(sort="due")["todos"]] == ["c", "b", "a"]
    assert [t["id"] for t in mcp_tools.desk_todos(project="Dashboard")["todos"]] == ["a"]
    assert "error" in mcp_tools.desk_todos(sort="random") and "sorts" in mcp_tools.desk_todos(sort="random")


def test_desk_todos_missing_and_broken_file(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", str(tmp_path / "nope.json"))
    out = mcp_tools.desk_todos()
    assert out["todos"] == [] and out["text"] == "(nothing open)" and "todos_error" not in out
    assert "todos_error" in mcp_tools.project_status()
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", str(broken))
    assert "todos_error" in mcp_tools.desk_todos()
    assert "error" in mcp_tools.add_todo("x", 5)
    assert broken.read_text(encoding="utf-8") == "{not json", "a broken file is never overwritten"


def test_add_todo_writes_atomically_and_keeps_note(todo_file):
    out = mcp_tools.add_todo("Link tools/mcp from the main README", 5, 2, project="deeparam", due="2030-01-02")
    assert "error" not in out and out["added"]["id"] == "link-tools-mcp-from-the-main-readme"
    assert out["added"]["minutes"] == 5 and out["added"]["importance"] == 2 and out["added"]["days_left"] > 0
    assert out["open_count"] == 4
    doc = json.loads(todo_file.read_text(encoding="utf-8"))
    assert doc["_note"] == "keep me" and len(doc["todos"]) == 5 and doc["todos"][-1]["due"] == "2030-01-02"
    assert not [p for p in todo_file.parent.iterdir() if p.name.startswith(".todos-")], "no temp file left behind"
    again = mcp_tools.add_todo("Link tools/mcp from the main README", 5)
    assert again["added"]["id"] == "link-tools-mcp-from-the-main-readme-2"
    # 5-minute items first (importance 4, then the two new importance-3 ones, then importance 1), 120-minute last
    order = [t["id"] for t in mcp_tools.desk_todos()["todos"]]
    assert order[0] == "c" and order[3] == "b" and order[-1] == "a"


def test_add_todo_validation(todo_file):
    assert "error" in mcp_tools.add_todo("", 5)
    assert "error" in mcp_tools.add_todo("x", 0)
    assert "error" in mcp_tools.add_todo("x", "soon")
    assert "error" in mcp_tools.add_todo("x", 5, 6)
    assert "error" in mcp_tools.add_todo("x", 5, 0)
    assert "error" in mcp_tools.add_todo("x", 5, due="tomorrow")
    assert len(json.loads(todo_file.read_text(encoding="utf-8"))["todos"]) == 4, "nothing written on error"


def test_add_todo_creates_missing_file(tmp_path, monkeypatch):
    path = tmp_path / "new" / "todos.json"
    monkeypatch.setattr(mcp_tools, "TODOS_PATH", str(path))
    out = mcp_tools.add_todo("first", 10, 5)
    assert out["added"]["id"] == "first" and out["open_count"] == 1
    assert json.loads(path.read_text(encoding="utf-8"))["todos"][0]["title"] == "first"


def test_complete_todo(todo_file):
    out = mcp_tools.complete_todo("b")
    assert out["completed"]["done"] is True and out["completed"]["id"] == "b" and out["open_count"] == 2
    doc = json.loads(todo_file.read_text(encoding="utf-8"))
    b = next(t for t in doc["todos"] if t["id"] == "b")
    assert b["done"] is True and b["done_at"].count("-") == 2
    assert [t["id"] for t in mcp_tools.desk_todos()["todos"]] == ["c", "a"]
    assert mcp_tools.complete_todo("b")["already_done"] is True
    missing = mcp_tools.complete_todo("zzz")
    assert "error" in missing and missing["ids"] == ["a", "c"]


# --- search ---------------------------------------------------------------------------------------------------

def test_search_finds_all_three_kinds():
    out = mcp_tools.search("teemo")
    assert out["matches"][0] == {**out["matches"][0], "type": "champion", "id": 17, "name": "Teemo", "score": 1.0}
    assert out["matches"][0]["roles"]
    blunt = mcp_tools.search("blunt force")["matches"][0]
    assert blunt["type"] == "augment" and blunt["id"] == 1007 and blunt["rarity"] and blunt["has_stats"] is True
    bork = mcp_tools.search("blade of the ruined king")["matches"][0]
    assert bork["type"] == "item" and bork["id"] == 3153 and bork["price"] > 0
    kinds = {m["type"] for m in mcp_tools.search("blade", limit=50)["matches"]}
    assert {"item", "augment"} <= kinds


def test_search_fuzzy_limit_and_types():
    out = mcp_tools.search("teeemo", limit=3)
    assert out["matches"][0]["name"] == "Teemo" and len(out["matches"]) <= 3
    assert all(m["type"] == "item" for m in mcp_tools.search("blade", types="items")["matches"])
    assert all(m["type"] in ("champion", "augment") for m in mcp_tools.search("bl", types="champion,augment")["matches"])
    assert "error" in mcp_tools.search("")
    assert "error" in mcp_tools.search("x", types="runes")
    assert mcp_tools.search("qqqqqqqqqq")["matches"] == []
    scores = [m["score"] for m in mcp_tools.search("infinity", limit=20)["matches"]]
    assert scores == sorted(scores, reverse=True)
    _assert_compact_json(mcp_tools.search("a", limit=50))


# --- HTTP mode ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("header, ok", [
    ("Bearer s3cret", True), ("bearer s3cret", True), ("Bearer  s3cret ", True),
    ("Bearer wrong", False), ("Basic s3cret", False), ("s3cret", False), ("", False), (None, False),
])
def test_bearer_check(header, ok):
    assert mcp_tools.BearerAuth.check(header, "s3cret") is ok


def test_http_refuses_to_start_without_token():
    with pytest.raises(SystemExit):
        mcp_tools.build_http_app(None)
    with pytest.raises(SystemExit):
        mcp_tools.main(["--http"])
    with pytest.raises(SystemExit):
        mcp_tools.main(["--http", "--insecure-local", "--host", "0.0.0.0"])
    args = mcp_tools.parse_args(["--http", "--port", "9000", "--token", "t", "--allowed-host", "mcp.example.com"])
    assert args.http and args.port == 9000 and args.token == "t" and args.allowed_host == ["mcp.example.com"]
    assert mcp_tools.parse_args([]).port == 8765


@pytest.mark.skipif(importlib.util.find_spec("mcp") is None or importlib.util.find_spec("starlette") is None,
                    reason="mcp/starlette not installed")
def test_http_auth_gate_and_tool_call():
    from starlette.testclient import TestClient
    app = mcp_tools.build_http_app("s3cret", allowed_hosts=["testserver"])
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}}
    accept = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    with TestClient(app) as c:
        assert c.post("/mcp", json=init, headers=accept).status_code == 401
        assert c.post("/mcp", json=init, headers={**accept, "Authorization": "Bearer nope"}).status_code == 401
        assert c.get("/mcp").status_code == 401
        auth = {**accept, "Authorization": "Bearer s3cret"}
        r = c.post("/mcp", json=init, headers=auth)
        assert r.status_code == 200, r.text
        sid = r.headers["mcp-session-id"]
        auth["Mcp-Session-Id"] = sid
        c.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=auth)
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=auth)
        assert r.status_code == 200
        names = {t["name"] for t in _sse_result(r.text)["tools"]}
        assert names == {fn.__name__ for fn in mcp_tools.TOOLS}
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                 "params": {"name": "search", "arguments": {"query": "teemo", "limit": 1}}}, headers=auth)
        assert r.status_code == 200
        result = _sse_result(r.text)
        assert result.get("isError") is not True
        assert "Teemo" in json.dumps(result)
        # the session id alone is not enough: the token is checked on every request
        assert c.post("/mcp", json={"jsonrpc": "2.0", "id": 4, "method": "tools/list"},
                      headers={**accept, "Mcp-Session-Id": sid}).status_code == 401


def test_insecure_local_app_has_no_gate():
    pytest.importorskip("mcp")
    app = mcp_tools.build_http_app(None, insecure_local=True)
    assert not isinstance(app, mcp_tools.BearerAuth)


def _sse_result(text):
    """The JSON-RPC result from a streamable-HTTP response (SSE `data:` lines or a plain JSON body)."""
    if text.lstrip().startswith("{"):
        return json.loads(text)["result"]
    for line in text.splitlines():
        if line.startswith("data:"):
            msg = json.loads(line[5:])
            if "result" in msg:
                return msg["result"]
    raise AssertionError(f"no result in response: {text[:300]}")
