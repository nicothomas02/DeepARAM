#!/usr/bin/env python3
"""Dashboard MCP server: DeepARAM data and personal-dashboard data as MCP tools.

Every tool is a plain function that reads the repo's committed JSON (offline, read-only) and returns a compact
dict. The MCP wiring (`build_server`, `main`) is kept separate so tests and other scripts can import the functions
without the `mcp` package installed. Run `python3 tools/mcp/dashboard_mcp.py` to serve over stdio.

Data sources (all relative to the repo root):
  data/cn/champions.json                      per-champion Mayhem stats (Tencent, daily)
  data/cn/augments.json                       per-augment stats and tiers
  data/cn/duos.json                           best champion pairs
  data/cn/builds/<id>.json                    per-champion items, skills, augments, partners
  data/cn/history/by_patch.json               whole-patch numbers per champion
  simulator/viewer/replay-data/best-builds.json  simulator's best build per champion
  data/pbe/tracker.json                       PBE vs live changes
  data/official/patch_notes.json              Mayhem sections of official patch notes
  web/public/assets/cd/latest/...             names for champions, items and augments
  tools/mcp/todos.json                        Nico's Desk to-dos
"""
from __future__ import annotations

import difflib
import functools
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("DEEPARAM_REPO") or os.path.normpath(os.path.join(HERE, "..", ".."))
CD = os.path.join("web", "public", "assets", "cd", "latest", "plugins", "rcp-be-lol-game-data", "global", "default", "v1")
TODOS_PATH = os.environ.get("DASHBOARD_TODOS") or os.path.join(HERE, "todos.json")

METRICS = ("win_rate", "pick_rate", "damage_share", "tank_share", "kill_participation", "avg_death_time")
ROLES = ("assassin", "fighter", "mage", "marksman", "support", "tank")


def repo(*parts: str) -> str:
    return os.path.join(REPO, *parts)


@functools.lru_cache(maxsize=None)
def load_json(*parts: str) -> Any:
    with open(repo(*parts), encoding="utf-8") as f:
        return json.load(f)


def clear_cache() -> None:
    """Drop every cached file (tests and long-running servers that want fresh data after a data commit)."""
    load_json.cache_clear()
    _champion_index.cache_clear()
    _augment_index.cache_clear()
    _item_names.cache_clear()


def pct(x: float | None, digits: int = 1) -> float | None:
    return None if x is None else round(100 * x, digits)


# --- name lookup ----------------------------------------------------------------------------------------------

def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


@functools.lru_cache(maxsize=None)
def _champion_index() -> dict[str, dict]:
    """norm(name|alias|id) -> {id, name, alias, roles} for every champion in the client summary."""
    index: dict[str, dict] = {}
    # Sorted by id so the real champion (id < 10000) wins over mode variants like 60001 "Jade_Annie".
    for c in sorted(load_json(CD, "champion-summary.json"), key=lambda c: c["id"]):
        if c["id"] < 0 or str(c.get("alias", "")).startswith("Jade_"):
            continue
        rec = {"id": c["id"], "name": c["name"], "alias": c["alias"], "roles": c.get("roles", [])}
        for key in (c["name"], c["alias"], str(c["id"])):
            index.setdefault(norm(key), rec)
    return index


def champion_name(cid: int) -> str:
    rec = _champion_index().get(norm(str(cid)))
    return rec["name"] if rec else f"#{cid}"


def find_champion(query: str | int) -> tuple[dict | None, list[str]]:
    """Exact, then prefix, then fuzzy match. Returns (record or None, suggestions)."""
    index = _champion_index()
    q = norm(query)
    if not q:
        return None, []
    if q in index:
        return index[q], []
    by_name = {norm(r["name"]): r for r in index.values()}
    prefix = [r for k, r in by_name.items() if k.startswith(q)]
    if len(prefix) == 1:
        return prefix[0], []
    close = difflib.get_close_matches(q, list(by_name), n=5, cutoff=0.6)
    if close and _confident(q, close, ambiguous=len(prefix) > 1):
        return by_name[close[0]], [by_name[c]["name"] for c in close[1:]]
    suggestions = [r["name"] for r in prefix[:6]] or [by_name[c]["name"] for c in close]
    return None, suggestions


