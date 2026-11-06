"""Shared loaders for the analyses in data/analysis (standard library only, so the daily workflow needs no installs).

Data facts every analysis relies on:
- data/cn/history/daily/*.csv: one row per champion per day. Within a patch window the numbers are CUMULATIVE
  (each day's win rate covers every game since the patch's first day), so the last day of a window is the
  patch's final figure (data/cn/history/by_patch.csv) and day-level effects must be de-cumulated.
- data/cn/history/patches.csv: each patch's data window (first_day_in_data .. last_day, days).
- data/official/patch_notes.json: the ARAM Mayhem section of each official patch's notes, champion lines kept
  verbatim as 'Field: old ⇒ new'.
- data/fill/spells_games.json: estimated games per day (daily_games), used for sample sizes.
"""
from __future__ import annotations

import csv
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "analysis"

FEED_FIELDS = ("win_rate", "pick_rate", "avg_damage_ratio", "avg_tank_ratio", "avg_participation_rate", "avg_death_time")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def patches() -> list[dict]:
    """Patch windows, oldest first: patch, released, first_day_in_data, last_day, days (int)."""
    rows = read_csv(ROOT / "data" / "cn" / "history" / "patches.csv")
    for r in rows:
        r["days"] = int(r["days"] or 0)
    return rows


def champion_names() -> dict[str, str]:
    """Alias -> display name (web/src/data/champion-names.json)."""
    with open(ROOT / "web" / "src" / "data" / "champion-names.json", encoding="utf-8") as f:
        return json.load(f)


def alias_lookup() -> dict[str, str]:
    """Display name (and a few spellings) -> alias."""
    out = {}
    for alias, name in champion_names().items():
        out[name.lower()] = alias
        out[alias.lower()] = alias
        out[re.sub(r"[^a-z]", "", name.lower())] = alias
    return out


def to_alias(name: str, lookup: dict[str, str] | None = None) -> str | None:
    lookup = lookup or alias_lookup()
    key = name.strip().lower()
    return lookup.get(key) or lookup.get(re.sub(r"[^a-z]", "", key))


def by_patch() -> dict[str, dict[str, dict]]:
    """patch -> alias -> final feed row (floats)."""
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for r in read_csv(ROOT / "data" / "cn" / "history" / "by_patch.csv"):
        row = {k: float(r[k]) for k in FEED_FIELDS if r.get(k)}
        row["champion_id"] = r["champion_id"]
        out[r["patch"]][r["name"]] = row
    return out


def id_to_alias() -> dict[str, str]:
    """champion_id -> alias, from the patch history."""
    out = {}
    for r in read_csv(ROOT / "data" / "cn" / "history" / "by_patch.csv"):
        out[r["champion_id"]] = r["name"]
    return out


def daily() -> dict[str, dict[str, list[dict]]]:
    """patch -> alias -> that champion's rows for each day of the window, oldest first (cumulative within the window)."""
    windows = [(p["patch"], p["first_day_in_data"], p["last_day"]) for p in patches()]
    ids = id_to_alias()
    out: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for path in sorted((ROOT / "data" / "cn" / "history" / "daily").glob("*.csv")):
        for r in read_csv(path):
            d = r["date"]
            patch = next((p for p, a, b in windows if a <= d <= b), None)
            alias = ids.get(r["champion_id"])
            if not patch or not alias:
                continue
            row = {"date": d}
            for k in ("win_rate", "pick_rate", "avg_damage_ratio", "avg_tank_ratio", "avg_participation_rate", "avg_death_time"):
                if r.get(k):
                    row[k] = float(r[k])
            out[patch][alias].append(row)
    for champs in out.values():
        for rows in champs.values():
            rows.sort(key=lambda x: x["date"])
    return out


def games_per_day() -> float:
    try:
        with open(ROOT / "data" / "fill" / "spells_games.json", encoding="utf-8") as f:
            return float(json.load(f).get("daily_games") or 0) or 1_000_000.0
    except (OSError, ValueError):
        return 1_000_000.0


def patch_notes() -> dict[str, dict[str, list[str]]]:
    """gameVersion (16.20) -> alias -> the champion's change lines in that patch's Mayhem notes."""
    with open(ROOT / "data" / "official" / "patch_notes.json", encoding="utf-8") as f:
        notes = json.load(f)
    lookup = alias_lookup()
    out: dict[str, dict[str, list[str]]] = {}
    for p in notes["patches"]:
        champs: dict[str, list[str]] = {}
        for c in p.get("champions", []):
            alias = to_alias(c["name"], lookup)
            if alias:
                champs.setdefault(alias, []).extend(c.get("changes", []))
        out[p["gameVersion"]] = champs
    return out


# --- change lines -------------------------------------------------------------------------------------------

