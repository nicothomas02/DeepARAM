"""Shared loaders for the AramHex files in data/aramhex/patches (written by fetch.py)."""

import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PATCHES = os.path.join(HERE, "patches")
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
SOURCE = "AramHex (github.com/czgreat/aramhex-data), CC BY-NC 4.0"
# A champion row from AramHex replaces the 101 row only with at least this many games (very new champions).
MIN_CHAMP_GAMES = 2000


def load(patch, name):
    path = os.path.join(PATCHES, patch, name + ".json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def patches():
    idx = os.path.join(PATCHES, "index.json")
    if not os.path.exists(idx):
        return []
    with open(idx) as f:
        return json.load(f)["patches"]


def has(patch, name):
    return os.path.exists(os.path.join(PATCHES, patch, name + ".json"))


def carried(patch):
    """Tables AramHex reused from an earlier patch for this one (not this patch's own games)."""
    m = load(patch, "meta") or {}
    return set(m.get("carried_from_earlier_patch") or [])


def matches(patch):
    m = load(patch, "meta") or {}
    return m.get("matches")


def champion_rates(patch):
    """{champion_id (str): (win_rate, pick_rate, games)} for one patch, or {} when AramHex has none.

    pick_rate follows the 101 feed's convention: games / matches (a share of games; all champions sum to 10).
    """
    h = load(patch, "heroes")
    n = matches(patch)
    if not h or not n:
        return {}
    return {c: (round(w / g, 6), round(g / n, 6), g) for c, (g, w) in h.items() if g >= MIN_CHAMP_GAMES}


def live_patch():
    """The site's live patch: the newest 101 data window (data/cn/history/patches.csv)."""
    path = os.path.join(ROOT, "data", "cn", "history", "patches.csv")
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return rows[-1]["patch"] if rows else None
