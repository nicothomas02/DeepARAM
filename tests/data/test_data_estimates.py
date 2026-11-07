"""Estimated stats: data/estimates/ (common.py, build.py, fitted.json, estimates.json)."""
import pytest

from deeparam_data_helpers import load_json, load_module

cm = load_module("data/estimates/common.py", "estimates_common", extra_path=["data/estimates"])


@pytest.fixture(scope="module")
def est():
    return load_json("data/estimates/estimates.json")


def test_augment_win_rate_follows_grade_and_lift():
    model = load_json("data/estimates/fitted.json")["augment_model"]
    g = model["grade"]
    assert g["S"] > g["A"] > g["B"] > g["C"]
    base = cm.augment_win_rate(0.5, 0.0, "A", model)
    assert cm.augment_win_rate(0.5, 0.02, "A", model) > base
    assert cm.augment_win_rate(0.5, 0.0, "S", model) > base


def test_sections_present(est):
    for key in ("vs_average", "profiles", "augments", "augment_pairs", "augment_stages", "augment_items",
                "rarity_odds", "items", "duos", "game_length", "side", "fun"):
        assert est[key], key
    assert est["estimated"] is True


def test_rarity_odds_sum_to_one(est):
    odds = est["rarity_odds"]
    assert sum(odds["overall"].values()) == pytest.approx(1, abs=1e-3)
    for stage in odds["by_stage"]:
        assert sum(stage.values()) == pytest.approx(1, abs=1e-3)


def test_profiles_and_damage_split(est):
    for c, p in est["profiles"].items():
        assert sum(p["damage_split"].values()) == pytest.approx(1, abs=2e-3)
        assert p["deaths"]["band"] in ("high", "average", "low")
        assert p["kills"]["value"] > 0


def test_augment_rows_consistent(est):
    for c, rows in est["augments"].items():
        for r in rows:
            assert 0.2 < r["win_rate"] < 0.8
        for r in est["augment_pairs"][c]:
            assert 0 < r["pick_rate"] <= 1


def test_duo_lift(est):
    for d in est["duos"][:50]:
        assert d["lift"] == pytest.approx(d["win_rate"] - d["expected"], abs=1e-3)


def test_power_curve():
    d = load_json("data/estimates/power_curve.json")
    assert d["simulated"] is True and len(d["champions"]) > 150
    for c in d["champions"].values():
        for s in ("early", "mid", "late"):
            assert 0 < c[s] <= 1
    late, early = d["late_game"][0], d["early_game"][0]
    assert d["champions"][str(late)]["scaling"] > 0 > d["champions"][str(early)]["scaling"]


def test_champion_upgrades():
    d = load_json("data/estimates/champion_upgrades.json")
    assert d["simulated"] is True and d["method"]["beta"] > 0
    pools = load_json("simulator/data/augment_pools.json")["pools"]
    items = {v["id"]: v for v in load_json("simulator/data/items.json")["items"].values()}
    assert len(d["champions"]) > 150
    for cid, c in d["champions"].items():
        pk = c["pentakill"]
        # Pentakill: a basic ability at the start, a different one (the ultimate allowed) at level 18.
        assert pk["start"] in "QWE" and pk["level18"] in "QWER" and pk["level18"] != pk["start"]
        wod = c["weapon_of_destiny"]
        if wod["best"]:
            assert items[wod["best"]]["slot"] == "legendary"
            assert wod["options"][0]["item"] == wod["best"]
        best = c["augments"]["best"]
        assert len(set(best["keys"])) == 4
        assert set(best["keys"]) <= set(pools[cid])
        assert best["score"] == pytest.approx(best["real"] + best["synergy"], abs=0.02)
        assert isinstance(best["simulated"], bool)


def test_boots_timing():
    """Simulated boots step per core build: 0-3 core items bought before the boots, keyed by real core builds."""
    d = load_json("data/estimates/boots_timing.json")
    assert d["simulated"] is True
    boots = {v["id"] for v in load_json("simulator/data/items.json")["items"].values() if v.get("slot") == "boots"}
    assert len(d["champions"]) > 150
    steps = []
    for cid, cores in d["champions"].items():
        real = {",".join(map(str, r["items"])) for r in load_json(f"data/cn/builds/{cid}.json")["items"]["core"]}
        for core, by_boots in cores.items():
            assert core in real, (cid, core)
            for b, step in by_boots.items():
                assert int(b) in boots and 0 <= step <= 3
                steps.append(step)
    # Most boots come after the 1st item; some later, so the page doesn't just put them first.
    assert steps.count(1) > len(steps) / 3 and sum(s >= 2 for s in steps) > len(steps) / 10


