"""Confidence intervals and sample-size checks for win rates. Standard library only.

The site (web/src/lib/stats.ts) mirrors these functions, so a pick shows the same range everywhere.

- wilson(): the Wilson score interval for a rate. Unlike "rate ± 1.96 standard errors" it stays inside
  0 to 1 and behaves well with few games or rates near 0% or 100%.
- diff_interval(): Newcombe's hybrid score interval for the difference of two rates (method 10 in
  Newcombe 1998), built from the two Wilson intervals. Use it for lift: a pair's win rate against
  what its parts win anyway.
- sample_level(): "none" below MIN_GAMES (too few games to show a win rate at all), "low" while the 95%
  interval is wider than ±NOISE_HALF_WIDTH (differences of a few points are noise), else "ok".
"""

import math

Z95 = 1.959963984540054  # two-sided 95%
MIN_GAMES = 10
NOISE_HALF_WIDTH = 0.05


def wilson(p, n, z=Z95):
    """95% (by default) Wilson score interval (lo, hi) for a rate p seen over n games."""
    if not n or n <= 0:
        return (0.0, 1.0)
    p = min(1.0, max(0.0, p))
    z2 = z * z
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def wilson_counts(wins, n, z=Z95):
    """Wilson interval from a win count."""
    return wilson(wins / n if n else 0.0, n, z)


def half_width(p, n, z=Z95):
    lo, hi = wilson(p, n, z)
    return (hi - lo) / 2


def diff_interval(p1, n1, p2, n2, z=Z95):
    """Interval (lo, hi) for p1 - p2 from independent samples (Newcombe hybrid score).

    Pass n2 = math.inf (or a huge number) when p2 is a known baseline, e.g. a model's expected win rate."""
    l1, u1 = wilson(p1, n1, z)
    if n2 is None or math.isinf(n2):
        l2 = u2 = p2
    else:
        l2, u2 = wilson(p2, n2, z)
    d = p1 - p2
    return (d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2))


def sample_level(n, p=0.5):
    """'none', 'low' or 'ok' for a win rate p (0.5 = worst case) over n games."""
    if not n or n < MIN_GAMES:
        return "none"
    return "low" if half_width(p, n) > NOISE_HALF_WIDTH else "ok"


def games_needed(half=NOISE_HALF_WIDTH, p=0.5, z=Z95):
    """Fewest games for a 95% interval of ±half (normal approximation)."""
    return math.ceil(z * z * p * (1 - p) / (half * half))
