#!/usr/bin/env python3
"""Hidden gems: rarely picked choices that win more than the champion's usual ones.

For every champion, each choice the feed lists (starting items, boots, full six-item builds, single
items and three-item cores when those blocks are live) is compared with the champion's other options
for the same slot. A choice is a hidden gem when fewer than 2% of the champion's players take it and
its whole 90% range for next patch's lift is above zero.

Method (per family of choices: starting, boots, full builds, ...):

1. Games. A choice's games = its pick rate x the champion's games, and a champion's games = its pick
   rate x the patch's estimated total (data/stats/games.json, else data/fill/spells_games.json; both
   from the win-rate noise method).
2. Lift. Win rate minus the pick-weighted win rate of every listed option for that champion and slot.
   Comparing within the slot matters: every full-build game reached six items, so full builds win more
   than the champion overall; the options around it are the fair yardstick.
3. Sample interval. A 95% Wilson interval on the choice's win rate, minus the baseline (whose own
   sample is 50x+ larger, so its noise is ignored). Kept for reference: it is far too narrow.
4. Carry-over (out-of-time empirical Bayes). With millions of games, sample noise is small; what
   makes a rare choice's lead unreliable is everything else that moves between patches (balance
   changes, who picks it, the feed's top-N selection: the winner's curse). So the shrinkage is learned
   from time, not from the sample: over rare options seen on both of the last two complete patches,
   fit next lift = alpha + beta x this lift (beta ~0.55-0.6: just over half a rare lead carries over)
   and take the leftover spread, less sample noise, as drift. Each choice's forecast is
   alpha + beta x lift with a 90% range of +-1.645 x sqrt(drift^2 + (1 + beta^2) x sample variance).
   Gems are ranked by the low end of that range.
5. Back-test, cross-validated by champion (fit on 4/5 of champions, check the other 1/5): how often
   the next patch's lift lands inside the 90% range (about 91-92%) against the 95% sample-only interval
   (28-47%), and how many flagged gems still beat their slot next patch against every rare choice.
   Written to `backtest` in the output.

Augments are listed separately and without win rates (Riot's developer policy forbids showing augment
win rates): each champion's augments taken by under 2% that the feed grades S or A for that champion,
ordered by the estimated lift from estimates.json (`augments`, see README.md). There is no game-level
augment data, so no interval; the order is a model estimate and labelled so.

Every gem is then checked against the game data and the Simulator before it's listed (synergy_checks.py):
still sold, not an augment-only item, augment in the live pool and the champion's pool, and not clearly worse
than the usual build in the Simulator. Dropped gems are counted by reason in `checks`.

Feed blocks that stop changing are left out: a block identical for 90%+ of champions to the stats
update 7 days earlier, while the rest of the feed moves, is marked stale (core items, single items and
skill orders have been frozen since 2026-10-16).

Writes data/estimates/synergies.json. Standard library only.

Usage: python3 data/estimates/synergies.py   (needs the git history for the calibration and staleness
check; fill.yml checks it all out)
"""

import datetime as dt
import json
import math
import os
import subprocess
import sys

import common as cm
from synergy_checks import Checker

OUT = os.path.join(cm.HERE, "synergies.json")
GAMES = os.path.join(cm.REPO, "data", "fill", "spells_games.json")
STATS_GAMES = os.path.join(cm.REPO, "data", "stats", "games.json")

MAX_PICK = 0.02  # "rarely picked": under 2% of the champion's players
MIN_GAMES = 100  # below this a choice isn't scored at all
MIN_EDGE = 0.001  # a listed gem's low end is at least 0.1 win rate points
Z95 = 1.96
Z90 = 1.645
STALE_DAYS = 7
FAMILIES = ["starting", "boots", "full_builds", "core", "other"]  # keys of builds.items
TOP = 60  # gems kept per family
AUGMENT_TOP = 120


# --- intervals --------------------------------------------------------------------------------------

def wilson(p, n, z=Z95):
    """95% Wilson score interval for a rate p observed over n games."""
    if n <= 0:
        return 0.0, 1.0
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


try:  # the shared interval helpers, once data/stats/ exists
    sys.path.insert(0, os.path.join(cm.REPO, "data", "stats"))
    from intervals import wilson  # noqa: F811
except Exception:  # pragma: no cover - fall back to the local copy above
    pass


# --- inputs -----------------------------------------------------------------------------------------