def test_pentakill_picks_by_role():
    """Pentakill picks are judged for a team fight: an enchanter Empowers its ally heal or shield, not its damage."""
    d = load_json("data/estimates/champion_upgrades.json")["champions"]
    by_name = {c["key"]: c["pentakill"] for c in d.values()}
    assert by_name["Soraka"]["start"] == "W"
    assert by_name["Sona"]["start"] == "W"
    assert by_name["Lulu"]["start"] == "E"
    assert by_name["Janna"]["start"] == "E"
    # Every ally effect in the team table names a real ability of a champion the simulator knows.
    kits = {c["id"].lower() for c in load_json("simulator/data/champions.json")["champions"]}
    team = {k: v for k, v in load_json("data/estimates/pentakill_team.json").items() if not k.startswith("_")}
    for champ, slots in team.items():
        assert champ.lower() in kits, champ
        for slot, fx in slots.items():
            assert slot in "QWER" and fx.get("why"), (champ, slot)
            assert fx.get("allies", 0) > 0 or fx.get("util", 0) > 0, (champ, slot)


# Hidden gems: data/estimates/synergies.py and synergies.json.
syn = load_module("data/estimates/synergies.py", "estimates_synergies", extra_path=["data/estimates"])


def test_wilson_interval():
    lo, hi = syn.wilson(0.5, 100)
    assert lo == pytest.approx(0.4038, abs=1e-3) and hi == pytest.approx(0.5962, abs=1e-3)
    assert syn.wilson(0.6, 10_000)[0] < 0.6 < syn.wilson(0.6, 10_000)[1]


def _opt(champion, items, lift, var=1e-5, pick=0.01):
    return {"champion": champion, "items": items, "pick_rate": pick, "lift": lift, "var": var,
            "lift_lo": lift - 0.01, "lift_hi": lift + 0.01, "win_rate": 0.5 + lift, "games": 1000}


def test_calibration_recovers_carry_over():
    # Next lift = 0.5 x this lift exactly: beta 0.5, alpha 0, no drift.
    before = [_opt(c, [1], (c - 50) / 1000) for c in range(100)]
    after = [_opt(c, [1], 0.5 * (c - 50) / 1000) for c in range(100)]
    cal = syn.calibrate(before, after)
    assert cal["beta"] == pytest.approx(0.5, abs=1e-6) and cal["alpha"] == pytest.approx(0, abs=1e-6)
    assert cal["pairs"] == 100 and cal["drift_sd"] < 0.002


def test_common_choices_are_never_gems():
    cal = {"alpha": 0.0, "beta": 0.6, "drift_sd": 0.01, "pairs": 100}
    scored = syn.score([_opt(1, [1], 0.2, pick=0.5), _opt(2, [2], 0.2), _opt(3, [3], 0.001)], cal)
    assert [o["champion"] for o in syn.gems(scored)] == [2]


def test_frozen_block():
    old = {str(c): {"items": {"other": [c]}, "skills": [c]} for c in range(20)}
    new = {str(c): {"items": {"other": [c]}, "skills": [c + 1]} for c in range(20)}
    assert syn.frozen(old, new, "other") and not syn.frozen(old, new, "skills")


def test_synergies_output():
    d = load_json("data/estimates/synergies.json")
    assert d["estimated"] is True and d["max_pick"] == 0.02
    for fam, rows in d["items"].items():
        assert fam not in d["stale"]
        for r in rows:
            assert r["pick_rate"] < d["max_pick"]
            assert r["forecast_lo"] > 0 and r["forecast_lo"] <= r["forecast"] <= r["forecast_hi"]
            assert r["lift_lo"] <= r["lift"] <= r["lift_hi"]
        assert [r["forecast_lo"] for r in rows] == sorted((r["forecast_lo"] for r in rows), reverse=True)
        assert all(r.get("sim") in ("agrees", "disagrees", "not simulated") for r in rows)
        if fam == "starting":
            assert all(r["sim"] == "not simulated" for r in rows)
    for a in d["augments"]:
        # No augment win rates: grade, pick rate and order only.
        assert "win_rate" not in a and "lift" not in a
        assert a["grade"] in ("S", "A") and a["pick_rate"] < d["max_pick"]
        # An augment the Simulator says makes the champion worse is never listed.
        assert a.get("sim") in ("agrees", "no gain", "not simulated")
    assert "dropped" in d["checks"]
    assert [a["rank"] for a in d["augments"]] == list(range(1, len(d["augments"]) + 1))
    for fam, b in (d.get("backtest") or {}).items():
        assert 0 <= b["forecast_90_coverage"] <= 1 and 0 <= b["sample_only_95_coverage"] <= 1