def _confident(q: str, close: list[str], ambiguous: bool) -> bool:
    """Accept a fuzzy match when it is clearly the best one: a near-exact hit, or the only candidate and the
    query is not a prefix shared by several names."""
    best = difflib.SequenceMatcher(None, q, close[0]).ratio()
    if best >= 0.85:
        return True
    return len(close) == 1 and not ambiguous and best >= 0.7


@functools.lru_cache(maxsize=None)
def _augment_index() -> dict[int, dict]:
    """augment id -> {id, name, key, rarity} from the client's augment list."""
    out = {}
    for a in load_json(CD, "cherry-augments.json"):
        out[a["id"]] = {
            "id": a["id"],
            "name": a.get("nameTRA") or a.get("augmentNameId"),
            "key": a.get("augmentNameId"),
            "rarity": str(a.get("rarity", "")).removeprefix("k"),
        }
    return out


def augment_name(aid: int) -> str:
    rec = _augment_index().get(aid)
    return rec["name"] if rec else f"#{aid}"


def find_augment(query: str | int) -> tuple[dict | None, list[str]]:
    """Match an augment by id, English name or internal key (fuzzy). Only augments with Mayhem stats count."""
    stats = {a["augment_id"]: a for a in load_json("data", "cn", "augments.json")["augments"]}
    names = _augment_index()
    q = norm(query)
    if not q:
        return None, []
    candidates = {}
    for aid in stats:
        rec = names.get(aid, {"id": aid, "name": f"#{aid}", "key": stats[aid].get("key", "")})
        for key in (str(aid), rec["name"], rec.get("key", ""), re.sub(r"^ARAM_", "", rec.get("key", "") or "")):
            if key:
                candidates.setdefault(norm(key), rec)
    if q in candidates:
        return candidates[q], []
    prefix = {r["id"]: r for k, r in candidates.items() if k.startswith(q)}
    if len(prefix) == 1:
        return next(iter(prefix.values())), []
    close = difflib.get_close_matches(q, list(candidates), n=5, cutoff=0.6)
    if close and _confident(q, close, ambiguous=len(prefix) > 1):
        return candidates[close[0]], sorted({candidates[c]["name"] for c in close[1:]})
    suggestions = sorted({r["name"] for r in list(prefix.values())[:6]} or {candidates[c]["name"] for c in close})
    return None, suggestions


@functools.lru_cache(maxsize=None)
def _item_names() -> dict[int, str]:
    return {i["id"]: i["name"] for i in load_json(CD, "items.json")}


def item_name(iid: int) -> str:
    return _item_names().get(iid, f"#{iid}")


def not_found(kind: str, query: Any, suggestions: list[str]) -> dict:
    return {"error": f"unknown {kind}: {query!r}", "suggestions": suggestions}


# --- stats helpers --------------------------------------------------------------------------------------------

def _cn_champions() -> list[dict]:
    return load_json("data", "cn", "champions.json")["champions"]


def _cn_meta() -> dict:
    m = load_json("data", "cn", "champions.json")["meta"]
    d = m.get("champion_stat_date", "")
    return {"source": m.get("source"), "stat_date": f"{d[:4]}-{d[4:6]}-{d[6:]}" if len(d) == 8 else d}


def _metric_value(row: dict, metric: str) -> float | None:
    return {
        "win_rate": row.get("win_rate"),
        "pick_rate": row.get("pick_rate"),
        "damage_share": row.get("avg_damage_ratio"),
        "tank_share": row.get("avg_tank_ratio"),
        "kill_participation": row.get("avg_participation_rate"),
        "avg_death_time": row.get("avg_death_time"),
    }.get(metric)


def _row(row: dict) -> dict:
    return {
        "champion": champion_name(row["champion_id"]),
        "id": row["champion_id"],
        "rank": row.get("rank"),
        "win_rate": pct(row.get("win_rate")),
        "pick_rate": pct(row.get("pick_rate")),
        "damage_share": pct(row.get("avg_damage_ratio")),
        "tank_share": pct(row.get("avg_tank_ratio")),
        "kill_participation": pct(row.get("avg_participation_rate")),
    }


# --- tools ----------------------------------------------------------------------------------------------------

