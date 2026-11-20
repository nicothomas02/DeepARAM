"""Live win probability for the overlay, fitted on the archive's cached timelines, and when a surrender is right.

Every minute of every cached game becomes one row with what the overlay can read live from the Live Client Data API
(all players' items, levels, kills, turret and inhibitor events, game time) plus a pre-game draft prior:

  draft      sum over each team of logit(champion win rate) on that patch, from the public feed (by_patch.json),
             ally minus enemy
  gold       item gold ally minus enemy, in thousands. The timeline's totalGold - currentGold (gold spent) stands in
             for the item value the overlay adds up from item prices.
  levels     summed champion levels, ally minus enemy
  kills      team kills, ally minus enemy
  towers     turrets destroyed, ally minus enemy; inhibs: inhibitors destroyed, ally minus enemy

A logistic model is fitted for each band of minutes (Newton's method, plain Python), and scored out of fold with
games split into 5 folds (a game's minutes never sit in two folds), so the numbers are what a new game would see.
It reports AUC, Brier score and calibration per band, the coefficients for the overlay, and the surrender table:
for teams whose predicted chance first fell below a threshold at a minute, how often they still won. That is the cost
of surrendering at that threshold.

Counts and rates only; every row is a team, never a player.

    python data/analysis/win_probability.py <archive.json> --feed data/cn/history/by_patch.json [--json out.json]

Reads the timeline cache timeline_signals.py keeps (%APPDATA%/Mayhem Stats/timelines); nothing is downloaded.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import math
import os

REMAKE_SECONDS = 300
FEATURES = ("draft", "gold", "levels", "kills", "towers", "inhibs")
BANDS = [(1, 4), (5, 7), (8, 10), (11, 13), (14, 16), (17, 20), (21, 99)]
THRESHOLDS = (0.05, 0.10, 0.15, 0.20, 0.30)
FOLDS = 5


def cached(game_id):
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    try:
        with gzip.open(os.path.join(base, "Mayhem Stats", "timelines", f"{game_id}.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def patch_key(version, known):
    parts = str(version or "").split(".")
    if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None
    v = (int(parts[0]), int(parts[1]))
    cands = [p for p in known if tuple(map(int, p.split("."))) <= v]
    return max(cands, key=lambda p: tuple(map(int, p.split(".")))) if cands else None


def logit(p):
    p = min(0.99, max(0.01, p))
    return math.log(p / (1 - p))


def sigmoid(z):
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def game_rows(g, tl, feed):
    """[(minute, features for team 100, team 100 won)] for one game."""
    parts = g.get("participants") or []
    team = {p["participantId"]: p["teamId"] for p in parts}
    if sorted(collections.Counter(team.values()).values()) != [5, 5]:
        return []
    won100 = any(p["stats"].get("win") for p in parts if p["teamId"] == 100)
    patch = feed.get(patch_key(g.get("gameVersion"), feed)) or {}
    draft = sum((1 if p["teamId"] == 100 else -1) * logit((patch.get(p.get("championId")) or {}).get("win_rate", 0.5))
                for p in parts)
    frames = tl.get("frames") or []
    kills, towers, inhibs = collections.Counter(), collections.Counter(), collections.Counter()
    out = []
    for minute, f in enumerate(frames):
        if minute == 0:
            continue
        # Events in frame m happened during minute m; the frame's participant stats are at its timestamp.
        for e in f.get("events") or []:
            t = e.get("type")
            if t == "CHAMPION_KILL" and team.get(e.get("killerId")):
                kills[team[e["killerId"]]] += 1
            elif t == "CHAMPION_KILL" and team.get(e.get("victimId")):  # executed: counts for the other team
                kills[300 - team[e["victimId"]]] += 1
            elif t == "BUILDING_KILL" and e.get("teamId") in (100, 200):
                lost = e["teamId"]
                if e.get("buildingType") == "INHIBITOR_BUILDING":
                    inhibs[300 - lost] += 1
                elif e.get("buildingType") == "TOWER_BUILDING":
                    towers[300 - lost] += 1
        pfs = f.get("participantFrames") or {}
        spent, levels = collections.Counter(), collections.Counter()
        for q, pf in pfs.items():
            if not str(q).isdigit() or int(q) not in team:
                continue
            tm = team[int(q)]
            spent[tm] += (pf.get("totalGold") or 0) - (pf.get("currentGold") or 0)
            levels[tm] += pf.get("level") or 0
        if not levels:
            continue
        out.append((minute, {"draft": draft, "gold": (spent[100] - spent[200]) / 1000, "levels": levels[100] - levels[200],
                             "kills": kills[100] - kills[200], "towers": towers[100] - towers[200],
                             "inhibs": inhibs[100] - inhibs[200]}, won100))
    return out


def fit(X, y, ridge=1.0, iters=25):
    """Logistic regression with an intercept and a small L2 penalty, by Newton's method."""
    k = len(X[0]) + 1
    w = [0.0] * k
    for _ in range(iters):
        grad = [0.0] * k
        hess = [[0.0] * k for _ in range(k)]
        for x, t in zip(X, y):
            xx = (1.0, *x)
            p = sigmoid(sum(a * b for a, b in zip(w, xx)))
            r = p * (1 - p)
            for i in range(k):
                grad[i] += (p - t) * xx[i]
                for j in range(i + 1):
                    hess[i][j] += r * xx[i] * xx[j]
        for i in range(k):
            for j in range(i):
                hess[j][i] = hess[i][j]
            if i:
                grad[i] += ridge * w[i]
                hess[i][i] += ridge
        step = solve(hess, grad)
        w = [a - b for a, b in zip(w, step)]
        if max(abs(s) for s in step) < 1e-7:
            break
    return w


def solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[piv] = M[piv], M[c]
        if abs(M[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * bb for a, bb in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] if abs(M[i][i]) > 1e-12 else 0.0 for i in range(n)]


def predict(w, x):
    return sigmoid(w[0] + sum(a * b for a, b in zip(w[1:], x)))


def auc(y, p):
    pairs = sorted(zip(p, y))
    ranks, i = [0.0] * len(pairs), 0
    while i < len(pairs):
        j = i
        while j + 1 < len(pairs) and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        for k in range(i, j + 1):
            ranks[k] = (i + j) / 2 + 1
        i = j + 1
    pos = sum(1 for _, t in pairs if t)
    neg = len(pairs) - pos
    if not pos or not neg:
        return None
    return round((sum(r for r, (_, t) in zip(ranks, pairs) if t) - pos * (pos + 1) / 2) / (pos * neg), 3)


def band_of(minute):
    return next(f"{lo}-{hi}" if hi < 99 else f"{lo}+" for lo, hi in BANDS if lo <= minute <= hi)


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--feed", required=True)
    ap.add_argument("--json")
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    with open(args.feed, encoding="utf-8") as f:
        feed = {p: {r["id"]: r for r in rows} for p, rows in json.load(f)["champions"].items()}

    per_game, missing = [], 0
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        if dur < REMAKE_SECONDS:
            continue
        tl = cached(g.get("gameId"))
        if not tl:
            missing += 1
            continue
        rows = game_rows(g, tl, feed)
        if rows:
            per_game.append(rows)
    # Fold by position after a fixed shuffle, so a game's minutes stay together.
    order = sorted(range(len(per_game)), key=lambda i: (i * 2654435761) % 2**32)
    fold = {gi: n % FOLDS for n, gi in enumerate(order)}

    def xs(feat, names=FEATURES):
        return [feat[k] for k in names]

    oof = {}  # (game, minute) -> predicted chance for team 100
    models = {}
    for lo, hi in BANDS:
        band = band_of(lo)
        rows = [(gi, m, ft, y) for gi, rs in enumerate(per_game) for m, ft, y in rs if lo <= m <= hi]
        if len(rows) < 200:
            continue
        for k in range(FOLDS):
            train = [r for r in rows if fold[r[0]] != k]
            w = fit([xs(r[2]) for r in train], [1 if r[3] else 0 for r in train])
            for gi, m, ft, y in rows:
                if fold[gi] == k:
                    oof[(gi, m)] = predict(w, xs(ft))
        w = fit([xs(r[2]) for r in rows], [1 if r[3] else 0 for r in rows])
        models[band] = {"intercept_blue_side": round(w[0], 4), **{k: round(v, 4) for k, v in zip(FEATURES, w[1:])},
                        "rows": len(rows)}

    # Draft-only baseline, to show what the live features add.
    base = {}
    rows_all = [(gi, m, ft, y) for gi, rs in enumerate(per_game) for m, ft, y in rs]
    for k in range(FOLDS):
        train = [r for r in rows_all if fold[r[0]] != k and r[1] == 1]
        w = fit([[r[2]["draft"]] for r in train], [1 if r[3] else 0 for r in train])
        for gi, m, ft, y in rows_all:
            if fold[gi] == k:
                base[(gi, m)] = predict(w, [ft["draft"]])

    scored = {}
    for band in models:
        ys, ps, bs = [], [], []
        for gi, rs in enumerate(per_game):
            for m, ft, y in rs:
                if band_of(m) == band and (gi, m) in oof:
                    ys.append(1 if y else 0)
                    ps.append(oof[(gi, m)])
                    bs.append(base[(gi, m)])
        scored[band] = {"rows": len(ys), "auc": auc(ys, ps), "brier": round(sum((p - t) ** 2 for p, t in zip(ps, ys)) / len(ys), 4),
                        "draft_only_auc": auc(ys, bs),
                        "draft_only_brier": round(sum((p - t) ** 2 for p, t in zip(bs, ys)) / len(ys), 4)}

    # Calibration on both teams' view (each row twice: team 100 with p, team 200 with 1 - p).
    calib = collections.defaultdict(lambda: [0, 0])
    for gi, rs in enumerate(per_game):
        for m, ft, y in rs:
            p = oof.get((gi, m))
            if p is None or m < 5:
                continue
            for pp, won in ((p, y), (1 - p, not y)):
                b = min(9, int(pp * 10))
                calib[b][0] += 1
                calib[b][1] += 1 if won else 0
    calibration = {f"{b * 10}-{b * 10 + 10}%": {"n": n, "won": round(w / n, 3), "ci": wilson(w, n)}
                   for b, (n, w) in sorted(calib.items())}

    # Surrender table: the first minute (from 8) each team's chance fell below a threshold, and whether it still won.
    ff = {}
    for th in THRESHOLDS:
        by_min = collections.defaultdict(lambda: [0, 0])
        overall = [0, 0]
        for gi, rs in enumerate(per_game):
            for side in (100, 200):
                for m, ft, y in rs:
                    p = oof.get((gi, m))
                    if p is None or m < 8:
                        continue
                    p_side = p if side == 100 else 1 - p
                    won = y if side == 100 else not y
                    if p_side < th:
                        key = "8-10" if m <= 10 else "11-14" if m <= 14 else "15-19" if m <= 19 else "20+"
                        by_min[key][0] += 1
                        by_min[key][1] += 1 if won else 0
                        overall[0] += 1
                        overall[1] += 1 if won else 0
                        break
        ff[f"below_{int(th * 100)}%"] = {
            "teams": overall[0], "still_won": round(overall[1] / overall[0], 3) if overall[0] else None,
            "ci": wilson(overall[1], overall[0]),
            "by_first_minute": {k: {"teams": n, "still_won": round(w / n, 3), "ci": wilson(w, n)}
                                for k, (n, w) in sorted(by_min.items())}}

    # Stays below: the chance stayed under the threshold for 2 straight minutes (a steadier trigger for a hint).
    steady = {}
    for th in (0.10, 0.15, 0.20):
        n = w = 0
        for gi, rs in enumerate(per_game):
            seq = [(m, oof.get((gi, m)), y) for m, ft, y in rs if m >= 8 and (gi, m) in oof]
            for side in (100, 200):
                for (m1, p1, y), (m2, p2, _) in zip(seq, seq[1:]):
                    a, b = (p1, p2) if side == 100 else (1 - p1, 1 - p2)
                    if a < th and b < th:
                        n += 1
                        w += 1 if (y if side == 100 else not y) else 0
                        break
        steady[f"below_{int(th * 100)}%_two_minutes"] = {"teams": n, "still_won": round(w / n, 3) if n else None,
                                                         "ci": wilson(w, n)}

    out = {
        "games": len(per_game), "games_without_timeline": missing, "features": FEATURES,
        "models_by_minute_band": models, "out_of_fold_scores": scored, "calibration_from_minute_5": calibration,
        "surrender_first_time_below": ff, "surrender_steady": steady,
    }
    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
