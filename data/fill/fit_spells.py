#!/usr/bin/env python3
"""Fit the summoner-spell model (spell_model.json) on a Mayhem game archive.

The archive is a mayhem_import.py backup ({"games": [...]}) that stays on the owner's computer;
only the fitted coefficients are written. Every player in each game counts (championId,
spell1Id, spell2Id). Needs numpy and scipy.

Usage: python3 data/fill/fit_spells.py ~/path/to/mayhem-backup.json [--rift-patch 16.20]
"""

import argparse
import datetime as dt
import json
import os
import random
from collections import defaultdict

import numpy as np
from scipy.optimize import minimize

import model as m

OUT = os.path.dirname(os.path.abspath(__file__))
L2 = 0.5


def targets(archive):
    """[(game id, champion id, {spell: weight})] for each player's non-Flash spell(s)."""
    with open(archive, encoding="utf-8") as f:
        games = json.load(f)["games"]
    obs = []
    for g in games:
        for p in g["participants"]:
            other = [s for s in (p["spell1Id"], p["spell2Id"]) if s != m.FLASH]
            w = {s: 1 / len(other) for s in other if s in m.SPELLS}
            if w:
                obs.append((g["gameId"], str(p["championId"]), w))
    return obs


def fit(X, Y):
    n, k, f = X.shape

    def obj(th):
        b, g = th[:k], th[k:]
        z = b[None, :] + X @ g
        z -= z.max(1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(1, keepdims=True))
        p = np.exp(lp)
        grad = p * Y.sum(1, keepdims=True) - Y
        loss = -(Y * lp).sum() + L2 * (g @ g)
        return loss, np.concatenate([grad.sum(0), np.einsum("nk,nkf->f", grad, X) + 2 * L2 * g])

    th = minimize(obj, np.zeros(k + f), jac=True, method="L-BFGS-B").x
    return th[:k], th[k:]


def log_loss(b, g, X, Y):
    z = b[None, :] + X @ g
    z -= z.max(1, keepdims=True)
    lp = z - np.log(np.exp(z).sum(1, keepdims=True))
    return float(-(Y * lp).sum() / len(Y))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--stats-patch", default=None, help="Mayhem champion stats patch (default: newest complete)")
    ap.add_argument("--rift-patch", default=None, help="Rift spell patch (default: live patch)")
    args = ap.parse_args()

    obs = targets(args.archive)
    rows = m.patches()
    stats = m.patch_stats(args.stats_patch or rows[-2]["patch"])
    champs = sorted({c for _, c, _ in obs})
    rift = m.rift_spells(champs, args.rift_patch or rows[-1]["patch"])
    dd = m.data_dragon()
    feats = {}
    for c in champs:
        tags, dd_stats = dd.get(c, ([], {}))
        feats[c] = m.features(tags, m.numeric(stats.get(c), dd_stats), rift.get(c, {}))
    X = np.array([feats[c] for _, c, _ in obs])
    Y = np.array([[w.get(s, 0.0) for s in m.SPELLS] for _, _, w in obs])

    # 5-fold check by game against plain overall shares
    games = sorted({gid for gid, _, _ in obs})
    random.Random(1).shuffle(games)
    fold = {gid: i % 5 for i, gid in enumerate(games)}
    fid = np.array([fold[gid] for gid, _, _ in obs])
    cv, base = [], []
    for k in range(5):
        tr, te = fid != k, fid == k
        b, g = fit(X[tr], Y[tr])
        cv.append(log_loss(b, g, X[te], Y[te]))
        share = Y[tr].mean(0)
        base.append(float(-(Y[te] * np.log(share)).sum() / te.sum()))
    b, g = fit(X, Y)
    out = {
        "spells": m.SPELLS,
        "bias": [round(float(v), 5) for v in b],
        "coef": [round(float(v), 5) for v in g],
        "fitted": dt.date.today().isoformat(),
        "players": len(obs),
        "games": len(games),
        "cv_log_loss": round(float(np.mean(cv)), 4),
        "baseline_log_loss": round(float(np.mean(base)), 4),
    }
    with open(os.path.join(OUT, "spell_model.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"{len(games)} games, {len(obs)} players: log loss {out['cv_log_loss']} vs {out['baseline_log_loss']} for overall shares")


if __name__ == "__main__":
    main()