def champion_stats(champion: str) -> dict:
    """Mayhem stats for one champion: win/pick rate, rank, damage and tank share, kill participation, best
    partners and most common augments, plus the simulator's damage profile when it has one."""
    rec, suggestions = find_champion(champion)
    if not rec:
        return not_found("champion", champion, suggestions)
    row = next((r for r in _cn_champions() if r["champion_id"] == rec["id"]), None)
    if not row:
        return {"champion": rec["name"], "id": rec["id"], "roles": rec["roles"], "error": "no Mayhem stats yet"}
    out = _row(row)
    out.update({
        "roles": rec["roles"],
        "rank_change": row.get("rank_change"),
        "avg_time_dead_s": round(row["avg_death_time"], 1) if row.get("avg_death_time") is not None else None,
        "best_partners": [
            {"champion": champion_name(p["champion_id"]), "win_rate": pct(p["win_rate"]), "pick_rate": pct(p["pick_rate"])}
            for p in row.get("best_partners", [])[:5]
        ],
        "most_picked_augments": [augment_name(a) for a in row.get("lowest_rank_augments", [])],
    })
    sim = next((b for b in load_json("simulator", "viewer", "replay-data", "best-builds.json")["champions"]
                if b.get("champion") == rec["alias"] or b.get("name") == rec["name"]), None)
    if sim:
        s = sim.get("summary", {})
        out["simulator"] = {
            "role": sim.get("role"),
            "mean_dps": s.get("mean_dps"),
            "survival_rate": pct(s.get("survival_rate")),
            "damage_by_source": {k: pct(v) for k, v in s.get("share_by_source", {}).items()},
        }
    out["meta"] = _cn_meta()
    return out


def tier_list(role: str | None = None, metric: str = "win_rate", top: int = 10, ascending: bool = False) -> dict:
    """Top champions by a metric (win_rate, pick_rate, damage_share, tank_share, kill_participation,
    avg_death_time), optionally for one client role (assassin, fighter, mage, marksman, support, tank)."""
    if metric not in METRICS:
        return {"error": f"unknown metric: {metric!r}", "metrics": list(METRICS)}
    role_n = norm(role) if role else None
    if role_n and role_n not in ROLES:
        return {"error": f"unknown role: {role!r}", "roles": list(ROLES)}
    rows = []
    for r in _cn_champions():
        rec = _champion_index().get(norm(str(r["champion_id"])))
        if role_n and (not rec or role_n not in rec["roles"]):
            continue
        if _metric_value(r, metric) is None:
            continue
        rows.append(r)
    rows.sort(key=lambda r: _metric_value(r, metric), reverse=not ascending)
    top = max(1, min(int(top), len(rows))) if rows else 0
    return {
        "metric": metric, "role": role_n, "count": len(rows), "meta": _cn_meta(),
        "champions": [_row(r) for r in rows[:top]],
    }


def best_build(champion: str) -> dict:
    """Most picked and best winning builds for a champion (Tencent build page): starting items, boots, core,
    full builds, skill order, top augments by tier, partners, and the simulator's best build when it has one."""
    rec, suggestions = find_champion(champion)
    if not rec:
        return not_found("champion", champion, suggestions)
    path = repo("data", "cn", "builds", f"{rec['id']}.json")
    out: dict[str, Any] = {"champion": rec["name"], "id": rec["id"]}
    if os.path.exists(path):
        b = load_json("data", "cn", "builds", f"{rec['id']}.json")

        def items(group: list[dict], n: int) -> list[dict]:
            ranked = sorted(group, key=lambda g: g.get("pick_rate", 0), reverse=True)[:n]
            return [{"items": [item_name(i) for i in g["items"]], "pick_rate": pct(g.get("pick_rate")),
                     "win_rate": pct(g.get("win_rate"))} for g in ranked]

        it = b.get("items", {})
        skills = sorted(b.get("skills", []), key=lambda s: s.get("pick_rate", 0), reverse=True)[:2]
        out.update({
            "date": b.get("date"),
            "starting": items(it.get("starting", []), 2),
            "boots": items(it.get("boots", []), 2),
            "core": items(it.get("core", []), 3),
            "full_builds": items(it.get("full_builds", []), 2),
            "skill_order": [{"max": "".join(s["max_order"]), "pick_rate": pct(s.get("pick_rate")),
                             "win_rate": pct(s.get("win_rate"))} for s in skills],
            "augments": {
                tier: [{"augment": augment_name(a["id"]), "pick_rate": pct(a.get("pick_rate")), "grade": a.get("grade")}
                       for a in sorted(b.get("augments", {}).get(tier, []), key=lambda a: a.get("pick_rate", 0), reverse=True)[:4]]
                for tier in ("prismatic", "gold", "silver")
            },
            "partners": [{"champion": champion_name(p["id"]), "win_rate": pct(p["win_rate"])} for p in b.get("partners", [])[:3]],
        })
    else:
        out["cn_build"] = "no build page data for this champion"
    sim = next((b for b in load_json("simulator", "viewer", "replay-data", "best-builds.json")["champions"]
                if b.get("champion") == rec["alias"] or b.get("name") == rec["name"]), None)
    if sim:
        out["simulator_best"] = {
            "items": sim.get("build", {}).get("items", []),
            "augments": sim.get("build", {}).get("augments", []),
            "mean_dps": sim.get("summary", {}).get("mean_dps"),
            "parse_quality": sim.get("parse_quality"),
        }
    return out


