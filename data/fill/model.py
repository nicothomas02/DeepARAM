"""Shared pieces of the spell and game-count estimates (standard library only).

Game counts: pick rate is a champion's share of all games, so its games are pick rate x total.
The total comes from win-rate noise in the cumulative daily feed (estimate_daily_games).

Spells: Flash is in ~99% of Mayhem loadouts, so the model predicts the second spell from the
Mayhem pool (no Exhaust) with a softmax over: Data Dragon class tags, melee/ranged and move speed,
the champion's Mayhem stats (damage share, tank share, kill participation, time dead), and its
Summoner's Rift spell shares with Exhaust's share moved to Heal.
fit_spells.py fits the coefficients into spell_model.json.
"""

import csv
import glob
import json
import math
import os
import statistics
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HISTORY = os.path.join(REPO, "data", "cn", "history")

FLASH, EXHAUST, SMITE, TELEPORT = 4, 3, 11, 12
# Mark, Ghost, Barrier, Heal, Ignite, Clarity, Cleanse: the non-Flash Mayhem pool
SPELLS = [32, 6, 21, 7, 14, 13, 1]
NO_RIFT = {32, 13}  # Mark and Clarity don't exist on Summoner's Rift
EXHAUST_TO = {7: 1.0}
TAGS = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"]
LANES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT")

RIFT_API = "https://mlol.qt.qq.com/go/battle_info/odp_proxy/lol_101strategy_skill"
HEADERS = {"Referer": "https://101.qq.com/", "User-Agent": "Mozilla/5.0"}


# ---------- inputs ----------

