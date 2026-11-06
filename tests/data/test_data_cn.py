"""Mayhem stats in data/cn/ (fetch_cn.py, builds.py, history.py, query.py): committed output shape and the
parsers, run on small synthetic payloads (never the network)."""
import csv
import datetime as dt
import glob
import math
import os
import re

import pytest

from deeparam_data_helpers import REPO, TIERS, champion_ids, load_json, load_module, walk_numbers

CN = os.path.join(REPO, "data", "cn")
RATE_KEYS = ("win_rate", "pick_rate")
STORMRAZOR_TENCENT, STORMRAZOR = 3097, 3095


def read_csv(rel):
    with open(os.path.join(CN, rel), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def is_rate(x):
    return isinstance(x, (int, float)) and 0 <= x <= 1


def stat_date(s):
    return dt.datetime.strptime(s, "%Y%m%d").date()


# ---------- champions / augments / duos ----------

@pytest.fixture(scope="module")
def champs_json():
    return load_json("data/cn/champions.json")


@pytest.fixture(scope="module")
def augs_json():
    return load_json("data/cn/augments.json")


def test_meta(champs_json, augs_json):
    for body in (champs_json, augs_json, load_json("data/cn/duos.json")):
        m = body["meta"]
        stat_date(m["champion_stat_date"])
        stat_date(m["augment_stat_date"])
        dt.datetime.fromisoformat(m["fetched_at"])


def test_champions_json(champs_json):
    rows = champs_json["champions"]
    ids = [r["champion_id"] for r in rows]
    assert len(ids) == len(set(ids)) >= 150
    assert set(ids) <= champion_ids()
    assert sorted(r["rank"] for r in rows) == list(range(1, len(rows) + 1))
    for r in rows:
        for k in RATE_KEYS + ("avg_damage_ratio", "avg_tank_ratio", "avg_participation_rate"):
            assert is_rate(r[k]), (r["champion_id"], k)
        assert r["avg_death_time"] >= 0
        assert r["name"], r["champion_id"]
        partners = r["best_partners"]
        assert {p["champion_id"] for p in partners} <= champion_ids()
        assert all(p["champion_id"] != r["champion_id"] for p in partners)
        assert all(is_rate(p["win_rate"]) and is_rate(p["pick_rate"]) for p in partners)


def test_champions_csv_matches_json(champs_json):
    rows = read_csv("champions.csv")
    by_id = {r["champion_id"]: r for r in champs_json["champions"]}
    assert len(rows) == len(by_id)
    for r in rows:
        j = by_id[int(r["champion_id"])]
        assert int(r["rank"]) == j["rank"] and r["name"] == j["name"]
        assert float(r["win_rate"]) == pytest.approx(j["win_rate"])
    assert [int(r["rank"]) for r in rows] == sorted(int(r["rank"]) for r in rows)


def test_augments_json(augs_json):
    rows = augs_json["augments"]
    ids = [a["augment_id"] for a in rows]
    assert len(ids) == len(set(ids)) >= 100
    for a in rows:
        assert is_rate(a["win_rate"]) and is_rate(a["pick_rate"]), a["augment_id"]
        assert a["tier"] in TIERS, a["augment_id"]
        assert a["key"], a["augment_id"]
        assert a["win_rank"] >= 1 and a["pick_rank"] >= 1
        assert set(a["best_champions"]) <= champion_ids(), a["augment_id"]
    assert sorted(a["win_rank"] for a in rows) == list(range(1, len(rows) + 1))


def test_no_data_augments(augs_json):
    """f5e6bf36: live augments with no stats yet are listed separately, never also with stats."""
    have = {a["augment_id"] for a in augs_json["augments"]}
    nd = augs_json["no_data"]
    ids = [a["augment_id"] for a in nd]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    assert not set(ids) & have
    for a in nd:
        assert a["tier"] in TIERS and a["key"]


def test_augment_tiers_agree_with_game_rules(augs_json):
    """Tiers come from the game client, the same source as guide/augment_rules.json."""
    rules = load_json("guide/augment_rules.json")["tiers"]
    for a in augs_json["augments"] + augs_json["no_data"]:
        if str(a["augment_id"]) in rules:
            assert a["tier"] == rules[str(a["augment_id"])], a["augment_id"]


def test_augments_csv_matches_json(augs_json):
    rows = read_csv("augments.csv")
    assert len(rows) == len(augs_json["augments"])
    assert [int(r["win_rank"]) for r in rows] == list(range(1, len(rows) + 1))
    by_id = {a["augment_id"]: a for a in augs_json["augments"]}
    for r in rows:
        assert r["tier"] == by_id[int(r["augment_id"])]["tier"]


def test_duos():
    duos = load_json("data/cn/duos.json")["duos"]
    assert duos
    ranks = [d["rank"] for d in duos]
    assert len(ranks) == len(set(ranks))
    names = {c: n for c, n in ((r["champion_id"], r["name"]) for r in load_json("data/cn/champions.json")["champions"])}
    for d in duos:
        a, b = d["champion_ids"]
        assert a != b and {a, b} <= champion_ids()
        assert d["names"] == [names[a], names[b]]
        assert len(d["roles"]) == 2
        assert is_rate(d["win_rate"]) and is_rate(d["pick_rate"])


# ---------- builds/ ----------

BUILD_FILES = sorted(glob.glob(os.path.join(CN, "builds", "[0-9]*.json")))


@pytest.fixture(scope="module")
def builds():
    return {int(os.path.basename(p)[:-5]): load_json(p) for p in BUILD_FILES}


def test_builds_index(builds):
    idx = load_json("data/cn/builds/index.json")
    dt.date.fromisoformat(idx["updated"])
    listed = [c["id"] for c in idx["champions"]]
    assert len(listed) == len(set(listed))
    assert set(listed) == set(builds)
    assert set(builds) <= champion_ids()
    for c in idx["champions"]:
        assert builds[c["id"]]["name"] == c["name"] and builds[c["id"]]["date"] == c["date"]


def iter_item_rows(b):
    for rows in b["items"].values():
        yield from rows


def test_build_files_shape(builds):
    for cid, b in builds.items():
        assert b["id"] == cid
        dt.date.fromisoformat(b["date"])
        assert set(b["augments"]) == {"all", "silver", "gold", "prismatic"}
        assert set(b["items"]) == {"starting", "boots", "core", "other", "full_builds"}
        for rows in b["augments"].values():
            for a in rows:
                assert isinstance(a["id"], int) and is_rate(a["pick_rate"]), cid
                assert a["grade"] in ("S", "A", "B", "C", "D", ""), cid
        for r in iter_item_rows(b):
            assert r["items"] and all(isinstance(i, int) and i > 0 for i in r["items"]), cid
            assert is_rate(r["pick_rate"]) and is_rate(r["win_rate"]), cid
        for k in ("core", "other"):
            picks = [r["pick_rate"] for r in b["items"][k]]
            assert picks == sorted(picks, reverse=True), (cid, k)
        for s in b["skills"]:
            assert s["max_order"] and set(s["max_order"]) <= {"Q", "W", "E", "R"}
            assert is_rate(s["pick_rate"]) and is_rate(s["win_rate"])
            for o in s["orders"]:
                assert set(o["order"]) <= {"Q", "W", "E", "R"} and len(o["order"]) <= 18
        for p in b["partners"]:
            assert p["id"] in champion_ids() and p["id"] != cid
            assert is_rate(p["win_rate"]) and is_rate(p["pick_rate"])


def test_no_build_uses_tencent_stormrazor_id(builds):
    """af506266 / f5e6bf36: Stormrazor is 3097 in the stats source and 3095 in the game; builds use 3095."""
    bad = sorted(cid for cid, b in builds.items() if any(STORMRAZOR_TENCENT in r["items"] for r in iter_item_rows(b)))
    assert not bad


def test_build_augments_are_known(builds, augs_json):
    known = {a["augment_id"] for a in augs_json["augments"]} | {a["augment_id"] for a in augs_json["no_data"]}
    known |= {int(k) for k in load_json("guide/augment_rules.json")["tiers"]}
    unknown = {(cid, a["id"]) for cid, b in builds.items() for rows in b["augments"].values() for a in rows
               if a["id"] not in known}
    # retired augments can linger in a day's build stats; most must be in the live pool
    assert len(unknown) <= 0.05 * sum(len(rows) for b in builds.values() for rows in b["augments"].values())


# ---------- history/ ----------

@pytest.fixture(scope="module")
def patches():
    return read_csv("history/patches.csv")


def test_patch_windows(patches):
    assert patches
    names = [p["patch"] for p in patches]
    assert len(names) == len(set(names))
    prev = None
    for p in patches:
        released, start = dt.date.fromisoformat(p["released"]), dt.date.fromisoformat(p["window_start"])
        first, last = dt.date.fromisoformat(p["first_day_in_data"]), dt.date.fromisoformat(p["last_day"])
        assert start >= released and last >= first, p
        assert int(p["days"]) == (last - start).days + 1, p
        if prev:
            assert released > dt.date.fromisoformat(prev["released"]), p
            assert first > dt.date.fromisoformat(prev["last_day"]), f"{p['patch']} overlaps {prev['patch']}"
        prev = p
    assert dt.date.fromisoformat(patches[0]["first_day_in_data"]) == dt.date(2025, 11, 2)


def test_daily_files():
    seen = set()
    for path in sorted(glob.glob(os.path.join(CN, "history", "daily", "*.csv"))):
        month = os.path.basename(path)[:-4]
        assert re.match(r"^\d{4}-\d{2}$", month)
        with open(path, encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        keys = [(r["date"], r["champion_id"]) for r in rows]
        assert len(keys) == len(set(keys)), path
        for r in rows:
            assert r["date"].startswith(month), path
            assert 0 <= float(r["win_rate"]) <= 1 and 0 <= float(r["pick_rate"]) <= 1
        dates = [r["date"] for r in rows]
        assert dates == sorted(dates), path
        seen |= set(dates)
    assert seen and min(seen) == "2025-11-02"


def test_by_patch_csv(patches):
    rows = read_csv("history/by_patch.csv")
    names = {p["patch"]: int(p["days"]) for p in patches}
    keys = [(r["patch"], r["champion_id"]) for r in rows]
    assert len(keys) == len(set(keys))
    for r in rows:
        assert r["patch"] in names and int(r["days"]) == names[r["patch"]]
        assert 0 <= float(r["win_rate"]) <= 1 and 0 <= float(r["pick_rate"]) <= 1
    assert {r["patch"] for r in rows} == set(names)


def test_by_patch_json(patches):
    site = load_json("data/cn/history/by_patch.json")
    assert [p["patch"] for p in site["patches"]] == [p["patch"] for p in patches]
    live = [p["live"] for p in site["patches"]]
    assert live == [False] * (len(live) - 1) + [True], "only the newest patch is live"
    assert set(site["champions"]) == {p["patch"] for p in patches}
    for patch, rows in site["champions"].items():
        days = next(p["days"] for p in site["patches"] if p["patch"] == patch)
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), patch
        for r in rows:
            assert r["weight"] == pytest.approx(r["pick_rate"] * days, abs=1e-4), (patch, r["id"])
            assert 0 <= r["win_rate"] <= 1


def test_all_time_and_by_month():
    rows = read_csv("history/all_time.csv")
    assert [int(r["win_rate_rank"]) for r in rows] == list(range(1, len(rows) + 1))
    wr = [float(r["win_rate"]) for r in rows]
    assert wr == sorted(wr, reverse=True)
    assert len({r["champion_id"] for r in rows}) == len(rows)
    share = sum(float(r["est_game_share"]) for r in rows)
    assert 0.9 <= share <= 1.1, "champion slots are 10 per game, so shares sum to about 1"
    months = read_csv("history/by_month.csv")
    for (m, d) in {(r["month"], int(r["days"])) for r in months}:
        assert re.match(r"^\d{4}-\d{2}$", m) and 1 <= d <= 45


def test_snapshot_files():
    for kind, cols in (("augments", ["augment_id", "key", "name_cn", "tier", "win_rate", "win_rank", "pick_rate",
                                     "pick_rank", "best_champions"]),
                       ("duos", ["rank", "champion_ids", "names", "win_rate", "pick_rate"])):
        files = sorted(glob.glob(os.path.join(CN, "history", kind, "*.csv")))
        assert files
        for path in files:
            dt.date.fromisoformat(os.path.basename(path)[:-4])
            rows = read_csv(os.path.relpath(path, CN))
            assert rows and list(rows[0]) == cols, path


# ---------- parsers (synthetic payloads) ----------

@pytest.fixture(scope="module")
def fetch_cn():
    return load_module("data/cn/fetch_cn.py", "fetch_cn", extra_path=["data/cn"])


@pytest.fixture(scope="module")
def builds_py(fetch_cn):
    return load_module("data/cn/builds.py", "deeparam_cn_builds", extra_path=["data/cn"])


@pytest.fixture(scope="module")
def query_py():
    return load_module("data/cn/query.py", "query", extra_path=["data/cn"])


@pytest.fixture(scope="module")
def history_py(fetch_cn, query_py):
    return load_module("data/cn/history.py", "deeparam_cn_history", extra_path=["data/cn"])


def test_parse_champions(fetch_cn):
    payload = {"listcollect": "120_1_up_0.5577_0.1179_17,0.059,0.6031,1&136,0.05,0.55,2_303.01_0.69_0.23_0.27_1029,1214#"
                              "4_2_same_0.56_0.11__250_0.6_0.2_0.1"}
    rows = fetch_cn.parse_champions(payload)
    assert rows[0]["champion_id"] == 120 and rows[0]["rank"] == 1 and rows[0]["win_rate"] == 0.5577
    assert rows[0]["best_partners"] == [{"champion_id": 17, "pick_rate": 0.059, "win_rate": 0.6031, "rank": 1},
                                        {"champion_id": 136, "pick_rate": 0.05, "win_rate": 0.55, "rank": 2}]
    assert rows[0]["lowest_rank_augments"] == [1029, 1214]
    assert rows[1]["best_partners"] == [] and rows[1]["lowest_rank_augments"] == []
    assert fetch_cn.parse_champions({}) == []


def test_parse_augments_and_duos(fetch_cn):
    a = fetch_cn.parse_augments({"augmentlist": "1001_x_0.1493_107_0_0.4796_188_-1_223,36#1002_x_0.14_109_2_0.49_149_3"})
    assert a[0] == {"augment_id": 1001, "pick_rate": 0.1493, "pick_rank": 107, "pick_rank_change": 0,
                    "win_rate": 0.4796, "win_rank": 188, "win_rank_change": -1, "best_champions": [223, 36]}
    assert a[1]["best_champions"] == []
    d = fetch_cn.parse_duos({"championid_data": "157;17|fighter;mage|0.6261|0.0178|1#"})
    assert d == [{"champion_ids": [157, 17], "roles": ["fighter", "mage"], "win_rate": 0.6261, "pick_rate": 0.0178, "rank": 1}]


def test_item_ids_map_stormrazor(builds_py):
    """f5e6bf36: the stats source's 3097 is Stormrazor, 3095 in the game client."""
    assert builds_py.item_ids("3097,3006") == [STORMRAZOR, 3006]
    assert builds_py.item_ids("3097&0&x&3153") == [STORMRAZOR, 3153]
    assert builds_py.item_ids("") == []


def test_build_parsers(builds_py):
    b = builds_py
    assert b.ratio("5287", True) == 0.5287 and b.ratio("0.12345") == 0.1235 and b.ratio(None) is None
    assert b.parse_dollar_list("1036,3177$0.0431$0.5424#3097$0.1$0.5#$0.2$0.3") == [
        {"items": [1036, 3177], "pick_rate": 0.0431, "win_rate": 0.5424},
        {"items": [STORMRAZOR], "pick_rate": 0.1, "win_rate": 0.5}]
    core = b.parse_json_list('{"1": {"itemcore": "3097&6676", "showrate": 1000, "winrate": 5000},'
                             ' "2": {"itemcore": "3031&3036", "showrate": 2500, "winrate": 5100}}', "itemcore")
    assert core == [{"items": [3031, 3036], "pick_rate": 0.25, "win_rate": 0.51},
                    {"items": [STORMRAZOR, 6676], "pick_rate": 0.1, "win_rate": 0.5}]
    assert b.parse_json_list("not json", "itemcore") == []
    assert b.parse_full_builds("1_3097,3006_0.05_0.53;2__0.1_0.5;bad") == [
        {"items": [STORMRAZOR, 3006], "pick_rate": 0.05, "win_rate": 0.53}]
    augs = b.parse_augments("255:1|104|1336|x|0.2345|S#2|104|1077|x|0.22|A&kGold:1|104|1077|x|0.22&bogus:1|1|1|1|1")
    assert augs["all"] == [{"id": 1336, "pick_rate": 0.2345, "grade": "S"}, {"id": 1077, "pick_rate": 0.22, "grade": "A"}]
    assert augs["gold"] == [{"id": 1077, "pick_rate": 0.22, "grade": ""}]
    assert augs["silver"] == augs["prismatic"] == []
    skills = b.parse_skills('{"a": {"qwe": "1&3&2", "qwe_s": 3954, "qwe_w": 5323,'
                            ' "sks": {"x": {"sk": "1&2&3&1", "sk_s": 1369, "sk_w": 5333}}},'
                            ' "b": {"qwe": "3&1&2", "qwe_s": 4100, "qwe_w": 5000}}')
    assert [s["max_order"] for s in skills] == [["E", "Q", "W"], ["Q", "E", "W"]]
    assert skills[1]["orders"] == [{"order": ["Q", "W", "E", "Q"], "pick_rate": 0.1369, "win_rate": 0.5333}]
    assert b.parse_partners("4|0.5978|0.0315#x|1|1#25|0.58") == [{"id": 4, "win_rate": 0.5978, "pick_rate": 0.0315}]


def _days(spec):
    """{date: {champion: {"win_rate": w, "pick_rate": p, ...}}} from {date: (win_a, win_b)}."""
    out = {}
    for d, (wa, wb) in spec.items():
        out[d] = {"1": {"win_rate": wa, "pick_rate": 0.1}, "2": {"win_rate": wb, "pick_rate": 0.1}}
    return out


def test_history_windows_find_patch_reset(history_py):
    d0 = dt.date(2026, 1, 1)
    spec = {}
    for n in range(20):
        wiggle = 0.001 * (n % 2)
        jump = 0.2 if n >= 12 else 0  # the new patch's window opens on day 12, two days after its release
        spec[d0 + dt.timedelta(n)] = (0.5 + wiggle + jump, 0.5 - wiggle - jump)
    wins = history_py.windows(_days(spec), [("1.1", d0 - dt.timedelta(5)), ("1.2", d0 + dt.timedelta(10)),
                                            ("9.9", d0 + dt.timedelta(400))])
    assert [w[0] for w in wins] == ["1.1", "1.2"]  # a patch released after the data is skipped
    name, released, opened, first, last = wins[1]
    assert released == d0 + dt.timedelta(10)
    assert opened == first == d0 + dt.timedelta(12)
    assert last == d0 + dt.timedelta(19)
    assert wins[0][3] == d0 and wins[0][4] == d0 + dt.timedelta(11)


def test_query_stats_whole_window_and_range(query_py):
    w = {"patch": "1.1", "opened": dt.date(2026, 1, 1), "first": dt.date(2026, 1, 1), "last": dt.date(2026, 1, 4)}
    days = {}
    for n in range(4):
        d = dt.date(2026, 1, 1 + n)
        days[d] = {"7": {"win_rate": 0.5, "pick_rate": 0.2, "avg_damage_ratio": 0.2, "avg_tank_ratio": 0.1,
                         "avg_participation_rate": 0.5, "avg_death_time": 100.0}}
    rows, n = query_py.stats(days, [w], {"7": ("Ziggs", "")}, dt.date.min, dt.date.max)
    assert n == 4
    assert rows == [{"champion_id": "7", "name": "Ziggs", "name_cn": "", "pick_rate": 0.2, "est_game_share": 0.02,
                     "win_rate": 0.5, "avg_damage_ratio": 0.2, "avg_tank_ratio": 0.1, "avg_participation_rate": 0.5,
                     "avg_death_time": 100.0, "win_rate_rank": 1}]
    # a range inside the window is the difference of running totals
    rows, n = query_py.stats(days, [w], {}, dt.date(2026, 1, 3), dt.date(2026, 1, 4))
    assert n == 2 and rows[0]["pick_rate"] == pytest.approx(0.2) and rows[0]["name"] == "7"
    assert query_py.stats(days, [w], {}, dt.date(2027, 1, 1), dt.date(2027, 2, 1)) == ([], 0)


def test_cn_json_numbers_finite(champs_json, augs_json):
    for body in (champs_json, augs_json):
        for path, n in walk_numbers(body):
            assert math.isfinite(n), path


# ---------- item history (item_history.py) ----------

def test_item_history_one_file_per_known_patch():
    patches = [p["patch"] for p in read_csv("history/patches.csv")]
    files = sorted(glob.glob(os.path.join(CN, "history", "items", "*.json")))
    assert files, "history/items/ should hold at least the live patch"
    known = {str(i) for i in champion_ids()}
    ids = known if all(i.isdigit() for i in known) else None
    for f in files:
        data = load_json(os.path.relpath(f, REPO))
        assert data["patch"] in patches and os.path.basename(f) == f"{data['patch']}.json"
        assert len(data["champions"]) > 100
        for cid, lists in data["champions"].items():
            assert ids is None or cid in ids
            assert set(lists) <= {"starting", "boots", "other"}
            for rows in lists.values():
                for items, pick, win in rows:
                    assert items and all(isinstance(i, int) for i in items)
                    assert is_rate(pick) and (win is None or is_rate(win))


def test_item_history_picks_the_patch_window():
    mod = load_module("data/cn/item_history.py", "item_history")
    windows = [{"patch": "16.20", "window_start": "2026-10-12"}, {"patch": "16.21", "window_start": "2026-10-22"}]
    assert mod.patch_of("2026-10-21", windows) == "16.20"
    assert mod.patch_of("2026-10-22", windows) == "16.21"
    assert mod.patch_of("2026-10-01", windows) is None
    snap = mod.snapshot([{"id": 1, "items": {"boots": [{"items": [3020], "pick_rate": 0.5, "win_rate": 0.49}], "core": []}}])
    assert snap == {"1": {"starting": [], "boots": [[[3020], 0.5, 0.49]], "other": []}}
