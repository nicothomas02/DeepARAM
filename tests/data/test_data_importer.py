"""My Stats importer (importer/mayhem_import.py): archive handling, match-id paging, kill maps and anonymised
sharing, with synthetic matches from fixtures/importer/. Nothing here touches the network, curl or a League client:
every call that would is replaced by a fake."""
import copy
import datetime as dt
import json
import os
import subprocess
from types import SimpleNamespace

import pytest

from deeparam_data_helpers import FIXTURES, load_module

FX = os.path.join(FIXTURES, "importer")
ME = "puuid-me-0000"


def fixture(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def mi():
    return load_module("importer/mayhem_import.py", "deeparam_mayhem_import")


@pytest.fixture(autouse=True)
def offline(mi, monkeypatch, tmp_path):
    """No subprocess (curl, ps), no sleeping, and per-user files moved into tmp_path."""
    def no_subprocess(*a, **k):
        raise AssertionError(f"test tried to run a subprocess: {a[0] if a else k}")
    monkeypatch.setattr(mi.subprocess, "run", no_subprocess)
    monkeypatch.setattr(mi.time, "sleep", lambda s: None)
    monkeypatch.setattr(mi, "SHARING_FILE", str(tmp_path / "support" / "sharing.json"))
    monkeypatch.setattr(mi, "HISTORY_FILE", str(tmp_path / "support" / "history.json"))
    monkeypatch.setattr(mi, "ASSET_CACHE", str(tmp_path / "cache"))
    monkeypatch.setenv("MAYHEM_LCU_CA", str(tmp_path / "ca.pem"))


class FakeLcu:
    """Answers the local client API paths the importer reads, from fixtures."""

    def __init__(self, mi, games=(), timelines=None, puuid=ME, region="NA"):
        self.mi = mi
        self.games = {g["gameId"]: g for g in games}
        self.timelines = timelines or {}
        self.puuid = puuid
        self.region = region
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        if path == "/lol-summoner/v1/current-summoner":
            return {"puuid": self.puuid, "gameName": "Tester", "tagLine": "NA1"}
        if path == "/lol-rso-auth/v1/authorization/access-token":
            return {"token": "rso-token"}
        if path == "/riotclient/region-locale":
            return {"region": self.region}
        if path.startswith("/lol-match-history/v1/games/"):
            gid = int(path.rsplit("/", 1)[1])
            if gid not in self.games:
                raise self.mi.HttpError(404, path)
            return copy.deepcopy(self.games[gid])
        if path.startswith("/lol-match-history/v1/game-timelines/"):
            gid = int(path.rsplit("/", 1)[1])
            t = self.timelines.get(gid)
            if isinstance(t, Exception):
                raise t
            if t is None:
                raise self.mi.HttpError(404, path)
            return t
        raise AssertionError(f"unexpected client call {path}")


def fake_sgp(pages_by_tags):
    """sgp_get replacement: pages_by_tags maps the tag string to the full newest-first id list."""
    calls = []

    def sgp_get(host, puuid, token, start, count, tags="tagsQueryType=AND", timeout=30):
        calls.append((start, count, tags))
        ids = pages_by_tags.get(tags, [])
        return [f"NA1_{i}" for i in ids[start:start + count]]
    sgp_get.calls = calls
    return sgp_get


# ---------- import is side-effect free ----------

def test_import_has_no_side_effects(monkeypatch):
    """The script can be imported (as these tests do) without starting an import, a server or curl."""
    def refuse(*a, **k):
        raise AssertionError("import ran a subprocess")
    monkeypatch.setattr(subprocess, "run", refuse)
    import importlib.util
    spec = importlib.util.spec_from_file_location("deeparam_mayhem_import_fresh",
                                                  os.path.join(os.path.dirname(FIXTURES), "..", "..", "importer",
                                                               "mayhem_import.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.MAYHEM_QUEUE_IDS == (2400, 2450)


# ---------- client discovery ----------

def test_find_client_reads_lockfile(mi):
    lcu = mi.find_client(os.path.join(FX, "lockfile"))
    assert lcu.base == "https://127.0.0.1:54321"
    import base64
    assert lcu.auth == "Basic " + base64.b64encode(b"riot:s3cret-Pass_word").decode()
    assert lcu.cacert == os.environ["MAYHEM_LCU_CA"]


def test_find_client_bad_lockfile(mi):
    with pytest.raises(mi.ImportFailed):
        mi.find_client(os.path.join(FX, "lockfile_bad"))
    with pytest.raises(mi.ImportFailed):
        mi.find_client(os.path.join(FX, "no-such-lockfile"))


# ---------- match-history paging ----------

def test_sgp_url(mi):
    url = mi.sgp_url("https://host", "abc", 200, 200, mi.SGP_MAYHEM_TAGS)
    assert url == ("https://host/match-history-query/v1/products/lol/player/abc?startIndex=200&count=200"
                   "&tag=q_2400&tag=q_2450&tagsQueryType=OR")


def test_walk_ids_pages_until_short_page(mi, monkeypatch):
    ids = list(range(1000, 1000 - 450, -1))
    sgp = fake_sgp({"T": ids})
    monkeypatch.setattr(mi, "sgp_get", sgp)
    got, stop = mi.walk_ids("h", ME, "tok", "T", known=set(), full=False)
    assert got == ids and stop == "exhausted"
    assert [c[0] for c in sgp.calls] == [0, 200, 400]


def test_walk_ids_stops_at_known_page_unless_full(mi, monkeypatch):
    ids = list(range(5000, 5000 - 600, -1))
    known = set(ids[200:])  # everything past the first page is already archived
    monkeypatch.setattr(mi, "sgp_get", fake_sgp({"T": ids}))
    got, stop = mi.walk_ids("h", ME, "tok", "T", known, full=False)
    assert stop == "known" and got == ids[:400]
    got, stop = mi.walk_ids("h", ME, "tok", "T", known, full=True)
    assert stop == "exhausted" and got == ids


def test_walk_ids_skips_malformed_and_hits_page_limit(mi, monkeypatch):
    def sgp_get(host, puuid, token, start, count, tags="", timeout=30):
        return ["NA1_bad"] + [f"EUW1_{start + i}" for i in range(count - 1)]
    monkeypatch.setattr(mi, "sgp_get", sgp_get)
    got, stop = mi.walk_ids("h", ME, "tok", "T", set(), full=True)
    assert stop == "page-limit"
    assert len(got) == mi.SGP_MAX_PAGES * (mi.SGP_PAGE_SIZE - 1)
    assert all(isinstance(i, int) for i in got)


def test_walk_ids_empty(mi, monkeypatch):
    monkeypatch.setattr(mi, "sgp_get", lambda *a, **k: None)
    assert mi.walk_ids("h", ME, "tok", "T", set(), False) == ([], "exhausted")


def test_history_window_full(mi, monkeypatch):
    monkeypatch.setattr(mi, "sgp_get", lambda h, p, t, start, count, tags=None, timeout=30: ["x"] if start < 1000 else [])
    assert mi.history_window_full("h", ME, "tok") is True
    monkeypatch.setattr(mi, "sgp_get", lambda *a, **k: [])
    assert mi.history_window_full("h", ME, "tok") is False

    def boom(*a, **k):
        raise mi.HttpError(500, "u")
    monkeypatch.setattr(mi, "sgp_get", boom)
    assert mi.history_window_full("h", ME, "tok") is False


def test_find_sgp_host_tries_region_guess_first(mi, monkeypatch):
    tried = []

    def sgp_get(host, *a, **k):
        tried.append(host)
        if host != mi.SGP_HOST_BY_REGION["EUW"]:
            raise ConnectionError("nope")
        return []
    monkeypatch.setattr(mi, "sgp_get", sgp_get)
    lcu = FakeLcu(mi, region="euw")
    assert mi.find_sgp_host(lcu, ME, "tok") == mi.SGP_HOST_BY_REGION["EUW"]
    assert tried == [mi.SGP_HOST_BY_REGION["EUW"]]
    assert mi.find_sgp_host(lcu, ME, "tok", override="https://x") == "https://x"
    monkeypatch.setattr(mi, "sgp_get", lambda *a, **k: (_ for _ in ()).throw(mi.HttpError(403, "u")))
    with pytest.raises(mi.ImportFailed):
        mi.find_sgp_host(FakeLcu(mi, region="??"), ME, "tok")


# ---------- archive file ----------

def test_load_archive_shapes(mi, tmp_path):
    assert mi.load_archive(str(tmp_path / "missing.json")) == (None, [])
    g = fixture("lcu_game_mayhem.json")
    for body, games_key in (([g], None), ({"games": [g]}, "games"), ({"matches": [g]}, "matches"), ({"data": [g]}, "data")):
        p = tmp_path / "a.json"
        p.write_text(json.dumps(body))
        container, games = mi.load_archive(str(p))
        assert games == [g]
        assert container == body
    p.write_text(json.dumps({"something": 1}))
    with pytest.raises(mi.ImportFailed):
        mi.load_archive(str(p))


def test_archive_owner(mi):
    g1 = fixture("lcu_game_mayhem.json")
    g2 = fixture("lcu_game_old.json")
    for pi in g2["participantIdentities"]:  # different teammates; only the owner is in both games
        if pi["player"]["puuid"] != ME:
            pi["player"]["puuid"] += "-b"
    assert mi.archive_owner({"puuid": "explicit"}, [g1, g2]) == "explicit"
    assert mi.archive_owner([g1, g2], [g1, g2]) == ME
    assert mi.archive_owner({"games": [g2, g1]}, [g2, g1]) == ME
    assert mi.archive_owner(None, []) is None


def test_save_archive_dict_container(mi, tmp_path):
    old, new = fixture("lcu_game_old.json"), fixture("lcu_game_mayhem.json")
    path = tmp_path / "backup.json"
    container = {"games": [], "note": "kept"}
    mi.save_archive(str(path), container, [old, new], {"puuid": ME, "gameName": "Tester", "tagLine": "NA1"})
    out = json.loads(path.read_text())
    assert [g["gameId"] for g in out["games"]] == [new["gameId"], old["gameId"]]  # newest first
    assert out["puuid"] == ME and out["gameName"] == "Tester" and out["note"] == "kept"
    dt.datetime.fromisoformat(out["updatedAt"])
    assert [p.name for p in tmp_path.iterdir()] == ["backup.json"]  # no temp file left behind


def test_save_archive_keeps_list_and_existing_owner(mi, tmp_path):
    g = fixture("lcu_game_mayhem.json")
    path = tmp_path / "list.json"
    mi.save_archive(str(path), [], [g], {"puuid": ME})
    assert json.loads(path.read_text()) == [g]
    path2 = tmp_path / "owned.json"
    mi.save_archive(str(path2), {"puuid": "original", "matches": []}, [g], {"puuid": ME})
    out = json.loads(path2.read_text())
    assert out["puuid"] == "original" and out["matches"] == [g] and "games" not in out


def test_save_archive_failure_keeps_old_file(mi, tmp_path, monkeypatch):
    path = tmp_path / "keep.json"
    path.write_text('["old"]')

    def broken_dump(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(mi.json, "dump", broken_dump)
    with pytest.raises(RuntimeError):
        mi.save_archive(str(path), [], [], {"puuid": ME})
    assert path.read_text() == '["old"]'
    assert [p.name for p in tmp_path.iterdir()] == ["keep.json"]


# ---------- kill maps ----------

def test_compact_kills(mi):
    kills = mi.compact_kills(fixture("timeline.json"))
    assert kills == [[61, 4100, 4200, 1, 7], [76, 6000, 6100, 8, 2], [121, 8000, 8000, 0, 4]]
    assert mi.compact_kills(None) == [] and mi.compact_kills({}) == []


def test_fill_kill_maps(mi):
    a, b, c, d = (dict(fixture("lcu_game_mayhem.json"), gameId=i) for i in (1, 2, 3, 4))
    d["killMap"] = [[1, 2, 3, 4, 5]]
    lcu = FakeLcu(mi, timelines={1: fixture("timeline.json"), 2: None, 3: ConnectionError("down")})
    changed = mi.fill_kill_maps(lcu, [a, b, c, d], progress=lambda m: None)
    assert changed == 2
    assert len(a["killMap"]) == 3
    assert b["killMap"] is None  # the client has no timeline: never asked again
    assert "killMap" not in c  # a later run retries it
    assert d["killMap"] == [[1, 2, 3, 4, 5]]
    assert not any(p.endswith("/4") for p in lcu.calls)
    assert mi.fill_kill_maps(lcu, [d], progress=lambda m: None) == 0


def test_fill_kill_maps_respects_limit(mi):
    games = [dict(fixture("lcu_game_mayhem.json"), gameId=i) for i in range(1, 6)]
    lcu = FakeLcu(mi, timelines={i: fixture("timeline.json") for i in range(1, 6)})
    assert mi.fill_kill_maps(lcu, games, progress=lambda m: None, limit=2) == 2
    assert sum("killMap" in g for g in games) == 2


# ---------- end to end import with a fake client ----------

def setup_import(mi, monkeypatch, lcu, ids_by_tags):
    monkeypatch.setattr(mi, "find_client", lambda lockfile=None: lcu)
    sgp = fake_sgp(ids_by_tags)
    monkeypatch.setattr(mi, "sgp_get", sgp)
    return sgp


def test_run_import_merges_new_mayhem_games(mi, monkeypatch, tmp_path):
    old, new, aram = fixture("lcu_game_old.json"), fixture("lcu_game_mayhem.json"), fixture("lcu_game_aram.json")
    path = tmp_path / "backup.json"
    path.write_text(json.dumps({"puuid": ME, "games": [old]}))
    lcu = FakeLcu(mi, games=[old, new, aram], timelines={new["gameId"]: fixture("timeline.json")})
    lcu.games[old["gameId"]]["killMap"] = []
    setup_import(mi, monkeypatch, lcu, {mi.SGP_MAYHEM_TAGS: [new["gameId"], aram["gameId"], old["gameId"]]})
    log = []
    summary = mi.run_import(str(path), sgp_host="https://sgp.test", progress=log.append)
    assert summary["added"] == 1 and summary["failed"] == 0 and summary["total"] == 2
    assert summary["account"] == "Tester#NA1"
    out = json.loads(path.read_text())
    assert [g["gameId"] for g in out["games"]] == [new["gameId"], old["gameId"]]
    assert all(g["queueId"] in mi.MAYHEM_QUEUE_IDS for g in out["games"])  # the ARAM game is fetched but not kept
    assert out["games"][0]["killMap"] == mi.compact_kills(fixture("timeline.json"))
    assert f"/lol-match-history/v1/games/{old['gameId']}" not in lcu.calls  # known games aren't refetched


def test_run_import_falls_back_to_all_games_when_filter_is_empty(mi, monkeypatch, tmp_path):
    new = fixture("lcu_game_mayhem.json")
    lcu = FakeLcu(mi, games=[new], timelines={new["gameId"]: fixture("timeline.json")})
    sgp = setup_import(mi, monkeypatch, lcu, {mi.SGP_ALL_TAGS: [new["gameId"]]})
    path = tmp_path / "fresh.json"
    summary = mi.run_import(str(path), sgp_host="https://sgp.test", progress=lambda m: None)
    assert summary["added"] == 1
    assert {c[2] for c in sgp.calls} >= {mi.SGP_MAYHEM_TAGS, mi.SGP_ALL_TAGS}
    out = json.loads(path.read_text())
    assert out["puuid"] == ME and len(out["games"]) == 1


def test_run_import_counts_failures_and_keeps_going(mi, monkeypatch, tmp_path):
    new = fixture("lcu_game_mayhem.json")
    lcu = FakeLcu(mi, games=[new], timelines={new["gameId"]: fixture("timeline.json")})
    setup_import(mi, monkeypatch, lcu, {mi.SGP_MAYHEM_TAGS: [999, new["gameId"]]})  # 999 isn't on the client
    summary = mi.run_import(str(tmp_path / "b.json"), sgp_host="h", progress=lambda m: None)
    assert summary["added"] == 1 and summary["failed"] == 1
    assert any("couldn't be fetched" in n for n in summary["notes"])


def test_run_import_refuses_another_accounts_archive(mi, monkeypatch, tmp_path):
    path = tmp_path / "theirs.json"
    path.write_text(json.dumps({"puuid": "someone-else", "games": []}))
    lcu = FakeLcu(mi)
    setup_import(mi, monkeypatch, lcu, {})
    with pytest.raises(mi.ImportFailed, match="different account"):
        mi.run_import(str(path), sgp_host="h", progress=lambda m: None)
    assert json.loads(path.read_text()) == {"puuid": "someone-else", "games": []}


def test_run_import_nothing_new_leaves_file_untouched(mi, monkeypatch, tmp_path):
    old = fixture("lcu_game_old.json")
    old["killMap"] = []
    path = tmp_path / "same.json"
    path.write_text(json.dumps({"puuid": ME, "games": [old]}))
    before = path.read_text()
    setup_import(mi, monkeypatch, FakeLcu(mi, games=[old]), {mi.SGP_MAYHEM_TAGS: [old["gameId"]]})
    summary = mi.run_import(str(path), sgp_host="h", progress=lambda m: None)
    assert summary["added"] == 0 and path.read_text() == before


# ---------- anonymised sharing ----------

def test_anonymise_strips_identity(mi):
    g = fixture("lcu_game_mayhem.json")
    a = mi.anonymise(g)
    text = json.dumps(a)
    for p in mi.game_puuids(g):
        assert p not in text
    assert "Player" not in text and "summonerId" not in text and "NA1#" not in text
    assert a["id"] == str(g["gameId"]) and a["platform"] == "na1" and a["patch"] == "16.20"
    assert a["queue"] == 2400 and a["duration"] == 1100
    assert a["played"] == dt.datetime.fromtimestamp(g["gameCreation"] / 1000, dt.timezone.utc).strftime("%Y-%m-%d")
    assert len(a["players"]) == 10
    order = [(p["team"], p["champ"]) for p in a["players"]]
    assert order == sorted(order)  # fixed order, so the uploader can't be picked out by position
    p0 = next(p for p in a["players"] if p["champ"] == 115)
    assert p0["augs"] == [1134, 1084] and 0 not in p0["augs"]
    assert p0["items"] == [3006, 3095, 3115] and p0["cs"] == 42 and p0["multi"] == [1, 0, 0, 0]
    assert p0["perks"] == [8005, 9111] and p0["spells"] == [4, 32] and p0["styles"] == [8000, 8100]
    assert [t["win"] for t in a["teams"]] == [True, False]


def test_anonymise_converts_millisecond_durations_and_rejects_bad_games(mi):
    g = fixture("lcu_game_mayhem.json")
    g["gameDuration"] = 1_100_400
    assert mi.anonymise(g)["duration"] == 1100
    assert mi.anonymise(dict(g, gameVersion="")) is None
    assert mi.anonymise(dict(g, gameCreation=0)) is None
    assert mi.anonymise({k: v for k, v in g.items() if k != "gameId"}) is None


def test_sharing_settings_defaults_and_roundtrip(mi):
    assert mi.sharing_settings() == {"enabled": False, "shared": []}
    mi.save_sharing({"enabled": True, "shared": ["1", "2"]})
    assert mi.sharing_settings() == {"enabled": True, "shared": ["1", "2"]}
    with open(mi.SHARING_FILE, "w") as f:
        f.write("{broken")
    assert mi.sharing_settings() == {"enabled": False, "shared": []}


def test_share_new_games_is_off_by_default(mi, tmp_path):
    assert mi.share_new_games(str(tmp_path / "x.json")) is None


def test_share_new_games_sends_anonymised_batches(mi, monkeypatch, tmp_path):
    games = [dict(fixture("lcu_game_mayhem.json"), gameId=i) for i in range(1, mi.SHARE_BATCH + 3)]
    games.append(dict(fixture("lcu_game_mayhem.json"), gameId=999, gameVersion=""))  # unusable: dropped
    path = tmp_path / "b.json"
    path.write_text(json.dumps(games))
    mi.save_sharing({"enabled": True, "shared": ["1"]})
    monkeypatch.setattr(mi, "find_client", lambda lockfile=None: FakeLcu(mi))
    sent = []

    def site_post(lcu, path_, payload):
        sent.append(payload)
        return {"shared": 7}
    monkeypatch.setattr(mi, "site_post", site_post)
    total = mi.share_new_games(str(path), progress=lambda m: None)
    assert total == 7
    shared_ids = [g["id"] for p in sent for g in p["games"]]
    assert "1" not in shared_ids and "999" not in shared_ids
    assert len(shared_ids) == len(games) - 2
    assert all(len(p["games"]) <= mi.SHARE_BATCH for p in sent)
    assert ME not in json.dumps(sent)
    assert set(mi.sharing_settings()["shared"]) == {str(g["gameId"]) for g in games}


def test_save_new_history_is_off_by_default(mi, tmp_path):
    assert mi.history_settings() == {"enabled": False, "saved": []}
    assert mi.save_new_history(str(tmp_path / "x.json")) is None


def test_private_game_keeps_only_the_players_own_stats(mi):
    game = dict(fixture("lcu_game_mayhem.json"), killMap=[[60, 100, 200, 1, 6]])
    g = mi.private_game(game, ME)
    mine = [p for p in g["participants"] if p.get("puuid") == "me"]
    assert len(mine) == 1 and len(g["participants"]) == len(game["participants"])
    assert set(mine[0]["stats"]) == set(mi.HISTORY_STATS)
    others = [p for p in g["participants"] if p.get("puuid") != "me"]
    assert all(set(p) == {"participantId", "teamId", "championId"} for p in others)
    assert ME not in json.dumps(g) and "participantIdentities" not in g
    assert g["killMap"] == [[60, 100, 200, 1, 6]]
    assert mi.private_game(game, "someone-else") is None


def test_save_new_history_sends_new_games_in_batches(mi, monkeypatch, tmp_path):
    games = [dict(fixture("lcu_game_mayhem.json"), gameId=i) for i in range(1, mi.HISTORY_BATCH + 3)]
    path = tmp_path / "h.json"
    path.write_text(json.dumps(games))
    mi.save_history_settings({"enabled": True, "saved": ["1"]})
    monkeypatch.setattr(mi, "find_client", lambda lockfile=None: FakeLcu(mi))
    sent = []

    def site_post(lcu, path_, payload):
        sent.append((path_, payload))
        return {"saved": 5}
    monkeypatch.setattr(mi, "site_post", site_post)
    assert mi.save_new_history(str(path), progress=lambda m: None) == 5
    ids = [g["gameId"] for _, p in sent for g in p["games"]]
    assert 1 not in ids and len(ids) == len(games) - 1
    assert all(path_ == "/api/history" and p["action"] == "save" and len(p["games"]) <= mi.HISTORY_BATCH for path_, p in sent)
    assert ME not in json.dumps(sent)
    assert set(mi.history_settings()["saved"]) == {str(g["gameId"]) for g in games}


# ---------- local helper server ----------

def test_site_asset_rejects_paths_outside_assets(mi):
    # these must be refused before any download is attempted (subprocess is disabled in these tests)
    for bad in ("/assets/../../etc/passwd", "/etc/passwd", "/api/profile", "assets/../x", "/assets/cd/../../secret"):
        assert mi.site_asset(bad) is None, bad


def test_site_asset_serves_cache(mi):
    cached = os.path.join(mi.ASSET_CACHE, "assets", "fonts", "fonts.css")
    os.makedirs(os.path.dirname(cached))
    with open(cached, "wb") as f:
        f.write(b"body{}")
    assert mi.site_asset("/assets/fonts/fonts.css") == b"body{}"


def test_site_asset_fetches_translations_fresh_and_keeps_a_copy(mi, monkeypatch):
    calls = []

    def curl(cmd, **k):
        calls.append(cmd[-1])
        return SimpleNamespace(returncode=0 if len(calls) == 1 else 22, stdout=b'{"Win rate":"Taux de victoire"}')
    monkeypatch.setattr(mi.subprocess, "run", curl)
    assert mi.site_asset("/i18n/stats/fr.json") == b'{"Win rate":"Taux de victoire"}'
    # offline the next time: the saved copy is used
    assert mi.site_asset("/i18n/stats/fr.json") == b'{"Win rate":"Taux de victoire"}'
    assert calls == ["https://deeparam.com/i18n/stats/fr.json"] * 2
    assert mi.site_asset("/i18n/../secret") is None


def test_platform_ids(mi):
    assert set(mi.PLATFORM_BY_REGION.values()) <= {"na1", "br1", "la1", "la2", "euw1", "eun1", "tr1", "ru", "me1",
                                                    "kr", "jp1", "oc1", "sg2", "tw2", "vn2"}
    assert mi.PLATFORM_BY_REGION["NA"] == "na1"


def test_site_post_refuses_unknown_region(mi):
    with pytest.raises(mi.ImportFailed, match="region"):
        mi.site_post(FakeLcu(mi, region="XX"), "/api/games", {})


# ---------- live game recording ----------

def live_frame(t, augments=None, end=False):
    me = {"riotId": "Me#1", "level": 3, "currentGold": 500.0,
          "championStats": {"attackDamage": 70, "abilityPower": 10, "maxHealth": 900},
          "abilities": {"Q": {"abilityLevel": 2}, "Passive": {}}}
    if augments:
        me["augments"] = augments
    events = [{"EventName": "GameStart", "EventTime": 0.0}]
    if end:
        events.append({"EventName": "GameEnd", "EventTime": t, "Result": "Win"})
    return {"activePlayer": me, "events": {"Events": events},
            "gameData": {"gameTime": t, "gameMode": "KIWI", "mapNumber": 12, "mapTerrain": "Default"},
            "allPlayers": [{"riotId": "Me#1", "championName": "Ahri", "team": "ORDER", "level": 3,
                            "items": [{"slot": 0, "itemID": 1056, "count": 1}], "scores": {"kills": 1},
                            "summonerSpells": {"summonerSpellOne": {
                                "rawDisplayName": "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName"}},
                            "runes": {"keystone": {"id": 8112}}}]}


def test_live_recorder_saves_one_file_per_game(mi, tmp_path):
    import threading
    frames = iter([None, {"activePlayer": {}}, live_frame(5), live_frame(15, [101]),
                   live_frame(25, [101, 202]), live_frame(35, [101, 202], end=True)])
    stop = threading.Event()
    stop.wait = lambda s: None

    def fetch():
        f = next(frames, "done")
        if f == "done":
            stop.set()
            return None
        if f is None:
            raise ConnectionError("no game")
        return f

    status = {}
    mi.live_recorder(stop, status, fetch=fetch, folder=str(tmp_path / "live"), progress=lambda m: None)
    recs = mi.live_recordings(str(tmp_path / "live"))
    assert len(recs) == 1 and status["recording"] is None
    r = recs[0]
    assert r["complete"] and r["version"] == mi.LIVE_FORMAT and r["gameTime"] == 35
    assert r["player"] == {"riotId": "Me#1", "champion": "Ahri", "team": "ORDER"}
    assert [s["augments"] for s in r["snapshots"]] == [[], [101], [101, 202], [101, 202]]
    assert r["snapshots"][0]["abilities"] == {"Q": 2} and r["snapshots"][0]["items"] == [[0, 1056, 1]]
    assert r["players"][0]["spells"] == ["SummonerFlash"] and r["players"][0]["keystone"] == 8112
    assert r["events"][-1] == {"t": 35, "name": "GameEnd", "result": "Win"}


def test_live_recording_closed_mid_game_is_kept(mi, tmp_path):
    import threading
    frames = iter([live_frame(5), live_frame(15), None])
    stop = threading.Event()
    stop.wait = lambda s: None

    def fetch():
        f = next(frames, "done")
        if f == "done":
            stop.set()
        if not isinstance(f, dict):
            raise ConnectionError("closed")
        return f

    mi.live_recorder(stop, {}, fetch=fetch, folder=str(tmp_path), progress=lambda m: None)
    (r,) = mi.live_recordings(str(tmp_path))
    assert r["complete"] and len(r["snapshots"]) == 2


def test_link_sends_only_the_code(mi, monkeypatch):
    sent = []
    monkeypatch.setattr(mi, "find_client", lambda lockfile=None: None)
    monkeypatch.setattr(mi, "site_post", lambda lcu, path, payload: sent.append((path, payload)) or {"linked": True, "riotId": "Me#1"})
    assert mi.site_profile("link", {"games": 5}, code="AB12CD34") == {"linked": True, "riotId": "Me#1"}
    assert sent == [("/api/profile", {"action": "link", "code": "AB12CD34"})]


class CollectionLcu(FakeLcu):
    def get(self, path):
        if path == "/lol-summoner/v1/current-summoner":
            self.calls.append(path)
            return {"puuid": self.puuid, "gameName": "Tester", "tagLine": "NA1", "summonerId": 42}
        if path == "/lol-champions/v1/inventories/42/champions-minimal":
            return [{"id": 103, "ownership": {"owned": True}}, {"id": 1, "ownership": {"owned": False, "rental": {"rented": True}}},
                    {"id": -1, "ownership": {"owned": True}}]
        if path == "/lol-champions/v1/inventories/42/skins-minimal":
            return [{"id": 103001, "ownership": {"owned": True}}, {"id": 103002, "ownership": {"owned": False}}]
        return super().get(path)


def test_run_import_saves_owned_champions_and_skins(mi, monkeypatch, tmp_path):
    old = fixture("lcu_game_old.json")
    path = tmp_path / "backup.json"
    path.write_text(json.dumps({"puuid": ME, "games": [dict(old, killMap=[])]}))
    lcu = CollectionLcu(mi, games=[old])
    setup_import(mi, monkeypatch, lcu, {mi.SGP_MAYHEM_TAGS: [old["gameId"]]})
    summary = mi.run_import(str(path), sgp_host="h", progress=lambda m: None)
    assert summary["added"] == 0
    out = json.loads(path.read_text())  # saved even with no new games, because the collection changed
    assert out["owned"] == {"champions": [103], "skins": [103001]}


def test_pair_opens_the_account_page_on_the_site_only(mi, monkeypatch):
    import webbrowser
    opened, sent = [], []
    monkeypatch.setattr(webbrowser, "open", opened.append)
    monkeypatch.setattr(mi, "find_client", lambda lockfile=None: FakeLcu(mi))
    replies = iter([{"pair": "a" * 32, "connect": "/account?connect=" + "a" * 32 + "#my-stats"},
                    {"pair": "b" * 32, "connect": "https://elsewhere.example/"}])

    def site_post(lcu, path_, payload):
        sent.append(payload)
        return next(replies)
    monkeypatch.setattr(mi, "site_post", site_post)
    assert mi.site_profile("pair")["url"] == mi.SITE + "/account?connect=" + "a" * 32 + "#my-stats"
    mi.site_profile("pair")  # anything but the account page isn't opened
    assert opened == [mi.SITE + "/account?connect=" + "a" * 32 + "#my-stats"]
    assert sent[0] == {"action": "pair", "pair": None}


def test_my_pick_names_the_players_champion_and_result(mi):
    game = {"participantIdentities": [{"participantId": 1, "player": {"puuid": "x"}}, {"participantId": 2, "player": {"puuid": "me"}}],
            "participants": [{"participantId": 1, "championId": 10, "stats": {"win": False}},
                             {"participantId": 2, "championId": 22, "stats": {"win": True}}]}
    assert mi.my_pick(game, "me") == {"champion": 22, "win": True}
    assert mi.my_pick(game, "nobody") is None


def test_kill_positions_are_fetched_several_at_a_time(mi):
    import time

    class SlowLcu:
        def get(self, path):
            time.sleep(0.2)
            if path.endswith("/3"):
                raise mi.HttpError(404, "missing")
            return {"frames": []}
    games = [{"gameId": i} for i in range(1, 13)]
    start = time.monotonic()
    assert mi.fill_kill_maps(SlowLcu(), games, progress=lambda m: None) == 12
    assert time.monotonic() - start < 12 * 0.2 / 2  # one by one would take 2.4 s
    assert games[2]["killMap"] is None and games[0]["killMap"] == []
