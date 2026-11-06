#!/usr/bin/env python3
"""Keep one snapshot of every champion's item lists per patch, for item pages' range views.

builds/<id>.json only ever holds the newest numbers, so after each stats update this copies their
starting, boots and other item lists into history/items/<patch>.json, where <patch> is the patch
whose window the builds' date falls in (history/patches.csv). The file is rewritten every day of
the patch, so once the next patch starts it keeps that patch's last numbers.

Each file: {"patch", "date", "champions": {"<champion id>": {"starting"|"boots"|"other":
[[item ids], pick_rate, win_rate or null], ...}}}.

Usage: python3 data/cn/item_history.py                  # from builds/ (history.py runs this too)
       python3 data/cn/item_history.py --git <commit>   # backfill from an older commit's builds/
Standard library only.
"""

import argparse
import csv
import glob
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDS = os.path.join(HERE, "builds")
PATCHES = os.path.join(HERE, "history", "patches.csv")
OUT = os.path.join(HERE, "history", "items")
LISTS = ("starting", "boots", "other")


def patch_of(date, patches):
    """The patch whose data window holds this date (the last one opening on or before it)."""
    found = None
    for p in patches:
        if p["window_start"] <= date:
            found = p["patch"]
    return found


def snapshot(builds):
    """{champion id: {list: [[items], pick, win]}} from parsed builds files."""
    out = {}
    for b in builds:
        items = b.get("items") or {}
        lists = {k: [[e["items"], e["pick_rate"], e.get("win_rate")] for e in items.get(k) or []] for k in LISTS}
        if any(lists.values()):
            out[str(b["id"])] = lists
    return out


def read_builds(commit=None):
    if commit is None:
        files = sorted(glob.glob(os.path.join(BUILDS, "[0-9]*.json")))
        return [json.load(open(f, encoding="utf-8")) for f in files]
    root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=HERE, text=True).strip()
    rel = os.path.relpath(BUILDS, root)
    names = subprocess.check_output(["git", "ls-tree", "--name-only", f"{commit}:{rel}"], cwd=root, text=True).split()
    return [json.loads(subprocess.check_output(["git", "show", f"{commit}:{rel}/{n}"], cwd=root, text=True))
            for n in names if n[:1].isdigit() and n.endswith(".json")]


def archive(commit=None):
    with open(PATCHES, encoding="utf-8") as f:
        patches = list(csv.DictReader(f))
    builds = read_builds(commit)
    dates = sorted({b.get("date", "") for b in builds if b.get("date")})
    if not dates:
        print("item history: no builds")
        return
    date = dates[-1]
    patch = patch_of(date, patches)
    if not patch:
        print(f"item history: no patch window for {date}")
        return
    os.makedirs(OUT, exist_ok=True)
    data = {"patch": patch, "date": date, "champions": snapshot(b for b in builds if patch_of(b.get("date", ""), patches) == patch)}
    with open(os.path.join(OUT, f"{patch}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"item history: {patch} from {date} ({len(data['champions'])} champions)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--git", help="read builds/ as of this commit instead of the working tree")
    archive(ap.parse_args().git)
