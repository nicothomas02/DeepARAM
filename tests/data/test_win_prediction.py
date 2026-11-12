"""Win-prediction analysis (analysis/win-prediction/): the draft table keeps nothing that identifies a player,
reads the helper archive and the shared pool the same way, and the committed notebook holds only aggregates."""
import copy
import json
import os

import pytest

from deeparam_data_helpers import FIXTURES, load_module, repo

ALLOWED_KEYS = {"patch", "date", "duration", "blue", "red", "blue_augs", "red_augs", "blue_win"}


def fixture():
    with open(os.path.join(FIXTURES, "importer", "lcu_game_mayhem.json"), encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def g():
    return load_module("analysis/win-prediction/games.py", "deeparam_win_games")


@pytest.fixture(scope="module")
def mi():
    return load_module("importer/mayhem_import.py", "deeparam_mayhem_import")


def test_client_game_becomes_an_anonymous_draft_row(g):
    row = g.from_client(fixture())
    assert row is not None
    assert set(row) == ALLOWED_KEYS
    assert len(row["blue"]) == len(row["red"]) == 5
    assert row["blue"] == sorted(row["blue"]) and row["red"] == sorted(row["red"])
    text = json.dumps(row)
    game = fixture()
    for ident in game.get("participantIdentities") or []:
        player = ident.get("player") or {}
        for key in ("puuid", "gameName", "tagLine", "summonerName"):
            if player.get(key):
                assert json.dumps(player[key]) not in text  # quoted, so short numbers can't match augment ids
    assert str(game["gameId"]) not in text


def test_archive_and_shared_pool_agree(g, mi):
    game = fixture()
    pooled = mi.anonymise(copy.deepcopy(game))
    assert pooled is not None
    a, b = g.from_client(game), g.from_pool({"data": json.dumps(pooled)})
    assert a == b
    assert g.merge([a], [b]) == [a]  # the same game from both sources counts once


def test_only_complete_mayhem_games(g):
    game = fixture()
    aram = dict(game, queueId=450)
    assert g.from_client(aram) is None
    short = copy.deepcopy(game)
    short["participants"] = short["participants"][:9]
    assert g.from_client(short) is None
    remake = dict(game, gameDuration=200)
    assert g.from_client(remake) is None


def test_load_reads_archives_and_d1_output(g, mi, tmp_path):
    game = fixture()
    archive = tmp_path / "archive.json"
    archive.write_text(json.dumps({"puuid": "x", "games": [game]}))
    d1 = tmp_path / "pool.json"
    d1.write_text(json.dumps([{"results": [{"data": json.dumps(mi.anonymise(copy.deepcopy(game)))}]}]))
    assert g.load(str(archive)) == g.load(str(d1)) == [g.from_client(game)]


def test_committed_notebook_has_no_game_rows():
    path = repo("analysis/win-prediction/win_prediction.ipynb")
    with open(path, encoding="utf-8") as f:
        nb = json.load(f)
    text = json.dumps(nb)
    for word in ("puuid", "gameName", "tagLine", "gameId", "riotId"):
        assert word not in text, word
    # Outputs are tables of models, patches and bins, never a list of games
    for cell in nb["cells"]:
        for out in cell.get("outputs", []):
            html = (out.get("data") or {}).get("text/html", "")
            html = "".join(html) if isinstance(html, list) else html
            assert html.count("<tr") <= 40


def test_no_game_table_in_the_repo():
    folder = repo("analysis/win-prediction")
    assert not [n for n in os.listdir(folder) if n.endswith((".csv", ".parquet")) or n == "games.json"]
