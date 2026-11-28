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


def _lcu_game():
    parts, ids = [], []
    for i in range(10):
        team = 100 if i < 5 else 200
        parts.append({"participantId": i + 1, "teamId": team, "championId": 16 if i == 0 else 1 + i,
                      "stats": {"win": team == 100, "totalDamageDealtToChampions": 1000 * (i % 5 + 1), "totalHeal": 5000 if i == 0 else 500,
                                "totalUnitsHealed": 4 if i == 0 else 1, "deaths": 2, "kills": 2, "assists": 10 if i == 0 else 3,
                                "timeCCingOthers": 10}})
        ids.append({"participantId": i + 1, "player": {"puuid": f"p{i}"}})
    return {"gameDuration": 1200, "participants": parts, "participantIdentities": ids}


def test_what_mattered_compares_with_the_typical_player():
    g = _lcu_game()
    rows = rsc.game_rows(g)
    assert len(rows) == 10 and rows[0]["pid"] == 1
    typical = {k: [rows[0][k] * 0.5 if k != "deaths" else rows[0][k] * 2, 0.1] for k in rsc.STATS}
    res = {"champions": {"16": {"score": "support"}}, "norms": {"16": {"n": 40, "stats": typical}}, "subclass_norms": {}}
    out = rsc.what_mattered(g, 1, res, subs={16: ("Enchanter",)})
    assert out["score"] == "support" and out["players"] == 40 and out["pooled"] is None
    assert "win" not in {s["stat"] for s in out["stats"]}
    assert all(s["z"] > 0 for s in out["stats"])  # better than typical on every stat (deaths flipped)
    assert [abs(s["z"]) for s in out["stats"]] == sorted((abs(s["z"]) for s in out["stats"]), reverse=True)
    # no norm for the champion: falls back to its subclass, marked pooled
    res2 = {"champions": {}, "norms": {}, "subclass_norms": {"Enchanter": {"n": 300, "stats": typical}}}
    assert rsc.what_mattered(g, 1, res2, subs={16: ("Enchanter",)})["pooled"] == "Enchanter"
    g["gameDuration"] = 200  # remake
    assert rsc.what_mattered(g, 1, res, subs={16: ("Enchanter",)}) is None


def test_shipped_norms_leave_the_owner_out_and_need_enough_players():
    shipped = json.load(open(rsc.OUT))
    assert shipped["norms"] and all(v["n"] >= shipped["min_norm"] for v in shipped["norms"].values())
    assert set(next(iter(shipped["norms"].values()))["stats"]) == set(rsc.STATS)
    assert set(shipped["subclass_of"].values()) <= set(shipped["subclass_norms"])  # every fallback has a pooled norm
    assert all(shipped["score_of"][c] == v["score"] for c, v in shipped["champions"].items())
