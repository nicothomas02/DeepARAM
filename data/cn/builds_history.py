#!/usr/bin/env python3
"""Keep one snapshot of every champion's build data per patch, for the champion page's timeframe picker.

101.qq.com only serves the newest day for per-champion augments, skill orders and items, and builds/<id>.json
only holds those newest numbers. So after each stats update this copies them into history/builds/<patch>.json,
where <patch> is the patch whose window the builds' date falls in (history/patches.csv). The file is rewritten
every day of the patch, so once the next patch starts it keeps that patch's last numbers. Same idea as
item_history.py, for everything on the champion page's game card.

Each file: {"patch", "date", "champions": {"<champion id>": {"augments": [[id, pick_rate, grade], ...],
"skills": [...as in builds/], "items": {"starting"|"boots"|"core"|"other"|"full_builds": [[item ids], pick, win]}}}}.

Usage: python3 data/cn/builds_history.py                  # from builds/ (history.py runs this too)
       python3 data/cn/builds_history.py --git <commit>   # backfill from an older commit's builds/
       python3 data/cn/builds_history.py --backfill       # the last commit of every patch in git history
Standard library only.
"""

import argparse
import csv
import json
import os
import subprocess

import builds as cn_builds
import item_history as ih

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "history", "builds")
LISTS = ("starting", "boots", "core", "other", "full_builds")


def snapshot(builds):
    out = {}
    for b in builds:
        items = dict(b.get("items") or {})
        # Core builds and single items rebuilt from the six-item builds: redo them with today's rule (builds.py), so
        # old snapshots match the live page.
        derived = b.get("derived") or []
        if derived and items.get("full_builds"):
            core, other = cn_builds.from_full_builds(items["full_builds"], cn_builds.BOOTS)
            if "items.core" in derived and core:
                items["core"] = core
            if "items.other" in derived and other:
                items["other"] = other
        augs = (b.get("augments") or {}).get("all") or []
        entry = {
            "augments": [[a["id"], a["pick_rate"], a.get("grade") or ""] for a in augs],
            "skills": b.get("skills") or [],
            "items": {k: [[e["items"], e["pick_rate"], e.get("win_rate")] for e in items.get(k) or []] for k in LISTS},
        }
        if entry["augments"] or any(entry["items"].values()):
            out[str(b["id"])] = entry
    return out


def archive(commit=None):
    with open(ih.PATCHES, encoding="utf-8") as f:
        patches = list(csv.DictReader(f))
    builds = ih.read_builds(commit)
    dates = sorted({b.get("date", "") for b in builds if b.get("date")})
    if not dates:
        print("builds history: no builds")
        return
    date = dates[-1]
    patch = ih.patch_of(date, patches)
    if not patch:
        print(f"builds history: no patch window for {date}")
        return
    os.makedirs(OUT, exist_ok=True)
    data = {"patch": patch, "date": date,
            "champions": snapshot(b for b in builds if ih.patch_of(b.get("date", ""), patches) == patch)}
    with open(os.path.join(OUT, f"{patch}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"builds history: {patch} from {date} ({len(data['champions'])} champions)")


def backfill():
    """Each patch's last commit that touched builds/, oldest first, then the working tree."""
    root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=HERE, text=True).strip()
    rel = os.path.relpath(os.path.join(HERE, "builds"), root)
    log = subprocess.check_output(["git", "log", "--reverse", "--format=%H %ad", "--date=short", "--", rel],
                                  cwd=root, text=True).split("\n")
    with open(ih.PATCHES, encoding="utf-8") as f:
        patches = list(csv.DictReader(f))
    last = {}
    for line in filter(None, log):
        sha, day = line.split()
        p = ih.patch_of(day, patches)
        if p:
            last[p] = sha
    for p, sha in last.items():
        archive(sha)
    archive()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--git", help="read builds/ as of this commit instead of the working tree")
    ap.add_argument("--backfill", action="store_true")
    a = ap.parse_args()
    backfill() if a.backfill else archive(a.git)
