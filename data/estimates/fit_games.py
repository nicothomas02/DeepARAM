#!/usr/bin/env python3
"""Fit the per-game parts of the estimates on a Mayhem game archive (fitted.json).

The archive is a mayhem_import.py backup that stays on the owner's computer. Every player in each
game counts. Only aggregates and coefficients are written, never a player's own games. Needs numpy
and scipy. Prints a held-out check for each part.

Usage: python3 data/estimates/fit_games.py ~/path/to/mayhem-backup.json
"""

import argparse
import datetime as dt
import itertools
import json
import math
import os
import random
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import minimize

import common as cm

PROFILE_STATS = {
    # name: (stats field(s), per "game" or "min")
    "kills": (["kills"], "game"),
    "deaths": (["deaths"], "game"),
    "assists": (["assists"], "game"),
    "multikills": (["doubleKills", "tripleKills", "quadraKills", "pentaKills"], "game"),
    "damage_per_min": (["totalDamageDealtToChampions"], "min"),
    "physical_share": (["physicalDamageDealtToChampions"], "share"),
    "magic_share": (["magicDamageDealtToChampions"], "share"),
    "true_share": (["trueDamageDealtToChampions"], "share"),
    "taken_per_min": (["totalDamageTaken"], "min"),
    "mitigated_per_min": (["damageSelfMitigated"], "min"),
    "heal_per_min": (["totalHeal"], "min"),
    "cc_seconds": (["timeCCingOthers"], "game"),
    "gold_per_min": (["goldEarned"], "min"),
    "turret_damage": (["damageDealtToTurrets"], "game"),
}
PRIOR_GAMES = 40  # games a champion needs before its own average outweighs the prediction


def players(archive):
    games = cm.load(archive)["games"]
    out = []
    for g in games:
        mins = max(g["gameDuration"], 60) / 60
        for p in g["participants"]:
            s = p["stats"]
            out.append({
                "game": g["gameId"], "team": p["teamId"], "win": int(bool(s.get("win"))), "mins": mins,
                "champ": str(p["championId"]), "stats": s,
                "augs": [str(s[f"playerAugment{i}"]) for i in range(1, 7) if s.get(f"playerAugment{i}")],
            })
    return games, out


def team_won(game, team_id):
    return int(any(p["stats"].get("win") for p in game["participants"] if p["teamId"] == team_id))


def folds(games, k=5):
    ids = [g["gameId"] for g in games]
    random.Random(1).shuffle(ids)
    return {gid: i % k for i, gid in enumerate(ids)}


# ---------- augment stages and rarity odds ----------

def fit_stages(pl, tiers):
    by_stage = [Counter() for _ in range(4)]
    trans = defaultdict(Counter)
    aug = defaultdict(lambda: [[0, 0] for _ in range(4)])  # augment -> per stage [picks, wins]
    for p in pl:
        rs = [tiers.get(a) for a in p["augs"][:4]]
        for i, (a, r) in enumerate(zip(p["augs"][:4], rs)):
            if r:
                by_stage[i][r] += 1
            aug[a][i][0] += 1
            aug[a][i][1] += p["win"]
        for r1, r2 in zip(rs, rs[1:]):
            if r1 and r2:
                trans[r1][r2] += 1
    odds = [{r: round(c[r] / sum(c.values()), 4) for r in cm.RARITIES} for c in by_stage]
    nxt = {r1: {r2: round(c[r2] / sum(c.values()), 4) for r2 in cm.RARITIES} for r1, c in trans.items()}
    return {"by_stage": odds, "next": nxt, "players": sum(sum(c.values()) for c in by_stage[:1])}, {a: v for a, v in aug.items()}


# ---------- augment win rate on a champion ----------

def fit_augment_model(pl, fold):
    stats, b, fair = cm.champion_stats(), cm.builds(), cm.fair_augments()
    dev, rows = cm.augment_on_champion(stats, b, fair)
    grade = {(c, a): g for c, a, g, _ in rows}
    recs = [(p["game"], cm.logit(stats[p["champ"]]["win_rate"]), cm.logit(0.5 + dev[a]), grade.get((p["champ"], a)), p["win"])
            for p in pl for a in p["augs"] if p["champ"] in stats and a in dev]
    off = np.array([r[1] for r in recs]); d = np.array([r[2] for r in recs])
    G = np.array([[1.0 if r[3] == g else 0.0 for g in cm.GRADES] for r in recs])
    y = np.array([r[4] for r in recs], float); fid = np.array([fold[r[0]] for r in recs])

    def nll(th, m, use_dev=True, use_grade=True):
        z = off[m] + (th[0] * d[m] if use_dev else 0) + (G[m] @ th[1:] if use_grade else 0)
        return float(np.sum(np.logaddexp(0, z) - y[m] * z) + 0.5 * th @ th)

    def cv(use_dev, use_grade):
        tot = 0.0
        for k in range(5):
            tr, te = fid != k, fid == k
            th = minimize(lambda t: nll(t, tr, use_dev, use_grade), np.zeros(5)).x
            tot += nll(th, te, use_dev, use_grade) - 0.5 * th @ th
        return tot / len(y)
    check = {"champion only": cv(False, False), "+ augment": cv(True, False), "+ augment + grade": cv(True, True)}
    th = minimize(lambda t: nll(t, np.ones(len(y), bool)), np.zeros(5)).x
    return {"lambda": round(float(th[0]), 4), "grade": {g: round(float(v), 4) for g, v in zip(cm.GRADES, th[1:])},
            "records": len(y), "check_log_loss": {k: round(v, 5) for k, v in check.items()}}


