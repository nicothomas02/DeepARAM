#!/usr/bin/env python3
"""Early-window build estimates: each champion's six-item builds while the feed has too few games for them.

The builds feed (data/cn/builds/) is cumulative over its own window, which restarts every week or two and
does not line up with patch releases. Right after a restart a rare champion's builds stand on a few hundred
games, and its best build jumps around from day to day. For those days this blends each build with the same
build at the end of the previous window, moved for what a patch changed in between:

  prior   = the build's win rate at the end of the previous window
            + the champion's win rate change between the two patches (champion stats, which have far more
              games than any one build), when a patch was released in between
            + for items that patch changed (the PBE change tracker's item list for it), the item's win rate
              change pooled over every champion who builds it and shrunk toward no change by ITEM_PRIOR_GAMES;
              builds with an item the patch removed are dropped
            (both scaled by the share of the window's days on the new patch)
  blended = (games * this window's win rate + w * prior) / (games + w), w = min(PRIOR_GAMES, the prior's games)

Pick rates blend the same way at the champion level (CHAMP_PRIOR_GAMES). A build is "estimated" while it has
fewer than MIN_GAMES games this window; a champion is estimated while most of its listed builds are.
Games per build = the champion's games per day (data/fill/spells_games.json) x days in the window x pick rate.

The window start is found in the git history: a restart re-shares every build's pick rate at once, so the
day-to-day pick rate change jumps to RESET_JUMP times its usual size.

Writes data/estimates/early_builds.json:
  {"date", "window_start", "prior_date", "days", "min_games", "prior_games", "patches": [prior, now],
   "item_changes": {"<item id>": change}, "removed_items": [ids],
   "champions": {"<id>": {"estimated": bool, "games": n, "full_builds": [{"items", "pick_rate", "win_rate",
                  "games", "estimated"}], "core": [...], "other": [...]}}}
Only champions with at least one estimated build are listed.

Usage: python3 data/estimates/early_builds.py             (needs the git history: fill.yml checks out all of it)
       python3 data/estimates/early_builds.py --backtest  (scores the blend on the windows in the history)
Standard library only.
"""

import argparse
import csv
import datetime as dt
import glob
import json
import os
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "data", "cn"))
import builds as cn_builds  # noqa: E402  (from_full_builds, BOOTS)

BUILDS_DIR = "data/cn/builds"
TRACKER = "data/pbe/tracker.json"
OUT = os.path.join(HERE, "early_builds.json")
GAMES = os.path.join(REPO, "data", "fill", "spells_games.json")
PATCHES = os.path.join(REPO, "data", "cn", "history", "patches.csv")
BY_PATCH = os.path.join(REPO, "data", "cn", "history", "by_patch.json")

MIN_GAMES = 400  # a build with fewer games this window is shown as estimated (95% range about +-5 points)
PRIOR_GAMES = 800  # the previous window's most weight, in this window's games (picked with --backtest)
CHAMP_PRIOR_GAMES = 20000  # the previous window's weight on pick rates, in champion games
ITEM_PRIOR_GAMES = 5000  # pooled item changes are shrunk toward no change by this many games
RESET_JUMP = 5  # a day whose mean pick rate change is this many times the median starts a new window
LOOKBACK = 90  # commits of builds history to read


def git(*args, input_text=None):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True,
                          input=input_text).stdout


def parse_batch(raw):
    """Bodies from `git cat-file --batch` output."""
    out, i = [], 0
    data = raw.encode("utf-8")
    while i < len(data):
        nl = data.index(b"\n", i)
        head = data[i:nl].split()
        i = nl + 1
        if len(head) < 3 or head[1] == b"missing":
            continue
        size = int(head[2])
        out.append(data[i:i + size].decode("utf-8"))
        i += size + 1
    return out


