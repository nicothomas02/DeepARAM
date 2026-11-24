"""Each patch's teammate-pair synergy, saved so the Duos list can check a pair's boost holds across patches
(Nico 2026-11-24: "Build duo checks").

Writes data/cn/history/partners/<patch>.json: {"patch", "date", "pairs": {"<low id>-<high id>": synergy}}, where
synergy is the pair's win rate minus the win rate its two champions' own rates predict (web/src/lib/synergy.ts: their
log-odds add up), in win-rate fractions. Both rates are 101's from the same day (best_partners in
data/cn/champions.json; the champion's own rate from data/cn/history/daily, because merge.py lays AramHex's
champion rates over champions.json and the two sources differ by ~0.7 points per champion).

Run after fetch_cn.py and history.py: it rewrites the live patch's file from today's snapshot; an ended patch's file
keeps its last snapshot. --backfill rebuilds ended patches from git history (the last champions.json committed on or
before each patch's last day).
"""
import argparse
import csv
import json
import math
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "history", "partners")
DAILY = os.path.join(HERE, "history", "daily")


def logit(p):
    p = min(0.99, max(0.01, p))
    return math.log(p / (1 - p))


def expected(a, b):
    return 1 / (1 + math.exp(-(logit(a) + logit(b))))


def daily_rates(date):
    """101's own champion win rates on a day (YYYY-MM-DD)."""
    path = os.path.join(DAILY, f"{date[:7]}.csv")
    if not os.path.exists(path):
        return {}
    with open(path, newline="") as f:
        return {int(r["champion_id"]): float(r["win_rate"]) for r in csv.DictReader(f) if r["date"] == date}


def pairs(champs, solo):
    out = {}
    for c in champs:
        a = c["champion_id"]
        for p in c.get("best_partners") or []:
            b = p["champion_id"]
            if a not in solo or b not in solo or p.get("win_rate") is None:
                continue
            key = "-".join(map(str, sorted((a, b))))
            out.setdefault(key, round(p["win_rate"] - expected(solo[a], solo[b]), 4))
    return out


def snapshot(d):
    raw = d["meta"].get("champion_stat_date") or ""
    date = f"{raw[:4]}-{raw[4:6]}-{raw[6:]}" if len(raw) == 8 else None
    solo = daily_rates(date) if date else {}
    return date, pairs(d["champions"], solo)


def write(patch, date, got):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{patch}.json"), "w") as f:
        json.dump({"patch": patch, "date": date, "pairs": got}, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print(f"{patch}: {len(got)} pairs ({date})")


def patches():
    with open(os.path.join(HERE, "history", "patches.csv"), newline="") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="rebuild ended patches from git history")
    a = ap.parse_args()
    ps = patches()
    if a.backfill:
        for p in ps[:-1]:
            sha = subprocess.run(["git", "log", "-1", "--format=%H", f"--until={p['last_day']} 23:59:59", "--", "data/cn/champions.json"],
                                 cwd=REPO, capture_output=True, text=True).stdout.strip()
            if not sha:
                continue
            d = json.loads(subprocess.run(["git", "show", f"{sha}:data/cn/champions.json"], cwd=REPO, capture_output=True, text=True).stdout)
            date, got = snapshot(d)
            # Only a snapshot from inside the patch's own window speaks for it.
            if got and date and p["window_start"] <= date <= p["last_day"]:
                write(p["patch"], date, got)
    with open(os.path.join(HERE, "champions.json")) as f:
        date, got = snapshot(json.load(f))
    if got:
        write(ps[-1]["patch"], date, got)


if __name__ == "__main__":
    main()
