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
| `item_lift.py` | `item_lift.json` | How an item does among its champions' finished builds (the item lists come from completed six-item builds, so every item carries the same long-game effect). Adjusted lift = item win rate minus the champion's pick-weighted finished-build win rate, next to the raw lift against the champion's overall win rate; the finished-build premium per champion and overall; legendary items ranked both ways. `archive_check()` prints win rate by completed legendary items from the owner's archive, kept out of the JSON. | Item pages, "boost among finished builds"; Methodology |
| `game_length.py` | `game_length.json` | How long games last, as a survival curve from per-minute end counts (no censoring: every game ends): median and quartiles, the per-minute hazard, and log-rank tests of wins vs losses and blue vs red. Only runs when `archive_aggregates.json` exists; both files are git-ignored because the owner's own stats stay off the public site, so the result lives in a private doc (/mnt/project-files/research/private/). | (not shown) |
| `owner_archive.py` | `archive_aggregates.json` | Run by hand against a private export of the owner's game archive (`python3 data/analysis/owner_archive.py export.json`); keeps counts only: games ended per minute (all, win, loss, blue, red) and games and wins by number of completed legendary items. Not part of `build.py`; its output is git-ignored. | (feeds the two above) |
| `patch_forecast.py` | `patch_forecast.json` | What a listed change should do before it ships: ridge regression on `patch_impact` effects, leave-one-patch-out error against "no change" and "average buff or nerf" baselines, applied to the PBE change tracker. Shown only while it beats the baselines. | PBE tab, "Expected win-rate shift" |

Facts the scripts rely on (`common.py`): the daily feed is cumulative within a patch window, so the last day
is the patch's final figure and day-level effects are de-cumulated under a uniform-volume assumption; sample
sizes come from pick rate times the estimated games per day in `data/fill/spells_games.json`; champion lines
in `data/official/patch_notes.json` and `data/pbe/tracker.json` are parsed by `parse_change` (Mayhem
modifiers become log-ratios of the multipliers, other numeric lines the log-ratio of their mean, capped).

Held for later: the skill-order finder (skill orders in `data/cn/builds` still have no live source) and augment
offer vs take rate (waits on the augment win-rate policy decision). Simulator sensitivity curves and the
validation report live in `simulator/analysis/`.