def augment_stats(augment: str) -> dict:
    """Mayhem stats for one augment: tier, win and pick rate with ranks, and the champions it wins most with."""
    rec, suggestions = find_augment(augment)
    if not rec:
        return not_found("augment", augment, suggestions)
    data = load_json("data", "cn", "augments.json")
    row = next(a for a in data["augments"] if a["augment_id"] == rec["id"])
    return {
        "augment": rec["name"], "id": rec["id"], "key": row.get("key"), "tier": row.get("tier"),
        "win_rate": pct(row.get("win_rate")), "win_rank": row.get("win_rank"), "win_rank_change": row.get("win_rank_change"),
        "pick_rate": pct(row.get("pick_rate")), "pick_rank": row.get("pick_rank"), "pick_rank_change": row.get("pick_rank_change"),
        "best_champions": [champion_name(c) for c in row.get("best_champions", [])],
        "meta": _cn_meta(),
    }


def best_duos(champion: str | None = None, top: int = 10) -> dict:
    """Best champion pairs by win rate (Tencent's top pairs), optionally only pairs that include one champion."""
    data = load_json("data", "cn", "duos.json")
    duos = data["duos"]
    out: dict[str, Any] = {"meta": _cn_meta()}
    if champion:
        rec, suggestions = find_champion(champion)
        if not rec:
            return not_found("champion", champion, suggestions)
        duos = [d for d in duos if rec["id"] in d["champion_ids"]]
        out["champion"] = rec["name"]
    duos = sorted(duos, key=lambda d: d.get("win_rate", 0), reverse=True)
    out["count"] = len(duos)
    out["duos"] = [{"champions": [champion_name(c) for c in d["champion_ids"]],
                    "win_rate": pct(d["win_rate"]), "pick_rate": pct(d["pick_rate"], 2)} for d in duos[:max(1, int(top))]]
    return out


def champion_trend(champion: str, patches: int = 4) -> dict:
    """A champion's whole-patch win and pick rate over the last N patches (newest last)."""
    rec, suggestions = find_champion(champion)
    if not rec:
        return not_found("champion", champion, suggestions)
    hist = load_json("data", "cn", "history", "by_patch.json")
    series = []
    for p in hist["patches"]:
        row = next((c for c in hist["champions"].get(p["patch"], []) if c["id"] == rec["id"]), None)
        if row:
            series.append({"patch": p["patch"], "days": p["days"], "live": p.get("live", False),
                           "win_rate": pct(row["win_rate"]), "pick_rate": pct(row["pick_rate"]),
                           "damage_share": pct(row.get("avg_damage_ratio"))})
    series = series[-max(1, int(patches)):]
    delta = round(series[-1]["win_rate"] - series[0]["win_rate"], 1) if len(series) > 1 else 0.0
    return {"champion": rec["name"], "id": rec["id"], "patches": series, "win_rate_change": delta}


