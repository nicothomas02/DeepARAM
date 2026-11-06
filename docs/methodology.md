# Methodology

How DeepARAM turns raw Mayhem data into the numbers on the site. The public page
([deeparam.com/methodology](https://deeparam.com/methodology)) explains the ideas in plain words;
this file is the longer write-up for people reading the repo, with the code locations.

## Pipeline

1. **Ingest.** Scheduled GitHub Actions pull the Mayhem champion, augment, duo and build feeds,
   client game files and patch data, and commit them as JSON/CSV (`data/cn/`, `data/pbe/`,
   `simulator/`, `guide/`). Stats refresh hourly; PBE changes are diffed daily by `tools/datamine/`.
2. **Model.** Python jobs derive what the feeds lack (`data/estimates/`, `data/fill/`) and run the
   Simulator (`simulator/`, C++ compiled to WebAssembly) for build and upgrade rankings.
3. **Serve.** `web/` is a Next.js app that reads those files at build time and prerenders every
   page. Merging to `main` deploys; CI runs unit tests, i18n parity checks and page smoke tests.

Every PR must pass the `Tests` workflow before it merges. The site is in 22 languages and a test
fails if any language misses a key.

## Statistics

- **Shrinkage.** A win rate is pulled toward its list's mean with a beta prior
  (`lowerBound` in `web/src/lib/deepscore.ts`): `est = (wr·n + mean·prior) / (n + prior)`.
- **Conservative score.** The ranking uses `est − 1·sqrt(est(1−est)/(n+prior))`, the low end of
  the likely range, so sample size is priced into the rank rather than shown as a separate column.
- **DeepScore.** Scores are z-scored against the list (`50 + 15·z`, clamped to 0..100). Tiers are
  fixed z cuts (S ≥ 1.35, A ≥ 0.6, B ≥ −0.4, C ≥ −1.2), giving roughly 9/18/38/23/12% of a normal
  spread, which keeps tiers comparable as the average drifts between patches.
- **Recency.** Champion scores across several patches weight older patches less (`lib/tiers.ts`).
- **Pick-bias correction for augments.** Strong champions pick certain augments more, which
  inflates those augments' raw win rates. An augment's win rate is compared with a baseline: the
  win rates of the champions who take it, weighted by how many of their games include it
  (`lib/augment-tiers.ts`). The result is shrunk by pick count and scored at its low end.
- **Estimates.** Quantities the feed doesn't contain (augment win rate per champion, augment
  pairs, stat profiles, rarity odds, item timing) are modelled, mostly logistic-scale regressions
  fitted on a held-out-checked archive of games. Methods and their held-out accuracy are in
  [`data/estimates/README.md`](../data/estimates/README.md); the site labels every such number
  "estimated" or "simulated".
- **Simulator.** A deterministic fight model using the game's own champion, item and ability
  numbers. Its builds and upgrade picks are labelled simulated; accuracy is tracked against known
  in-game values ([`simulator/README.md`](../simulator/README.md)).

## Limits

- Feeds expose aggregates, not per-game rows, so some effects can't be separated (for example,
  which games had which augment). Where that matters, the site says "predicted" or "estimated".
- Win rate is not causal: pick bias, playstyle and sample size all move it. The corrections above
  reduce, not remove, those effects.

## Keeping this in step

Add a section to `web/src/app/methodology/page.tsx` (and its keys to
`web/public/i18n/methodology/*.json`) whenever a method ships: confidence intervals and minimum
samples, the synergy finder, the win-prediction model. The public page describes methods only; this
file may also describe the data pipeline.
