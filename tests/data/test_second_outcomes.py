"""Second outcomes in the archive re-tests (role_scores.py, pair_check.py, split_check.py): per-champion post-game scores."""
import gzip
import json

from deeparam_data_helpers import load_module

pc = load_module("data/estimates/pair_check.py", "pair_check", extra_path=["data/estimates"])
rsc = load_module("data/estimates/role_scores.py", "role_scores", extra_path=["data/estimates"])


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
    rows = rsc.player_rows(str(tmp_path))
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


def _names():
    return {v: k for k, v in json.load(open(rsc.cm.REPO + "/web/src/data/champion-ids.json")).items()}


def test_default_scores_follow_riot_subclasses():
    subs, ids = rsc.subclasses(), _names()
    by_name = {ids[c]: rsc.default_score(c, subs) for c in subs if c in ids}
    assert {by_name[n] for n in ("Soraka", "Janna", "Lulu", "Senna")} == {"support"}  # Enchanter, main or second
    assert by_name["Azir"] == "bruiser"  # Specialist
    assert {by_name[n] for n in ("Ashe", "Garen", "Leona", "Thresh")} == {"damage"}  # Catchers only switch on data


def test_support_score_rewards_healing_not_damage():
    base = {"augs": set(), "win": 0, "deaths": 0.1, "units_healed": 3, "assists": 0.5, "kp": 0.5, "cc_share": 0.2,
            "taken_share": 0.2, "mitig_share": 0.2, "kda": 2}
    healer = dict(base, champ=16, heal_share=0.6, dmg_share=0.05)
    hitter = dict(base, champ=16, heal_share=0.1, dmg_share=0.30)
    pc.score_rows([healer, hitter], {16: "support"})
    assert healer["score"] > hitter["score"]
    a, b = [dict(healer, champ=1), dict(hitter, champ=1)]
    pc.score_rows([a, b], {1: "damage"})  # damage score: damage counts
    assert b["score"] > a["score"]


def test_role_scores_switch_only_on_clear_evidence():
    shipped = json.load(open(rsc.OUT))
    assert shipped["min_cells"] >= 30 and shipped["margin"] >= 0.2
    for c, v in shipped["champions"].items():
        if v["score"] != v["default"]:
            assert v["cells"] >= shipped["min_cells"]
            assert v["r"][v["score"]] - v["r"][v["default"]] >= shipped["margin"]
    assert shipped["check"]["subclass defaults"] > shipped["check"]["win"]  # the scores beat the win alone