def daily_snapshots(limit=LOOKBACK):
    """[(date, {champion id: builds json})] oldest first, one per feed date, read from git history."""
    revs = git("log", f"-{limit}", "--format=%H", "--", f"{BUILDS_DIR}/103.json").split()
    seen, out = set(), []
    for rev in revs:
        names = [n for n in git("ls-tree", "--name-only", f"{rev}:{BUILDS_DIR}").split()
                 if n[:1].isdigit() and n.endswith(".json")]
        blobs = git("cat-file", "--batch", input_text="".join(f"{rev}:{BUILDS_DIR}/{n}\n" for n in names))
        snap = {}
        for body in parse_batch(blobs):
            try:
                d = json.loads(body)
            except ValueError:
                continue
            if "items" in d:
                snap[str(d["id"])] = d
        date = max(filter(None, (d.get("date") for d in snap.values())), default=None)
        if date and date not in seen:
            seen.add(date)
            out.append((date, snap))
    return sorted(out, key=lambda x: x[0])


def full_map(d):
    return {tuple(sorted(r["items"])): r for r in (d.get("items") or {}).get("full_builds") or []}


def pick_change(a, b):
    """Mean absolute pick rate change of the builds two snapshots share."""
    diffs = []
    for cid in a.keys() & b.keys():
        fa, fb = full_map(a[cid]), full_map(b[cid])
        diffs += [abs(fa[k]["pick_rate"] - fb[k]["pick_rate"]) for k in fa.keys() & fb.keys()]
    return statistics.mean(diffs) if diffs else 0.0


def window_starts(snaps):
    """Indexes into snaps where a new window starts (the first snapshot after a restart)."""
    jumps = [pick_change(snaps[i - 1][1], snaps[i][1]) for i in range(1, len(snaps))]
    if not jumps:
        return []
    usual = statistics.median(jumps) or 1e-9
    starts = []
    for i, j in enumerate(jumps):
        # A restart can take two feed days to settle; the second jump belongs to the same window.
        if j >= RESET_JUMP * usual and not (starts and starts[-1] == i):
            starts.append(i + 1)
    return starts


# ---------- what a patch changed ----------