# ---------- champion profiles (KDA, damage split, ...) ----------

def champion_features(stats, dd):
    feats = {}
    for c, s in stats.items():
        info = dd.get(c, {"tags": [], "stats": {}})
        feats[c] = [1.0, s["damage"] * 5, s["tank"] * 5, s["kp"] * 2, s["dead"] / 100,
                    1.0 if info["stats"].get("attackrange", 500) <= 250 else 0.0] + [1.0 if t in info["tags"] else 0.0 for t in cm.TAGS]
    return feats


def per_champion_values(pl, champs=None):
    """{stat: {champion: (mean, games)}} averaged over the given players."""
    acc = defaultdict(lambda: defaultdict(list))
    for p in pl:
        if champs is not None and p["champ"] not in champs:
            continue
        s = p["stats"]
        for name, (fields, kind) in PROFILE_STATS.items():
            v = sum(s.get(f, 0) for f in fields)
            if kind == "min":
                v /= p["mins"]
            elif kind == "share":
                tot = s.get("totalDamageDealtToChampions", 0)
                if not tot:
                    continue
                v /= tot
            acc[name][p["champ"]].append(v)
    return {n: {c: (float(np.mean(v)), len(v)) for c, v in d.items()} for n, d in acc.items()}


def regress(values, feats):
    cs = [c for c in values if c in feats]
    X = np.array([feats[c] for c in cs]); y = np.array([values[c][0] for c in cs]); w = np.array([values[c][1] for c in cs], float)
    W = np.sqrt(w)[:, None]
    return np.linalg.lstsq(X * W, y * W[:, 0], rcond=None)[0]


def fit_profiles(pl, games, fold):
    stats, dd = cm.champion_stats(), cm.data_dragon()
    feats = champion_features(stats, dd)
    vals = per_champion_values(pl)
    # check: predict a held-out half of games per champion from (a) the feature regression alone and
    # (b) the other half shrunk toward it; correlation across champions with 20+ games in each half
    half = {g["gameId"]: fold[g["gameId"]] % 2 for g in games}
    va = per_champion_values([p for p in pl if half[p["game"]] == 0])
    vb = per_champion_values([p for p in pl if half[p["game"]] == 1])
    check, out = {}, {}
    for name in PROFILE_STATS:
        coef = regress(va[name], feats)
        cs = [c for c in vb[name] if c in feats and va[name].get(c, (0, 0))[1] >= 20 and vb[name][c][1] >= 20]
        prior = [float(np.dot(coef, feats[c])) for c in cs]
        shrunk = [(va[name][c][0] * va[name][c][1] + p * PRIOR_GAMES) / (va[name][c][1] + PRIOR_GAMES) for c, p in zip(cs, prior)]
        actual = [vb[name][c][0] for c in cs]
        check[name] = {"features_only_r": round(float(np.corrcoef(prior, actual)[0, 1]), 3),
                       "with_games_r": round(float(np.corrcoef(shrunk, actual)[0, 1]), 3), "champions": len(cs)}
        coef = regress(vals[name], feats)
        out[name] = {"coef": [round(float(x), 6) for x in coef],
                     "champions": {c: [round(m, 4), n] for c, (m, n) in vals[name].items()}}
    return {"features": ["const", "damage", "tank", "kp", "dead", "melee"] + cm.TAGS, "prior_games": PRIOR_GAMES,
            "stats": out, "check": check}


# ---------- game length, side ----------

def fit_length_and_side(pl, games):
    stats = cm.champion_stats()
    mins = np.array([g["gameDuration"] / 60 for g in games])
    mean, sd = float(mins.mean()), float(mins.std())
    slope = defaultdict(lambda: [0.0, 0.0, 0])
    for p in pl:
        if p["champ"] not in stats:
            continue
        q = stats[p["champ"]]["win_rate"]
        z = (p["mins"] - mean) / sd
        s = slope[p["champ"]]
        s[0] += (p["win"] - q) * z; s[1] += q * (1 - q) * z * z; s[2] += 1
    return {
        "minutes": {"mean": round(mean, 2), "sd": round(sd, 2),
                    "share": {f"{lo}-{lo + 5}": round(float(np.mean((mins >= lo) & (mins < lo + 5))), 4) for lo in range(0, 35, 5)}},
        # win-probability slope per sd of game length (logit), raw sums so build.py can shrink
        "length_slope": {c: [round(a, 4), round(b, 4), n] for c, (a, b, n) in slope.items()},
        "blue_win_rate": round(float(np.mean([team_won(g, 100) for g in games])), 4),
        "games": len(games),
    }