def patch_changes(latest: bool = True, champion: str | None = None, source: str = "pbe") -> dict:
    """Patch changes. source="pbe": PBE vs live tracker (data/pbe/tracker.json). source="live": the Mayhem
    section of the official patch notes (newest patch, or all when latest=False). champion filters either."""
    source = norm(source)
    champ = None
    if champion:
        champ, suggestions = find_champion(champion)
        if not champ:
            return not_found("champion", champion, suggestions)

    def keep(name: str) -> bool:
        return not champ or norm(name) in (norm(champ["name"]), norm(champ["alias"]))

    if source == "pbe":
        t = load_json("data", "pbe", "tracker.json")
        entries = [{"kind": e.get("kind"), "name": e.get("name"), "tag": e.get("tag"),
                    "lines": [ln["text"] if isinstance(ln, dict) else ln for ln in e.get("lines", [])]}
                   for e in t.get("entries", []) if keep(e.get("name", ""))]
        return {"source": "pbe", "pbe_build": t.get("builds", {}).get("pbe"), "live_build": t.get("builds", {}).get("live"),
                "data_as_of": t.get("dataAsOf"), "counts": t.get("counts"), "entries": entries}
    if source == "live":
        notes = load_json("data", "official", "patch_notes.json")
        patches = notes["patches"][:1] if latest else notes["patches"]
        out = []
        for p in patches:
            champs = [c for c in p.get("champions", []) if keep(c.get("name", ""))]
            if champ and not champs:
                continue
            entry = {"patch": p["patch"], "game_version": p.get("gameVersion"), "date": p.get("date"), "url": p.get("url"),
                     "no_mayhem_section": p.get("noMayhemSection", False), "champions": champs}
            if not champ:
                for k in ("augments", "items", "systems"):
                    if p.get(k):
                        entry[k] = p[k]
            out.append(entry)
        return {"source": "live", "read": notes.get("read"), "patches": out}
    return {"error": f"unknown source: {source!r}", "sources": ["pbe", "live"]}


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, timeout=10, check=False).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _todo_sort_key(t: dict) -> tuple:
    """Nico's Desk order: quickest first, then most important."""
    return (t.get("minutes", 10**6), -int(t.get("importance", 0)), t.get("title", ""))


def project_status(include_done: bool = False, commits: int = 5) -> dict:
    """Open to-dos from tools/mcp/todos.json in Desk order (quickest to longest, then most to least important),
    the newest commits, the current branch, and the dates of the newest data files."""
    todos: list[dict] = []
    todos_error = None
    try:
        with open(TODOS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        todos = raw.get("todos", raw) if isinstance(raw, dict) else raw
    except (OSError, ValueError) as e:
        todos_error = f"{type(e).__name__}: {e}"
    today = date.today()
    items = []
    for t in sorted(todos, key=_todo_sort_key):
        if t.get("done") and not include_done:
            continue
        item = {k: t.get(k) for k in ("id", "title", "minutes", "importance", "project", "due", "done") if t.get(k) is not None}
        if t.get("due"):
            try:
                item["days_left"] = (date.fromisoformat(t["due"]) - today).days
            except ValueError:
                pass
        items.append(item)
    log = _git("log", f"-{max(1, int(commits))}", "--format=%h %as %s")
    out: dict[str, Any] = {
        "todos": items,
        "open_count": len(items),
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD") or None,
        "recent_commits": [ln for ln in log.splitlines() if ln],
        "data": {
            "mayhem_stats": _cn_meta()["stat_date"],
            "builds": load_json("data", "cn", "builds", "index.json").get("updated"),
            "pbe_tracker": load_json("data", "pbe", "tracker.json").get("dataAsOf"),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if todos_error:
        out["todos_error"] = todos_error
    return out


TOOLS = (champion_stats, tier_list, best_build, augment_stats, best_duos, champion_trend, patch_changes, project_status)


# --- MCP wiring -----------------------------------------------------------------------------------------------

def build_server():
    """Create the MCP server with every tool registered. Works with mcp 1.x (FastMCP) and 2.x (MCPServer)."""
    try:
        from mcp.server.mcpserver import MCPServer as Server  # mcp >= 2
    except ImportError:  # pragma: no cover - depends on the installed version
        from mcp.server.fastmcp import FastMCP as Server  # mcp 1.x
    server = Server("deeparam-dashboard", instructions=(
        "DeepARAM (ARAM: Mayhem) stats and Nico's Desk project data. Champion and augment names are fuzzy-matched; "
        "rates are percentages. Data is the repo's committed snapshot, see `meta.stat_date`."))
    for fn in TOOLS:
        server.tool()(fn)
    return server


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--call":  # quick manual check: python3 dashboard_mcp.py --call champion_stats Teemo
        fn = {f.__name__: f for f in TOOLS}.get(argv[1] if len(argv) > 1 else "")
        if not fn:
            print("tools:", ", ".join(f.__name__ for f in TOOLS), file=sys.stderr)
            return 2
        print(json.dumps(fn(*argv[2:]), ensure_ascii=False, indent=1))
        return 0
    build_server().run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
