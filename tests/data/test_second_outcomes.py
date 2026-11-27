"""Second outcomes in the archive re-tests (pair_check.py, split_check.py): damage share, kill participation, deaths."""
import gzip
import json

from deeparam_data_helpers import load_module

pc = load_module("data/estimates/pair_check.py", "pair_check", extra_path=["data/estimates"])


def _game(tmp_path):
    parts = []
    for i in range(10):
        team = 100 if i < 5 else 200
        parts.append({"participantId": i + 1, "teamId": team, "championId": 1 + i,
                      "stats": {"win": team == 100, "totalDamageDealtToChampions": 1000 * (i % 5 + 1),
                                "deaths": i % 3, "kills": 2, "assists": 1, "playerAugment1": 1001}})
    (tmp_path / "games").mkdir()
    with gzip.open(tmp_path / "games" / "1.json.gz", "wt") as f:
        json.dump({"gameDuration": 1200, "participants": parts}, f)


def test_pair_rows_use_team_damage_share_and_deaths_per_minute(tmp_path):
    _game(tmp_path)
    rows = pc.rows(str(tmp_path))
    assert len(rows) == 10
    for team in (rows[:5], rows[5:]):
        assert abs(sum(r["dmg_share"] for r in team) - 1) < 1e-9  # shares of the player's own team
    assert rows[1]["deaths"] == 1 / 20  # deaths per minute of a 20-minute game
    assert "dpm" not in rows[0]


def test_contrast_signs():
    rs = [{"augs": a, "x": v} for a, v in (({1, 2}, 3.0), ({1, 2}, 3.2), ({1}, 1.0), ({1}, 1.1), ({2}, 1.0), ({2}, 0.9),
                                           (set(), 0.0), (set(), 0.1))]
    z, n = pc.contrast(rs, 1, 2, "x")
    assert n == 2 and z > 2  # both > A alone + B alone: the pair feeds itself
