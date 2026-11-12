# Statistical rigor: confidence intervals and sample sizes

Shared statistics for every win rate DeepARAM shows. The site (`web/src/lib/stats.ts`, `web/src/lib/sample.ts`)
mirrors these files, so the pages, the data builders and any notebook draw the same ranges.

| File | What it does |
| --- | --- |
| `intervals.py` | `wilson()` Wilson score interval, `diff_interval()` Newcombe hybrid score interval for the difference of two rates (lift vs an expected rate; pass `math.inf` for a fixed baseline), `sample_level()` with `MIN_GAMES` (10) and `NOISE_HALF_WIDTH` (0.05), `games_needed()`. Standard library only. |
| `games.py` | Estimated matches behind each patch's stats, written to `games.json`. Runs in `cn-stats.yml` after the history rebuild. `--check` tests the estimator on simulated patches. |
| `games.json` | `{median_per_day, patches: {patch: {days, per_day, matches, estimated}}}` |

## Where the game counts come from

The Mayhem feed has win rates and pick rates but no game counts. A pick rate is a champion's share of matches
(they sum to 10), so a champion's games are `pick_rate × matches`, and an item's or a teammate pair's games are
its share × the champion's games. Only the number of matches is unknown.

It's read from noise. The daily feed is cumulative per patch, so two consecutive days give each champion's win
rate over *that day's* games, without knowing the total. Those daily win rates jitter by binomial noise,
`w(1-w) / (D × share)`, which shrinks with games, plus real drift, which grows with the gap between days and
doesn't depend on popularity. Fitting both across ~170 champions and lags of 1 to 3 days separates them and gives
`D`, matches per day (`data/fill/model.py estimate_daily_games`, shared with the game counts on the Tier List).
Any extra noise beyond pure binomial noise lands in `D` too, so it's an *effective* sample size, which is the
right one for an interval.

- Simulated patches with a known total (real pick rates, the feed's 4-decimal rounding): the estimate lands within
  about ±10% at 1M, 3.5M and 8M matches a day, with or without drift (`python3 data/stats/games.py --check`).
- Real patches: about 3 to 4 million matches a day. Patches with fewer than 10 days, high drift or a fit more than
  1.8× off the typical rate use the typical rate (median of the recent stable patches), as does the live patch
  while it fills.
- Over several patches the Tier List weights older patches down, so its sample is the effective size of a
  weighted mean, `(Σ g·w)² / Σ g·w²`.

## What the site shows

- **Simple view:** the number, plus a quiet **Few games** tag when the 95% range is wider than ±5 pts (fewer than
  ~385 games at 50%), or **Too few games** (number dimmed) under 10 games.
- **Detailed view:** adds the 95% range as `±0.4` (hover shows the full range).
- Covered: Tier List champions (any patch range), Duos (win rate boost), champion pages (header, every build,
  item, boots, skill order, style and teammate row), item pages ("Built most by").
- Champion win rates rest on tens of thousands to millions of games, so their ranges are a fraction of a point.
  The tags mostly appear on rare builds and items early in a patch, when a full build may have under 100 games.
- Not covered on purpose: augment win rates (a pending policy decision) and estimated or simulated numbers, which
  aren't counted from games.
