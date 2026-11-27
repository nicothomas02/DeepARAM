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


# Pooling earlier patches (Nico 2026-11-23: small samples hide strong builds; include earlier patches when nothing
# changed). Each row's lead over the champion's average that patch is combined with up to POOL_DEPTH earlier patches,
# weighted by their precision x POOL_DECAY per patch back. An earlier patch whose lead differs from this patch's by
# more than POOL_GATE standard errors counts as changed (balance patch, rework, new item), and it and anything older are
# dropped; a patch where the row is missing breaks the chain too. Backtest (analysis/pooling/backtest.py, 16.19-16.23):
# next-patch error on augments with under 2,000 games fell 34-37% vs this patch alone (60-70% with the live patch
# thinned to 10% of its games, like a patch's first day), top-5 picks led by the same or slightly more (+0.0 to
# +0.1 pts). A gate of 4 standard errors beat 3 (fewer false "changed" calls across thousands of rows): Zeri's
# Stormrazor at +7 pts on 1,017 first-day 16.23 games vs +1.5 on 13,042 16.22 games is 3.3 apart, so it pools.
POOL_DEPTH = 2
POOL_DECAY = 0.5
POOL_GATE = 4.0


def leads(rows):
    """{key: (lead, variance, games)} from {key: [games, wins]}: win rate minus the games-weighted average of all rows."""
    rows = {k: v for k, v in rows.items() if v[0] > 0}
    total = sum(g for g, _ in rows.values())
    if not total:
        return {}
    mean = sum(w for _, w in rows.values()) / total
    return {k: (w / g - mean, max(w / g * (1 - w / g), 0.05) / g, g) for k, (g, w) in rows.items()}


# Drift weights (Nico chose 2026-11-27, research/decay): instead of a fixed decay, an earlier patch's lead is treated as
# this patch's lead plus a random walk of POOL_DRIFT per patch back, so its weight is 1 / (its noise + age x drift^2).
# A big old sample can no longer drown out a mid-sized live one. Augments the patch's ARAM: Mayhem notes changed drift
# POOL_DRIFT_CHANGED (measured 1.29 vs 0.57 pts between patches). Backtest 16.19-16.23 with the live patch thinned to
# 1/5/20/50%: error on augment rows -9 to -18% vs decay 0.5, -22 to -45% on changed augments, top-5 picks the same;
# boots -7 to -59%. Spell pairs did worse with drift (+4 to +15%) and starts were not tested: both keep the decay.
POOL_DRIFT = 0.005
POOL_DRIFT_CHANGED = 0.013


def pool(history, depth=POOL_DEPTH, decay=POOL_DECAY, gate=POOL_GATE, drift=None, changed=None):
    """history: [{key: [games, wins]}, ...] newest (this patch) first. Returns {key: (win_rate, effective_games,
    patches_used)} for this patch's rows: this patch's average plus the pooled lead, and the games that lead's
    precision is worth (so DeepScore's shrinkage sees the pooled sample).

    drift: weigh earlier patches by drift (see POOL_DRIFT) instead of decay. changed: per age, the keys whose patch
    notes changed between history[age] and the newer patch (changed_by_age); from that age back they drift
    POOL_DRIFT_CHANGED."""
    now_rows = history[0]
    total = sum(g for g, _ in now_rows.values() if g > 0)
    if not total:
        return {}
    mean = sum(w for g, w in now_rows.values() if g > 0) / total
    tables = [leads(h) for h in history[: depth + 1]]
    out = {}
    for k, (x0, v0, n0) in tables[0].items():
        ws, xs, vs = [1 / v0], [x0], [v0]
        hit = False
        for age, t in enumerate(tables[1:], 1):
            if k not in t:
                break
            x, v, _ = t[k]
            if abs(x - x0) > gate * (v + v0) ** 0.5:
                break
            if drift is None:
                ws.append(decay ** age / v)
                vs.append(v)
            else:
                hit = hit or bool(changed and age < len(changed) and k in changed[age])
                d = POOL_DRIFT_CHANGED if hit else drift
                ws.append(1 / (v + age * d * d))
                vs.append(v + age * d * d)
            xs.append(x)
        W = sum(ws)
        lead = sum(w * x for w, x in zip(ws, xs)) / W
        var = sum(w * w * v for w, v in zip(ws, vs)) / W / W
        wr = min(max(mean + lead, 0.01), 0.99)
        out[k] = (round(wr, 4), max(n0, int(round(max(wr * (1 - wr), 0.05) / var))), len(xs))
    return out


def _norm(name):
    import re
    import unicodedata
    s = unicodedata.normalize("NFKD", name).replace("\u2019", "'").lower()
    s = re.sub(r"^(the|upgrade:|quest:)\s+", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def notes_changed_augments(patch):
    """Augment ids (str) the official ARAM: Mayhem notes of `patch` (game version, 16.23) list: balance changes and
    reworks. New and removed augments are listed too but have no earlier or current rows, so they change nothing.
    Names are matched to ids loosely (case, punctuation, a leading "The"); an unmatched name is skipped."""
    with open(os.path.join(ROOT, "data", "official", "patch_notes.json"), encoding="utf-8") as f:
        notes = json.load(f)["patches"]
    entry = next((p for p in notes if p.get("gameVersion") == patch), None)
    if not entry:
        return set()
    with open(os.path.join(ROOT, "web", "src", "data", "augment-names.json"), encoding="utf-8") as f:
        names = json.load(f)
    ids = {}
    for i, n in names.items():
        ids.setdefault(_norm(n), set()).add(i)
    out = set()
    for a in entry.get("augments", []):
        k = _norm(a["name"])
        out |= ids.get(k) or ids.get("the" + k) or set()
    return out


def changed_by_age(patch, n=POOL_DEPTH):
    """For pool(changed=...): index age holds the augments changed between the patch `age` back and the one after it,
    i.e. by the notes of [patch, *earlier(patch)][age - 1]. Index 0 is unused."""
    ps = [patch] + earlier(patch, n)
    return [set()] + [notes_changed_augments(p) for p in ps[:n]]


def earlier(patch, n=POOL_DEPTH):
    """The n AramHex patches before `patch`, newest first."""
    ps = patches()
    i = ps.index(patch) if patch in ps else len(ps)
    return list(reversed(ps[max(0, i - n): i]))