def patches():
    import csv
    with open(os.path.join(cm.CN, "history", "patches.csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def daily_games():
    try:
        return cm.load(GAMES)["daily_games"]
    except Exception:
        return 3_000_000


def patch_games(patch_row, per_day=None):
    """A patch's estimated games: the shared per-patch counts (data/stats/games.json) when there, else the
    live estimate's games per day x the patch's days."""
    if per_day is None:
        try:
            matches = cm.load(STATS_GAMES)["patches"][patch_row["patch"]]["matches"]
            if matches:
                return matches
        except Exception:
            pass
    return (per_day or daily_games()) * int(patch_row["days"])


def builds_at(commit):
    """{champion id: builds json} from data/cn/builds/ at an older commit (for the back-test)."""
    rel = "data/cn/builds"
    names = subprocess.check_output(["git", "ls-tree", "--name-only", f"{commit}:{rel}"], cwd=cm.REPO, text=True).split()
    out = {}
    for n in names:
        if n[:1].isdigit() and n.endswith(".json"):
            d = json.loads(subprocess.check_output(["git", "show", f"{commit}:{rel}/{n}"], cwd=cm.REPO, text=True))
            out[str(d["id"])] = d
    return out


def commit_for_day(day):
    """Newest commit whose subject is the daily stats update for `day` (YYYY-MM-DD), or None."""
    try:
        log = subprocess.check_output(["git", "log", "--format=%h %s", "-n", "400"], cwd=cm.REPO, text=True)
    except Exception:
        return None
    for line in log.splitlines():
        h, _, s = line.partition(" ")
        if s.startswith("Update Mayhem stats") and f"({day})" in s:
            return h
    return None


# --- scoring ----------------------------------------------------------------------------------------

def key(o):
    return o["champion"], tuple(sorted(o["items"]))


def options(stats, builds, family, total):
    """Every listed option of one family: champion, items, pick, win, baseline, lift, games, raw interval."""
    out = []
    for c, b in builds.items():
        if c not in stats:
            continue
        rows = b.get("items", {}).get(family) or []
        tot = sum(r["pick_rate"] for r in rows)
        if not rows or tot <= 0:
            continue
        base = sum(r["pick_rate"] * r["win_rate"] for r in rows) / tot
        champ_games = stats[c]["pick_rate"] * total
        for r in rows:
            n = r["pick_rate"] * champ_games
            if n < MIN_GAMES:
                continue
            lo, hi = wilson(r["win_rate"], n)
            out.append({
                "champion": int(c), "items": r["items"], "pick_rate": r["pick_rate"], "win_rate": r["win_rate"],
                "baseline": base, "lift": r["win_rate"] - base, "lift_lo": lo - base, "lift_hi": hi - base,
                "games": n, "var": r["win_rate"] * (1 - r["win_rate"]) / n,
            })
    return out


def rare(opts):
    return [o for o in opts if o["pick_rate"] < MAX_PICK]


def calibrate(before, after):
    """Fit next patch's lift = alpha + beta x this patch's lift over rare options seen in both patches.
    beta is the share of a lift that carries over (the rest was noise, drift or a patch change); the
    leftover spread, less sample noise, is the drift between patches."""
    later = {key(o): o for o in after}
    pairs = [(o, later[key(o)]) for o in rare(before) if key(o) in later]
    if len(pairs) < 20:
        return None
    x = [a["lift"] for a, _ in pairs]
    y = [b["lift"] for _, b in pairs]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sxx = sum((v - mx) ** 2 for v in x)
    beta = sum((u - mx) * (v - my) for u, v in zip(x, y)) / sxx if sxx > 0 else 0.0
    alpha = my - beta * mx
    resid = sum((v - alpha - beta * u) ** 2 for u, v in zip(x, y)) / max(len(x) - 2, 1)
    noise = sum(b["var"] + beta * beta * a["var"] for a, b in pairs) / len(pairs)
    return {"alpha": alpha, "beta": beta, "drift_sd": math.sqrt(max(resid - noise, 1e-6)), "pairs": len(pairs)}


def forecast(o, cal, z=Z90):
    """Next patch's lift for one option: point forecast and a z-sigma interval (drift + sample noise)."""
    f = cal["alpha"] + cal["beta"] * o["lift"]
    sd = math.sqrt(cal["drift_sd"] ** 2 + (1 + cal["beta"] ** 2) * o["var"])
    return f, f - z * sd, f + z * sd


def score(opts, cal):
    out = []
    for o in rare(opts):
        o["forecast"], o["forecast_lo"], o["forecast_hi"] = forecast(o, cal)
        out.append(o)
    return out


def gems(scored):
    """Options whose whole next-patch range is above zero (by more than the 0.1 point the site rounds to)."""
    return sorted((o for o in scored if o["forecast_lo"] >= MIN_EDGE), key=lambda o: -o["forecast_lo"])


def rounded(o):
    keep = ("champion", "items", "pick_rate", "win_rate", "baseline", "lift", "lift_lo", "lift_hi",
            "forecast", "forecast_lo", "forecast_hi", "sim", "sim_gain", "caution")
    r = {k: (round(o[k], 4) if isinstance(o[k], float) else o[k]) for k in keep if k in o}
    r["games"] = int(round(o["games"], -1))
    return r


# --- staleness --------------------------------------------------------------------------------------

def block(b, key):
    if key in ("skills", "augments"):
        return b.get(key)
    return b.get("items", {}).get(key)


def frozen(old, new, key, share=0.9):
    """True when at least `share` of the champions in both snapshots have the identical block."""
    both = [c for c in new if c in old]
    if not both:
        return False
    same = sum(json.dumps(block(old[c], key), sort_keys=True) == json.dumps(block(new[c], key), sort_keys=True) for c in both)
    return same / len(both) >= share


def staleness(builds, today, previous=None):
    """Blocks that haven't changed for STALE_DAYS+ days (compared with the stats update that many days
    back) while the rest of the feed moved. Without that history, the last run's list is kept."""
    day = (dt.date.fromisoformat(today) - dt.timedelta(days=STALE_DAYS)).isoformat()
    commit = commit_for_day(day)
    if not commit:
        return list(previous or [])
    try:
        old = builds_at(commit)
    except Exception:
        return list(previous or [])
    keys = FAMILIES + ["skills", "augments"]
    still = [k for k in keys if frozen(old, builds, k)]
    return still if len(still) < len(keys) else []


# --- augments (no win rates shown) ------------------------------------------------------------------

def augment_gems(stats, builds, est, total, checker=None):
    out = []
    for c, b in builds.items():
        if c not in stats:
            continue
        lifts = {str(r["id"]): r["lift"] for r in est.get(c, [])}
        champ_games = stats[c]["pick_rate"] * total
        for a in b["augments"]["all"]:
            aid = str(a["id"])
            if a["pick_rate"] >= MAX_PICK or a.get("grade") not in ("S", "A") or aid not in lifts:
                continue
            games = a["pick_rate"] * champ_games
            if games < MIN_GAMES or lifts[aid] <= 0:
                continue
            out.append({"champion": int(c), "id": a["id"], "pick_rate": a["pick_rate"], "grade": a["grade"],
                        "games": int(round(games, -1)), "_score": lifts[aid]})
    out.sort(key=lambda r: -r["_score"])
    if checker:
        # Check a few more than are kept, since some get dropped.
        out = checker.augments(out[: AUGMENT_TOP * 2])
    out = out[:AUGMENT_TOP]
    for i, r in enumerate(out, 1):
        r["rank"] = i
        del r["_score"]
    return out


# --- back-test --------------------------------------------------------------------------------------

def two_patches():
    """Options on the last two complete patches, per family: {family: (before, after)}, and their names."""
    rows = patches()
    complete = [p for p in rows[:-1] if int(p["days"]) >= 7]
    if len(complete) < 2:
        return None, None
    a, b = complete[-2], complete[-1]
    ca, cb = commit_for_day(a["last_day"]), commit_for_day(b["last_day"])
    if not ca or not cb:
        return None, None
    ba, bb = builds_at(ca), builds_at(cb)
    sa, sb = cm.champion_stats(a["patch"]), cm.champion_stats(b["patch"])
    out = {}
    for fam in FAMILIES:
        # A frozen block would "carry over" perfectly; it can't be used to calibrate anything.
        if frozen(ba, bb, fam):
            continue
        out[fam] = (options(sa, ba, fam, patch_games(a)), options(sb, bb, fam, patch_games(b)))
    return out, [a["patch"], b["patch"]]


def backtest(data, folds=5):
    """Cross-validated by champion: fit the carry-over on 4/5 of champions, then on the other 1/5 check
    (1) how often next patch's lift lands inside the 90% forecast interval, against the naive 95%
    sample-only interval, and (2) whether the flagged gems still beat their slot next patch."""
    report = {}
    for fam, (before, after) in data.items():
        later = {key(o): o for o in after}
        champs = sorted({o["champion"] for o in before})
        inside = naive = seen = 0
        flagged, hits, lifts = 0, 0, []
        every = [later[key(o)]["lift"] for o in rare(before) if key(o) in later]
        for k in range(folds):
            test = set(champs[k::folds])
            cal = calibrate([o for o in before if o["champion"] not in test], [o for o in after if o["champion"] not in test])
            if not cal:
                continue
            held = [dict(o) for o in before if o["champion"] in test]
            for o in score(held, cal):
                if key(o) not in later:
                    continue
                y = later[key(o)]["lift"]
                seen += 1
                inside += o["forecast_lo"] <= y <= o["forecast_hi"]
                naive += o["lift_lo"] <= y <= o["lift_hi"]
                if o["forecast_lo"] >= MIN_EDGE:
                    flagged += 1
                    hits += y > 0
                    lifts.append(y)
        if not seen:
            continue
        report[fam] = {
            "checked": seen,
            "forecast_90_coverage": round(inside / seen, 3),
            "sample_only_95_coverage": round(naive / seen, 3),
            "gems_checked": flagged,
            "gems_still_ahead": round(hits / flagged, 3) if flagged else None,
            "gems_mean_lift_next_patch": round(sum(lifts) / len(lifts), 4) if lifts else None,
            "every_rare_still_ahead": round(sum(v > 0 for v in every) / len(every), 3) if every else None,
            "every_rare_mean_lift_next_patch": round(sum(every) / len(every), 4) if every else None,
        }
    return report


# --- main -------------------------------------------------------------------------------------------

def pooled(cals):
    """Average carry-over for a family with none of its own (weighted by pairs)."""
    vals = [c for c in cals.values() if c]
    n = sum(c["pairs"] for c in vals)
    if not n:
        return {"alpha": 0.0, "beta": 0.5, "drift_sd": 0.025, "pairs": 0}
    return {k: sum(c[k] * c["pairs"] for c in vals) / n for k in ("alpha", "beta", "drift_sd")} | {"pairs": 0}


def main():
    rows = patches()
    live = rows[-1]
    stats, builds = cm.champion_stats(live["patch"]), cm.builds()
    total = patch_games(live)
    old = {}
    if os.path.exists(OUT):
        try:
            old = cm.load(OUT)
        except Exception:
            old = {}
    today = max((b.get("date") or "") for b in builds.values()) or dt.date.today().isoformat()
    stale = staleness(builds, today, old.get("stale"))

    # Carry-over fitted on the last two complete patches; needs git history (fill.yml checks out all of
    # it), otherwise the last fit is kept.
    cals, bt, fitted_on = {}, None, None
    try:
        data, fitted_on = two_patches()
        if data:
            cals = {fam: calibrate(*pair) for fam, pair in data.items()}
            bt = backtest(data)
    except Exception as e:
        print(f"calibration skipped: {e}", file=sys.stderr)
    if not any(cals.values()) and old.get("calibration"):
        cals = {k: v for k, v in old["calibration"].items() if isinstance(v, dict) and "beta" in v}
        fitted_on = old.get("calibrated_on")
    fallback = pooled(cals)
    checker = Checker(builds)

    out = {"patch": live["patch"], "estimated": True,
           "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "max_pick": MAX_PICK, "games": total, "stale": stale, "calibrated_on": fitted_on,
           "calibration": {k: {kk: round(vv, 4) if isinstance(vv, float) else vv for kk, vv in v.items()}
                           for k, v in cals.items() if v},
           "items": {}}
    for fam in FAMILIES:
        if fam in stale:
            continue
        found = gems(score(options(stats, builds, fam, total), cals.get(fam) or fallback))
        out["items"][fam] = [rounded(o) for o in checker.items(fam, found)[:TOP]]
    est = cm.load(os.path.join(cm.HERE, "estimates.json")).get("augments", {})
    out["augments"] = [] if "augments" in stale else augment_gems(stats, builds, est, total, checker)
    out["checks"] = {"simulator": checker.sim, "dropped": checker.dropped}
    out["backtest"] = bt or old.get("backtest")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    counts = ", ".join(f"{k} {len(v)}" for k, v in out["items"].items())
    print(f"patch {live['patch']}: hidden gems {counts}; augments {len(out['augments'])}; stale {stale or 'none'}")
    print(json.dumps({"calibration": out["calibration"], "backtest": out["backtest"]}, indent=1))


if __name__ == "__main__":
    main()