def patch_windows():
    with open(PATCHES, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def patch_of(date, windows):
    found = None
    for w in windows:
        if w["window_start"] <= date:
            found = w["patch"]
    return found


def champion_win_rates(patch):
    rows = (json.load(open(BY_PATCH, encoding="utf-8")).get("champions") or {}).get(patch) or []
    return {str(r["id"]): r["win_rate"] for r in rows if r.get("win_rate") is not None}


def item_ids():
    """{item name: [ids]} from the self-hosted Data Dragon item list (a name can have a mode's own copy)."""
    files = sorted(glob.glob(os.path.join(REPO, "web", "public", "assets", "dd", "*", "data", "en_US", "item.json")))
    out = {}
    for k, v in (json.load(open(files[-1], encoding="utf-8"))["data"].items() if files else []):
        out.setdefault(v["name"], []).append(int(k))
    return out


def patch_item_changes(patch):
    """({item id: tag}, {removed item ids}) for the items a patch changed: the change tracker's last list
    for that patch from before it went live."""
    names = item_ids()
    for rev in git("log", "--format=%H", "--", TRACKER).split():
        try:
            t = json.loads(git("show", f"{rev}:{TRACKER}"))
        except (ValueError, subprocess.CalledProcessError):
            continue
        if not str((t.get("builds") or {}).get("pbe", "")).startswith(patch + "."):
            continue
        items = [e for e in t.get("entries") or [] if e.get("kind") == "item"]
        if not items:
            continue
        changed = {i: e.get("tag") for e in items for i in names.get(e.get("name"), [])}
        return changed, {i for i, tag in changed.items() if tag == "removed"}
    return {}, set()


# ---------- the blend ----------

def item_rates(d):
    """{item: (share of the champion's listed builds, win rate)} from its six-item builds."""
    _, other = cn_builds.from_full_builds(d["items"]["full_builds"], cn_builds.BOOTS)
    return {r["items"][0]: (r["pick_rate"], r["win_rate"]) for r in other}


def item_changes(cur, prior, games_now, games_then, only):
    """{item: win rate change} for the items in `only`, pooled over champions and shrunk toward 0."""
    num, den = {}, {}
    for cid in cur.keys() & prior.keys():
        a, b = item_rates(cur[cid]), item_rates(prior[cid])
        fa = sum(r["pick_rate"] for r in cur[cid]["items"]["full_builds"])
        fb = sum(r["pick_rate"] for r in prior[cid]["items"]["full_builds"])
        for item in (a.keys() & b.keys()) & set(only):
            n1 = games_now.get(cid, 0) * fa * a[item][0]
            n2 = games_then.get(cid, 0) * fb * b[item][0]
            if n1 <= 0 or n2 <= 0:
                continue
            w = n1 * n2 / (n1 + n2)
            num[item] = num.get(item, 0) + w * (a[item][1] - b[item][1])
            den[item] = den.get(item, 0) + w
    return {i: num[i] / (den[i] + ITEM_PRIOR_GAMES) for i in num}


def champion_games(days):
    """{champion id: games in a window of `days` days}, from the per-patch game estimates."""
    g = json.load(open(GAMES, encoding="utf-8"))
    patch_days = max(1.0, (g.get("total_games") or 0) / (g.get("daily_games") or 1))
    return {cid: c.get("games", 0) / patch_days * days for cid, c in (g.get("champions") or {}).items()}


def blend(cur, prior, games, prior_games, shift=0.0, items=None, removed=(), prior_weight=None):
    """Blended full builds for one champion. cur and prior are builds json, games their champion games,
    shift the champion's win rate change, items the changed items' win rate changes."""
    prior_weight = PRIOR_GAMES if prior_weight is None else prior_weight
    items = items or {}
    now, then = full_map(cur), full_map(prior)
    out = []
    for key in now.keys() | then.keys():
        if set(key) & set(removed):
            continue
        r, p = now.get(key), then.get(key)
        n = games * r["pick_rate"] if r else 0.0
        if p and p.get("win_rate") is not None:
            moved = p["win_rate"] + shift + sum(items.get(i, 0.0) for i in key)
            k = min(prior_weight, prior_games * p["pick_rate"])
        else:
            moved, k = (r["win_rate"] if r else 0.5), 0.0
        if not r and k == 0:
            continue
        wr_now = r["win_rate"] if r and r.get("win_rate") is not None else moved
        win = (n * wr_now + k * moved) / (n + k) if n + k else wr_now
        pick = (games * (r["pick_rate"] if r else 0.0) + CHAMP_PRIOR_GAMES * (p["pick_rate"] if p else 0.0)) \
            / (games + CHAMP_PRIOR_GAMES)
        out.append({"items": list((r or p)["items"]), "pick_rate": round(pick, 4), "win_rate": round(win, 4),
                    "games": int(round(n)), "estimated": n < MIN_GAMES})
    out.sort(key=lambda x: -x["pick_rate"])
    return out[: max(len(now), 10)]


def estimate(snaps, at=None, use_changes=True):
    """The early-window estimate for snapshot index `at` (default: the newest), or None without a prior."""
    at = len(snaps) - 1 if at is None else at
    starts = [s for s in window_starts(snaps[: at + 1]) if s <= at]
    if not starts:
        return None
    start = starts[-1]
    prior_date, prior = snaps[start - 1]
    date, cur = snaps[at]
    days = (dt.date.fromisoformat(date) - dt.date.fromisoformat(snaps[start][0])).days + 1
    first = snaps[starts[-2]][0] if len(starts) > 1 else snaps[0][0]
    span = (dt.date.fromisoformat(prior_date) - dt.date.fromisoformat(first)).days + 1
    games_now, games_then = champion_games(days), champion_games(span)

    windows = patch_windows()
    p_then, p_now = patch_of(prior_date, windows), patch_of(date, windows)
    shifts, items, removed = {}, {}, set()
    if use_changes and p_then and p_now and p_then != p_now:
        # Only the window's days on the new patch carry its changes.
        released = next(w["window_start"] for w in windows if w["patch"] == p_now)
        on_new = (dt.date.fromisoformat(date) - max(dt.date.fromisoformat(released),
                                                    dt.date.fromisoformat(snaps[start][0]))).days + 1
        frac = min(1.0, max(0.0, on_new / days))
        a, b = champion_win_rates(p_now), champion_win_rates(p_then)
        shifts = {cid: (a[cid] - b[cid]) * frac for cid in a.keys() & b.keys()}
        changed, removed = patch_item_changes(p_now)
        items = {i: v * frac for i, v in item_changes(cur, prior, games_now, games_then, set(changed) - removed).items()}

    champs = {}
    for cid, d in cur.items():
        if cid not in prior:
            continue
        rows = blend(d, prior[cid], games_now.get(cid, 0), games_then.get(cid, 0),
                     shifts.get(cid, 0.0), items, removed)
        if not any(r["estimated"] for r in rows):
            continue
        core, other = cn_builds.from_full_builds(rows, cn_builds.BOOTS)
        champs[cid] = {
            "estimated": sum(r["estimated"] for r in rows) * 2 > len(rows),
            "games": int(round(games_now.get(cid, 0))),
            "full_builds": rows, "core": core, "other": other,
        }
    return {"date": date, "window_start": snaps[start][0], "prior_date": prior_date, "days": days,
            "min_games": MIN_GAMES, "prior_games": PRIOR_GAMES, "patches": [p_then, p_now],
            "item_changes": {str(i): round(v, 4) for i, v in sorted(items.items())},
            "removed_items": sorted(removed), "champions": champs}


def backtest(snaps, weights=(0, 100, 200, 400, 800, 1600), days=3):
    """Raw vs blended win rates on each window's first `days` days, against the window's newest day."""
    global PRIOR_GAMES
    starts = window_starts(snaps)
    ends = starts[1:] + [len(snaps)]
    print("windows:", [snaps[s][0] for s in starts])
    keep, results = PRIOR_GAMES, {}
    for k in weights:
        PRIOR_GAMES = k
        err_raw = err_blend = 0.0
        n = 0
        for s, e in zip(starts, ends):
            truth = snaps[e - 1][1]
            for at in range(s, min(s + days, e - 1)):
                est = estimate(snaps, at)
                if not est:
                    continue
                for cid, c in est["champions"].items():
                    t, raw = full_map(truth.get(cid, {})), full_map(snaps[at][1][cid])
                    for r in c["full_builds"]:
                        key = tuple(sorted(r["items"]))
                        if r["estimated"] and key in t and key in raw:
                            err_raw += (raw[key]["win_rate"] - t[key]["win_rate"]) ** 2
                            err_blend += (r["win_rate"] - t[key]["win_rate"]) ** 2
                            n += 1
        if n:
            results[k] = (n, 100 * (err_raw / n) ** .5, 100 * (err_blend / n) ** .5)
            print(f"prior weight {k:5}: {n} builds, raw RMSE {results[k][1]:.2f} pts, blended {results[k][2]:.2f} pts")
    PRIOR_GAMES = keep
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", action="store_true")
    args = ap.parse_args()
    snaps = daily_snapshots()
    if args.backtest:
        backtest(snaps)
        return
    est = estimate(snaps) if snaps else None
    est = est or {"date": snaps[-1][0] if snaps else None, "champions": {}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(est, f, separators=(",", ":"))
        f.write("\n")
    flagged = sum(c["estimated"] for c in est["champions"].values())
    print(f"early builds: window from {est.get('window_start')} ({est.get('days')} days), "
          f"{len(est['champions'])} champions with estimated builds, {flagged} shown as estimated")


if __name__ == "__main__":
    main()