NUM = re.compile(r"-?\d+(?:\.\d+)?")
ARROW = re.compile(r"\s*(?:⇒|→|->|=>)\s*")
MODIFIERS = (
    ("damage_dealt", re.compile(r"damage (?:dealt|modifier)(?! to minions)", re.I)),
    ("damage_taken", re.compile(r"damage taken", re.I)),
    ("healing", re.compile(r"\bhealing\b|\bheal(?:ing)? (?:done|modifier)", re.I)),
    ("shielding", re.compile(r"\bshield(?:ing)?(?: done)?\b", re.I)),
)
# For these, a smaller number is a buff.
LOWER_BETTER = re.compile(r"cooldown|cost|recharge|ammo|damage taken", re.I)
DOSE_KEYS = ("damage_dealt", "damage_taken", "healing", "shielding", "ability")


def parse_change(text: str) -> dict | None:
    """One 'Field: old ⇒ new' line -> {kind, field, old, new, signed}: signed is the log-ratio of the change, positive
    when it makes the champion stronger. Mayhem modifiers ('Damage Taken: 105% ⇒ 100%' or '5% ⇒ 0%') become
    the ratio of the two multipliers; any other numeric line uses the mean of its numbers, capped at ±50%."""
    text = text.replace("(mid-patch update)", "").strip()
    parts = ARROW.split(text, maxsplit=1)
    if len(parts) != 2:
        return None
    left, right = parts
    if ":" in left:
        field, rest = left.split(":", 1)
        field = field.strip()
    else:
        m = NUM.search(left)
        if not m:
            return None
        field, rest = left[: m.start()].strip(" :-").strip(), left[m.start():]
    old = [float(x) for x in NUM.findall(rest)]
    new = [float(x) for x in NUM.findall(right)]
    if not old or not new:
        return None
    kind = "ability"
    for key, rx in MODIFIERS:
        if rx.search(field) and "minion" not in field.lower():
            kind = key
            break
    if kind != "ability":
        o, n = old[0], new[0]
        # '105% ⇒ 100%' is a multiplier; '5% ⇒ 0%' or '-5% ⇒ 0%' is the same thing written as a bonus.
        if abs(o) <= 50 and abs(n) <= 50:
            o, n = 100 + o, 100 + n
        if o <= 0 or n <= 0:
            return None
        signed = math.log(n / o)
        if kind == "damage_taken":
            signed = -signed
        return {"kind": kind, "field": field, "old": o, "new": n, "signed": round(signed, 4)}
    mo, mn = sum(old) / len(old), sum(new) / len(new)
    if mo == 0 and mn == 0:
        return None
    if mo <= 0 or mn <= 0:
        # e.g. 'Ability Haste: -10 ⇒ 0': treat as a bonus on a 100 base
        mo, mn = 100 + mo, 100 + mn
    rel = max(-0.5, min(0.5, math.log(mn / mo)))
    if LOWER_BETTER.search(field):
        rel = -rel
    if "minion" in field.lower():
        rel *= 0.2  # minion damage barely decides an ARAM fight
    return {"kind": kind, "field": field, "old": mo, "new": mn, "signed": round(rel, 4)}


def dose(lines: list[str]) -> dict:
    """Summed signed changes per kind for one champion's lines in one patch, plus how many lines parsed."""
    d = {k: 0.0 for k in DOSE_KEYS}
    parsed = 0
    for line in lines:
        c = parse_change(line)
        if not c:
            continue
        parsed += 1
        d[c["kind"]] += c["signed"]
    d["ability"] = max(-1.0, min(1.0, d["ability"]))  # many small ability lines add up; cap so one long list cannot dominate
    d = {k: round(v, 4) for k, v in d.items()}
    d["lines"] = len(lines)
    d["parsed"] = parsed
    total = sum(d[k] for k in DOSE_KEYS)
    d["intent"] = "buff" if total > 1e-9 else "nerf" if total < -1e-9 else "unclear"
    return d


# --- small statistics -------------------------------------------------------------------------------------------

def mean(xs) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def sd(xs) -> float:
    xs = list(xs)
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else 0.0


def spearman(xs: list[float], ys: list[float]) -> float:
    return pearson(ranks(xs), ranks(ys))


def binomial_se(p: float, n: float) -> float:
    p = min(0.99, max(0.01, p))
    return math.sqrt(p * (1 - p) / max(n, 1.0))


def solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting for a small dense system."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        if abs(m[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] if abs(m[i][i]) > 1e-12 else 0.0 for i in range(n)]


def ridge(X: list[list[float]], y: list[float], lam: float = 0.0) -> list[float]:
    """Least squares with an intercept (first coefficient) and an L2 penalty on the slopes."""
    rows = [[1.0] + x for x in X]
    k = len(rows[0])
    xtx = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    for i in range(1, k):
        xtx[i][i] += lam
    xty = [sum(r[i] * yi for r, yi in zip(rows, y)) for i in range(k)]
    return solve(xtx, xty)


def predict(coef: list[float], x: list[float]) -> float:
    return coef[0] + sum(c * v for c, v in zip(coef[1:], x))