def test_viability_checks_drop_unbuyable_items():
    import synergy_checks as sc
    c = sc.Checker({})
    granted = next(iter(c.granted))
    gems = [{"champion": 1, "items": [granted]}, {"champion": 1, "items": [999999999]}, {"champion": 1, "items": [3006]}]
    kept = c.items("starting", gems)
    assert [g["items"] for g in kept] == [[3006]] and kept[0]["sim"] == "not simulated"
    assert sum(c.dropped["starting"].values()) == 2


def test_viability_checks_use_the_bug_finder():
    import synergy_checks as sc
    c = sc.Checker({})
    assert c.bugs, "data/checks/check_build.py should load"
    check, d, f, alias, augs = c.bugs
    jhin = next(x["champion_id"] for x in d["champions"] if x["id"] == "Jhin")
    tickle = next(a["id"] for a in d["augments"].values() if a["name"] == "Tickle Monster")
    # Tickle Monster on Jhin is on the Traps list, so it never shows up as a hidden gem.
    assert not c.bug_check("augments", {"champion": jhin}, augments=[tickle])
    assert c.dropped["augments"]["flagged by the bug finder"] == 1
    gem = {"champion": jhin}
    real = c.bugs
    c.bugs = (lambda *a: [{"level": "warn", "message": "untested loop"}],) + real[1:]
    assert c.bug_check("boots", gem, items=[3006]) and gem["caution"] == ["untested loop"]


# ---------- early-window builds (early_builds.py) ----------

eb = load_module("data/estimates/early_builds.py", "estimates_early_builds", extra_path=["data/cn"])


def _champ(full, boots_wr=0.5):
    return {"items": {"full_builds": [{"items": i, "pick_rate": p, "win_rate": w} for i, p, w in full],
                      "boots": [{"items": [3020], "pick_rate": 1.0, "win_rate": boots_wr}]}}


def test_early_blend_leans_on_the_prior_with_few_games():
    prior = _champ([([3020, 1, 2, 3, 4, 5], 0.5, 0.56)])
    cur = _champ([([3020, 1, 2, 3, 4, 5], 0.5, 0.40)])
    few = eb.blend(cur, prior, 200, 100000, prior_weight=800)[0]
    many = eb.blend(cur, prior, 200000, 100000, prior_weight=800)[0]
    assert few["estimated"] and not many["estimated"]
    assert few["games"] == 100
    # 100 games at 40% against 800 prior games at 56%
    assert few["win_rate"] == pytest.approx((100 * 0.40 + 800 * 0.56) / 900, abs=1e-4)
    assert many["win_rate"] == pytest.approx(0.40, abs=0.005)


def test_early_blend_moves_the_prior_for_patch_changes_and_drops_removed_items():
    prior = _champ([([3020, 1, 2, 3, 4, 5], 0.5, 0.50), ([3020, 9, 2, 3, 4, 5], 0.5, 0.50)])
    cur = _champ([])
    rows = eb.blend(cur, prior, 0, 100000, shift=0.02, items={1: 0.01}, removed={9}, prior_weight=800)
    assert [r["items"] for r in rows] == [[3020, 1, 2, 3, 4, 5]]
    assert rows[0]["win_rate"] == pytest.approx(0.53, abs=1e-4)
    assert rows[0]["estimated"] and rows[0]["games"] == 0


def test_early_window_starts_at_a_pick_rate_jump():
    def snap(p):
        return {"1": _champ([([3020, 1, 2, 3, 4, 5], p, 0.5)])}
    picks = [0.30, 0.301, 0.302, 0.303, 0.40, 0.42, 0.421, 0.422]
    snaps = [(f"2026-10-{10 + i:02d}", snap(p)) for i, p in enumerate(picks)]
    # The restart takes two days (0.303 -> 0.40 -> 0.42); the window starts on the first of them.
    assert eb.window_starts(snaps) == [4]


def test_early_builds_output():
    d = load_json("data/estimates/early_builds.json")
    assert "champions" in d
    for cid, c in d["champions"].items():
        assert cid.isdigit() and isinstance(c["estimated"], bool)
        assert c["full_builds"] and any(r["estimated"] for r in c["full_builds"])
        for r in c["full_builds"]:
            assert 0 <= r["pick_rate"] <= 1 and 0 <= r["win_rate"] <= 1 and r["games"] >= 0
        assert all(len(r["items"]) == 3 for r in c["core"])