def history_days():
    """{date: {champion id: (win rate, pick rate)}} from the daily Tencent history."""
    by = defaultdict(dict)
    for f in sorted(glob.glob(os.path.join(HISTORY, "daily", "*.csv"))):
        with open(f, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                by[r["date"]][r["champion_id"]] = (float(r["win_rate"]), float(r["pick_rate"]))
    return by


def patches():
    with open(os.path.join(HISTORY, "patches.csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def patch_stats(patch):
    """{champion id: by_patch.csv row} for one patch."""
    with open(os.path.join(HISTORY, "by_patch.csv"), encoding="utf-8") as f:
        return {r["champion_id"]: r for r in csv.DictReader(f) if r["patch"] == patch}


def data_dragon():
    """{champion id: (tags, stats)} from the newest Data Dragon copy in the repo."""
    dirs = sorted(glob.glob(os.path.join(REPO, "web", "public", "assets", "dd", "[0-9]*")),
                  key=lambda p: [int(x) for x in os.path.basename(p).split(".")])
    with open(os.path.join(dirs[-1], "data", "en_US", "champion.json"), encoding="utf-8") as f:
        data = json.load(f)["data"]
    return {v["key"]: (v["tags"], v["stats"]) for v in data.values()}


def _rift_one(champion, lane, version):
    url = f"{RIFT_API}?championid={champion}&itier=255&version_id={version}&lane={lane}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as r:
                res = json.loads(r.read().decode("utf-8"))["data"]["result"]
            return json.loads(res)["data_details"] if res else ""
        except Exception:
            time.sleep(1 + attempt)
    return None


def rift_spells(champions, version, workers=6):
    """{champion id: {spell id: share}}: Rift spell shares besides Flash, Smite and Teleport,
    each lane with data weighted equally. Raw lane strings are spellA_spellB_winrate_pickrate#..."""
    jobs = [(c, lane) for c in champions for lane in LANES]
    with ThreadPoolExecutor(workers) as ex:
        raw = list(ex.map(lambda j: (j, _rift_one(j[0], j[1], version)), jobs))
    lanes = defaultdict(list)
    for (c, _), v in raw:
        if v:
            lanes[c].append(v)
    return {c: rift_shares(lanes.get(c, [])) for c in champions}


def rift_shares(lane_strings):
    acc, n = defaultdict(float), 0
    for v in lane_strings:
        lane = defaultdict(float)
        for part in v.split("#"):
            a, b, _, pick = part.split("_")
            pair = (int(a), int(b))
            for s in pair:
                if s != FLASH:
                    lane[s] += float(pick) / (1 if FLASH in pair else 2)
        total = sum(x for s, x in lane.items() if s not in (SMITE, TELEPORT))
        if total > 0:
            n += 1
            for s, x in lane.items():
                if s not in (SMITE, TELEPORT):
                    acc[s] += x / total
    return {s: x / n for s, x in acc.items()} if n else {}


# ---------- spell model ----------

def numeric(stats_row, dd_stats):
    """Six roughly centred numbers per champion."""
    if stats_row:
        f = [float(stats_row["avg_damage_ratio"]) * 5 - 1, float(stats_row["avg_tank_ratio"]) * 5 - 1,
             float(stats_row["avg_participation_rate"]) * 2 - 1.2, float(stats_row["avg_death_time"]) / 100 - 2.5]
    else:
        f = [0.0] * 4
    f.append(1.0 if (dd_stats or {}).get("attackrange", 500) <= 250 else 0.0)
    f.append((dd_stats or {}).get("movespeed", 335) / 10 - 33.5)
    return f


def features(tags, num, rift):
    """One feature row per spell in SPELLS. Each tag and number gets its own coefficient per spell;
    the Rift share shares one coefficient across spells."""
    rows = []
    for s in SPELLS:
        row = [1.0 if (t in tags and s == ss) else 0.0 for ss in SPELLS for t in TAGS]
        row += [num[j] if s == ss else 0.0 for ss in SPELLS for j in range(len(num))]
        share = rift.get(s, 0.0) + rift.get(EXHAUST, 0.0) * EXHAUST_TO.get(s, 0.0)
        row.append(0.0 if s in NO_RIFT else math.log(share + 0.01))
        rows.append(row)
    return rows


def predict(model, rows):
    z = [b + sum(g * x for g, x in zip(model["coef"], row)) for b, row in zip(model["bias"], rows)]
    m = max(z)
    e = [math.exp(v - m) for v in z]
    t = sum(e)
    return [v / t for v in e]


# ---------- game counts ----------

MED_CHI2_1 = 0.4549


def _daily_new(data, kmax):
    """Per day k (2..kmax) of a patch window: {champion: (win rate of that day's new games, new pick share)}.
    Unit-free: the cumulative counts are pick rate x days x (unknown games per day)."""
    out = []
    for k in range(2, min(len(data), kmax) + 1):
        prev, cur, d = data[k - 2], data[k - 1], {}
        for c, (w2, p2) in cur.items():
            if c in prev:
                w1, p1 = prev[c]
                inc = k * p2 - (k - 1) * p1
                if inc > 0.005:
                    d[c] = ((k * p2 * w2 - (k - 1) * p1 * w1) / inc, inc)
        out.append(d)
    return out


def estimate_daily_games(data, kmax=8, max_lag=3):
    """Games per day in one patch window, from how much each champion's daily win rate jitters.
    Binomial noise shrinks with games (1 / (N x pick share)); real drift grows with the lag between
    days and doesn't depend on pick share, so fitting both separates them. Returns (games/day, drift)."""
    inc = _daily_new(data, kmax)
    pts = []
    for i in range(len(inc)):
        for lag in range(1, max_lag + 1):
            if i + lag >= len(inc):
                break
            a, b = inc[i], inc[i + lag]
            for c in a:
                if c in b:
                    (x1, m1), (x2, m2) = a[c], b[c]
                    w = (x1 + x2) / 2
                    q = w * (1 - w) * (1 / m1 + 1 / m2)
                    pts.append(((x1 - x2) ** 2 / q, lag / q))
    if len(pts) < 100:
        return None, None
    cut = sorted(t for t, _ in pts)[int(len(pts) * 0.98)]
    pts = [(t, x) for t, x in pts if t < cut]
    # least squares t = a + b x, then undo the trim (mean of chi2_1 below its 98th percentile)
    n = len(pts)
    mx = sum(x for _, x in pts) / n
    mt = sum(t for t, _ in pts) / n
    b = sum((x - mx) * (t - mt) for t, x in pts) / sum((x - mx) ** 2 for _, x in pts)
    a = (mt - b * mx) / 0.866
    drift = math.sqrt(max(b / 0.866, 0))
    return (1 / a if a > 0 else None), drift


def typical_daily_games(recent=6):
    """Median games per day over the most recent complete patches with low drift and 10+ days."""
    by = history_days()
    dates = sorted(by)
    rows = patches()
    found = []
    for p in reversed(rows[:-1]):  # the live patch is still filling
        win = [d for d in dates if p["window_start"] <= d <= p["last_day"]]
        if len(win) < 10:
            continue
        n, drift = estimate_daily_games([by[d] for d in win])
        if n and drift is not None and drift < 0.0015:
            found.append((p["patch"], n))
        if len(found) == recent:
            break
    return statistics.median(n for _, n in found), found


def round_sig(x, digits=3):
    if x <= 0:
        return 0
    return int(round(x, -int(math.floor(math.log10(x))) + digits - 1))