# ---------- team synergy and counters by class ----------

PAIRS = list(itertools.combinations_with_replacement(range(6), 2))
VERSUS = list(itertools.combinations(range(6), 2))


def class_weights(c, dd):
    tags = [cm.TAGS.index(t) for t in dd.get(c, {}).get("tags", []) if t in cm.TAGS] or [1]
    v = np.zeros(6)
    for t in tags:
        v[t] += 1 / len(tags)
    return v


def team_features(blue, red, dd):
    def syn(team):
        f = np.zeros(len(PAIRS))
        for a, b in itertools.combinations(team, 2):
            wa, wb = class_weights(a, dd), class_weights(b, dd)
            m = np.outer(wa, wb)
            for i, (x, y) in enumerate(PAIRS):
                f[i] += m[x, y] + (m[y, x] if x != y else 0)
        return f
    vs = np.zeros(len(VERSUS))
    for a in blue:
        for b in red:
            m = np.outer(class_weights(a, dd), class_weights(b, dd))
            for i, (x, y) in enumerate(VERSUS):
                vs[i] += m[x, y] - m[y, x]
    return np.concatenate([syn(blue) - syn(red), vs])


def fit_classes(games, fold):
    stats, dd = cm.champion_stats(), cm.data_dragon()
    X, off, y, fid = [], [], [], []
    for g in games:
        team = {100: [], 200: []}
        for p in g["participants"]:
            team[p["teamId"]].append(str(p["championId"]))
        if any(c not in stats for c in team[100] + team[200]):
            continue
        X.append(team_features(team[100], team[200], dd))
        off.append(sum(cm.logit(stats[c]["win_rate"]) for c in team[100]) - sum(cm.logit(stats[c]["win_rate"]) for c in team[200]))
        y.append(team_won(g, 100))
        fid.append(fold[g["gameId"]])
    X, off, y, fid = np.array(X), np.array(off), np.array(y, float), np.array(fid)
    L2 = 5.0

    def nll(th, m, a=1.0):
        z = a * off[m] + th[0] + X[m] @ th[1:]
        return float(np.sum(np.logaddexp(0, z) - y[m] * z) + L2 * th[1:] @ th[1:])

    def nll0(m):
        z = off[m]
        return float(np.sum(np.logaddexp(0, z) - y[m] * z))
    base = cv = 0.0
    for k in range(5):
        tr, te = fid != k, fid == k
        th = minimize(lambda t: nll(t, tr), np.zeros(1 + X.shape[1])).x
        cv += nll(th, te) - L2 * th[1:] @ th[1:]
        base += nll0(te)
    th = minimize(lambda t: nll(t, np.ones(len(y), bool)), np.zeros(1 + X.shape[1])).x
    syn = {f"{cm.TAGS[a]}+{cm.TAGS[b]}": round(float(v), 4) for (a, b), v in zip(PAIRS, th[1:1 + len(PAIRS)])}
    vs = {f"{cm.TAGS[a]}>{cm.TAGS[b]}": round(float(v), 4) for (a, b), v in zip(VERSUS, th[1 + len(PAIRS):])}
    return {"synergy": syn, "versus": vs, "games": len(y),
            "check_log_loss": {"champion win rates only": round(base / len(y), 5), "+ class synergy and counters": round(cv / len(y), 5)}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    args = ap.parse_args()
    games, pl = players(args.archive)
    fold = folds(games)
    tiers = {k: v for k, v in cm.augment_rules()["tiers"].items()}
    stages, aug_stage = fit_stages(pl, tiers)
    out = {
        "fitted": dt.date.today().isoformat(),
        "games": len(games),
        "players": len(pl),
        "stages": stages,
        "augment_stages": {a: v for a, v in aug_stage.items() if sum(x[0] for x in v) >= 10},
        "augment_model": fit_augment_model(pl, fold),
        "profiles": fit_profiles(pl, games, fold),
        "length_side": fit_length_and_side(pl, games),
        "classes": fit_classes(games, fold),
    }
    with open(os.path.join(cm.HERE, "fitted.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("augment model", out["augment_model"]["lambda"], out["augment_model"]["grade"], out["augment_model"]["check_log_loss"])
    print("profiles check", json.dumps(out["profiles"]["check"]))
    print("classes check", out["classes"]["check_log_loss"])
    print("stage odds", out["stages"]["by_stage"])
    print("length", out["length_side"]["minutes"], "blue", out["length_side"]["blue_win_rate"])


if __name__ == "__main__":
    main()
