# Analyses

Deeper looks at the Mayhem stats, each a standard-library Python script that writes one JSON file the site
reads (`web/src/lib/analysis.ts`). `python3 data/analysis/build.py` runs them all; the daily estimates workflow
(`.github/workflows/fill.yml`) runs it after every Mayhem stats refresh. Every number ships with an interval,
a noise floor or a baseline, and the Methodology page explains each method in plain words.

| Script | Output | What it answers | Where it shows |
| --- | --- | --- | --- |
| `patch_impact.py` | `patch_impact.json` | Did each champion change in the patch notes move that champion's win rate? Difference in differences against the untouched champions, with a binomial interval and a placebo z (the effect over the untouched champions' spread). Dose-response: win-rate points per 5% Mayhem modifier, bootstrap intervals. | Patch Recaps, "Did the champion changes work?"; Methodology |
| `meta_settling.py` | `meta_settling.json` | How close each day's ranking is to the patch's final one (Spearman and mean gap), and champions whose implied win rate from a day onward shifted far beyond the rest of the list that day (candidate hotfixes or new tricks). | Patch Recaps, "How fast the rankings settled" and "Shifted mid-patch" |
| `playstyle_clusters.py` | `playstyle_clusters.json` | Which champions play alike: k-means on damage share, tank share, kill participation, time dead and augment picks (k by silhouette), a PCA map, and champions whose Riot class is rare in their group. | Champions A to Z, "Playstyles" |
| `patch_forecast.py` | `patch_forecast.json` | What a listed change should do before it ships: ridge regression on `patch_impact` effects, leave-one-patch-out error against "no change" and "average buff or nerf" baselines, applied to the PBE change tracker. Shown only while it beats the baselines. | PBE tab, "Expected win-rate shift" |

Facts the scripts rely on (`common.py`): the daily feed is cumulative within a patch window, so the last day
is the patch's final figure and day-level effects are de-cumulated under a uniform-volume assumption; sample
sizes come from pick rate times the estimated games per day in `data/fill/spells_games.json`; champion lines
in `data/official/patch_notes.json` and `data/pbe/tracker.json` are parsed by `parse_change` (Mayhem
modifiers become log-ratios of the multipliers, other numeric lines the log-ratio of their mean, capped).

Held for later: survivor-bias-adjusted item lift and the skill-order finder (core items and skill orders in
`data/cn/builds` are stale until the feed fix lands), augment offer vs take rate (waits on the augment
win-rate policy decision), game-length survival analysis (needs a duration aggregation from the owner's game
archive). Simulator sensitivity curves and the validation report live in `simulator/analysis/`.
