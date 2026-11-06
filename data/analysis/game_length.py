"""How long Mayhem games last: a survival analysis of game duration.

Every game ends, so there is no censoring: the survival curve S(t) is simply the share of games still
running at minute t, read from the per-minute end counts in archive_aggregates.json (the site owner's own
archive, aggregated by owner_archive.py). The hazard is the share of games still running at minute t that
end during it, which shows when games are most likely to close. Wins and losses, and blue and red side,
are compared with a log-rank test on the grouped counts.

Output data/analysis/game_length.json:
  games, remakes_excluded, source note
  curves   {all, win, loss, blue, red} -> {games, median, quartiles [q1, q3], survival [S(0)..S(max)], hazard [...]}
  peak_minute   the minute with the highest hazard (most likely to end)
  compare  {win_vs_loss, blue_vs_red} -> {z, p, longer: which group lasts longer}
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c  # noqa: E402

MIN_ALIVE = 30


def quantile(counts: list[int], q: float) -> float | None:
    """Minute at which the cumulative share of ended games passes q, interpolated within the minute."""
    total = sum(counts)
    if not total:
        return None
    run = 0
    for m, n in enumerate(counts):
        if run + n >= q * total:
            frac = (q * total - run) / n if n else 0.0
            return round(m + frac, 2)
        run += n
    return float(len(counts) - 1)


def curve(counts: list[int]) -> dict:
    total = sum(counts)
    survival, hazard = [], []
    alive = total
    for n in counts:
        survival.append(round(alive / total, 4) if total else 0.0)
        hazard.append(round(n / alive, 4) if alive else 0.0)
        alive -= n
    return {"games": total, "median": quantile(counts, 0.5), "quartiles": [quantile(counts, 0.25), quantile(counts, 0.75)],
            "survival": survival, "hazard": hazard}


def log_rank(a: list[int], b: list[int]) -> dict:
    """Two-sample log-rank test on grouped end counts; positive z means group a lasts longer."""
    n_a, n_b = sum(a), sum(b)
    obs = exp = var = 0.0
    for da, db in zip(a, b):
        n, d = n_a + n_b, da + db
        if n > 1 and d:
            e = n_a * d / n
            obs += da
            exp += e
            var += d * (n_a / n) * (1 - n_a / n) * (n - d) / (n - 1)
        n_a -= da
        n_b -= db
    z = (exp - obs) / math.sqrt(var) if var > 0 else 0.0  # fewer early ends than expected = lasts longer
    p = math.erfc(abs(z) / math.sqrt(2))
    return {"z": round(z, 2), "p": round(p, 4)}


def build() -> dict | None:
    path = c.OUT / "archive_aggregates.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        agg = json.load(f)
    top = int(agg["max_minute"]) + 1
    counts = {k: [int(v.get(str(m), 0)) for m in range(top)] for k, v in agg["ended_in_minute"].items()}
    curves = {k: curve(v) for k, v in counts.items()}
    # the minute games are most likely to end, among minutes with enough games still running to say
    h, s, total = curves["all"]["hazard"], curves["all"]["survival"], curves["all"]["games"]
    firm = [m for m in range(top) if s[m] * total >= MIN_ALIVE]
    peak = max(firm, key=lambda m: (h[m], -m)) if firm else None
    compare = {}
    for key, (ga, gb) in {"win_vs_loss": ("win", "loss"), "blue_vs_red": ("blue", "red")}.items():
        t = log_rank(counts[ga], counts[gb])
        t["longer"] = ga if t["z"] > 0 else gb
        compare[key] = t
    return {"built": c.now_iso(), "source": agg.get("source"), "games": curves["all"]["games"],
            "remakes_excluded": agg.get("remakes_excluded", 0), "curves": curves, "peak_minute": peak, "compare": compare}


if __name__ == "__main__":
    out = build()
    if out:
        c.write_json(c.OUT / "game_length.json", out)
