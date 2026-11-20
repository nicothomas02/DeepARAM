"""Live coach (importer/live_coach.py): features from a Live Client Data reply, the win chance and the surrender line."""
from deeparam_data_helpers import load_module

lc = load_module("importer/live_coach.py", "deeparam_live_coach")


def game(minute, my_kills=0, their_kills=0, my_level=10, their_level=10, events=()):
    players = [{"riotId": f"A{i}#1", "team": "ORDER", "level": my_level, "scores": {"kills": my_kills if i == 0 else 0},
                "rawChampionName": "game_character_displayname_Lux"} for i in range(5)]
    players += [{"riotId": f"B{i}#1", "team": "CHAOS", "level": their_level, "scores": {"kills": their_kills if i == 0 else 0},
                 "rawChampionName": "game_character_displayname_Jinx"} for i in range(5)]
    return {"activePlayer": {"riotId": "A0#1"}, "allPlayers": players, "gameData": {"gameTime": minute * 60},
            "events": {"Events": list(events)}}


def test_even_game_is_a_coin_flip():
    _, team, x = lc.features(game(10), {})
    assert team == "ORDER"
    assert abs(lc.win_chance(x) - 0.5) < 1e-9


def test_kills_towers_and_levels_move_the_chance_the_right_way():
    ahead = lc.win_chance(lc.features(game(12, my_kills=9, my_level=11, events=[
        {"EventName": "TurretKilled", "TurretKilled": "Turret_T2_L_03_A"}]), {})[2])
    behind = lc.win_chance(lc.features(game(12, their_kills=9, their_level=11, events=[
        {"EventName": "InhibKilled", "InhibKilled": "Barracks_T1_L1"}]), {})[2])
    assert ahead > 0.7 and behind < 0.3
    assert abs(ahead + behind - 1) < 1e-9


def test_team_strength_counts_for_the_right_side():
    _, _, x = lc.features(game(1), {"Lux": 0.53, "Jinx": 0.50})
    assert lc.win_chance(x) > 0.5


def test_surrender_line_and_hold():
    assert lc.ff_line(5) is None
    assert lc.ff_line(8) == 0.20 and abs(lc.ff_line(11) - 0.14) < 1e-9 and lc.ff_line(30) == 0.055
    coach = lc.Coach()
    hopeless = dict(their_kills=25, their_level=14, my_level=9)
    first = coach.update(game(10, **hopeless), {})
    assert first["win"] < first["ffLine"] and not first["ffHint"]
    later = coach.update(game(11.1, **hopeless), {})
    assert later["ffHint"]
