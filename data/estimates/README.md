# Estimated stats

Stats the Mayhem feed (`data/cn/`) doesn't have, estimated from it. `build.py` runs daily in
`.github/workflows/fill.yml` and writes `estimates.json` for the live patch (sections are listed at
the top of `build.py`). Every value is an estimate and should be labelled as one on the site.

`fit_games.py` fits the per-game pieces into `fitted.json` from the owner's own Mayhem game archive
(994 games, all 10 players each). The archive stays on the owner's computer; only aggregates and
coefficients are stored. Refit after big changes:

    python3 data/estimates/fit_games.py ~/path/to/mayhem-backup.json

## Methods and how well they hold up (held-out checks on the archive)

| Section | Method | Check |
| --- | --- | --- |
| `augments` (win rate of an augment on a champion) | logit(champion WR) + λ·(augment's fair WR vs the champions who take it) + a step for the feed's per-champion grade S/A/B/C. λ and the grade steps are fitted. | Binned by predicted lift, games show −3.3 / −1.4 / +1.2 / +2.8 pp for predicted −3.4 / −1.0 / +1.0 / +2.7 pp. Grades alone: S +1.9, A −0.6, B −3.0, C −4.0 pp vs champion WR. |
| `augment_pairs` | Pair share = product of the two pick rates. Win rate adds both lifts on the logit scale. | No pair data to check against. Popularity and win rate are both model output. |
| `profiles` (kills, deaths, assists, damage, split, healing, crowd control, gold, turret damage, CS, largest killing spree, pentakills, game minutes) | Regression on the feed's damage/tank share, kill participation, time dead, melee and class tags, blended with the archive's per-champion average (40 games of weight to the regression). | Correlation with the other half of games across 100 champions: regression alone 0.75 to 0.96 (true damage 0.44); blended 0.89 to 0.98. CS 0.85/0.94, largest spree 0.84/0.89. Pentakills is rough (0.44/0.36; pentas are rare), fine for a top 10, not for exact rates. Game minutes is weak (0.19 regression, 0.09 games): show as a band, not a ranking. |
| `item_timing` | Minute each core item is finished: cumulative cost minus 1,400 starting gold, divided by the profile's gold per minute minus the starting gold spread over the game. | Derived from `profiles` and core builds; no timeline data to check against. |
| `rarity_odds` | Overall: share of all augment picks per rarity in the feed. Per stage and stage to stage: counted in the archive (~9,900 picks per stage). | Counting, ±1 pp. |
| `augment_stages` | Share of each augment's picks at each stage, counted in the archive (augments with 10+ picks). | Counting. Small augments are noisy. |
| `items` | Item WR and lift = pick-weighted over champions (champion pick × item pick). Slots 1 to 3 from the order in core builds. Augment-granted items flagged from `guide/augment_rules.json`. | Exact aggregation of the feed. Full builds are unordered, so there's nothing past slot 3. |
| `augment_items` | P(item given augment) = sum over champions of P(champion given augment) × P(item given champion). | Popularity only, assuming independence. |
| `duos` | Lift = pair WR − sigmoid(logit A + logit B). | Exact on the feed's top 2,000 pairs. |
| `game_length`, `side` | Counted in the archive. | Blue 53.3% over 994 games (±1.6 pp). |
| `fun` | Top 10s from the feed and `profiles`. | |

## Early-window builds (`early_builds.json`)

`early_builds.py` covers the first days after the builds feed restarts (every week or two, not on patch days),
when a rare champion's six-item builds stand on a few hundred games. Each build's win rate is blended with the
same build at the end of the previous window (up to 800 games of weight), moved by the champion's win-rate change
between patches and by the pooled change of items the patch changed; builds with removed items are dropped.
Champions whose builds are mostly under 400 games this window get the blended core, full builds and single
items on their page, with a note. Backtest on the one finished window in the history so far (79 builds, the first
three days after the 2026-10-28 restart, scored against the window's latest day): raw RMSE 6.6 pts, blended 5.2.
The patch adjustments could not be checked yet (no patch fell between a window and the one before it); rerun
`python3 data/estimates/early_builds.py --backtest` as more windows pass.

## Early vs late game (`power_curve.json`, simulated)

`power_curve.py` runs the Simulator on each champion's best build at level 8 with 2 items, level 13 with
4 items and level 18 with a full build, each against a level-matched dummy, and ranks the damage per
second at each point. `scaling` is log(late / early DPS) as a z-score. Real games can't confirm any
early/late ranking yet: in the archive, no score (this one, base stat growth, class) changes win rate
by game length beyond noise (effect under ~1 point per 4.6 minutes). This curve agrees weakly with how
champions' damage share grows in longer games (r 0.17). Show it as simulated. Full notes:
research note `early-vs-late-game.md` in the project files.

## Weapon of Destiny items (`weapon_of_destiny.json`)

`weapon_of_destiny.py` ranks Legendary items for the Weapon of Destiny augment (Tier List tab). Each
takedown adds 200 gold worth of the item's own upgradeable stats, shared equally among them; the
amounts per 1,000 gold come from the augment's spell data in `kiwi.bin`, the item's stats from the item
bin. Each one's Weapon is the first Legendary item in its core builds (in buy order). Legendary means the
simulator's Legendary items plus every other Legendary item Mayhem's shop sells (`item-groups.json`, e.g.
Mayhem's Hubris 126697), so a build that starts with one isn't credited to its second item. Per item:
`value`, what the site ranks by (each stat's rarity among Legendary items times its worth in `VALUE`: 3 for
Critical Strike Damage and % penetration, 2 for flat penetration, crit and attack speed, 1.5 for healing and
Move Speed %, else 1; averaged over the item's stats), and `share` (how often it's the Weapon, for "Best
with": champions weighted by pick rate x how often they take the augment).

The site labels the tab Predicted and ranks by `value` only (Nico 2026-10-27): the feed shows who takes the
augment but not which games had it, so the win rates of builds starting with an item aren't the augment's.
Refreshed daily by `fill.yml` after the Mayhem stats update.

## Best upgrades per champion (`champion_upgrades.json`, simulated + estimated)

`champion_upgrades.py` writes, per champion, the Pentakill Empowers (start pick Q/W/E, level 18 pick incl. R), the
Weapon of Destiny item and a theoretical best set of 4 augments. Method in the script's docstring; in short:

- Every sim run uses the champion's most popular real build and shared fights (same seed), so two runs differ only
  by the change tested. A run's value is damage per second plus healing, shielding and crowd control per second
  alive, weighted by role (carries count damage almost alone, tanks and supports count protection and CC about as
  much), plus log(time alive) at the role's survival weight (0.25 carries up to 0.6 tanks): fights run until the
  champion goes down, so surviving longer counts, but not in full (a revive or lifesteal loop can double a fight).
- Pentakill: start pick = best average gain at level 8, 13 (training dummies) and 18 (real enemies); level 18 pick
  tried on top of it. Picks are scored for a team fight: crowd control counts by strength (the simulator's
  `cc_hard_seconds`: stun 1, root 0.75, silence 0.5, a slow its amount) at an average champion's damage per second,
  and `pentakill_team.json` (hand-checked from the game's ability values) adds what the one-champion fight can't
  see: heals and shields on allies (Soraka W, Yuumi R, Lulu E...) and team utility (revives, team invulnerability,
  spell shields, team speed) counted as crowd control seconds. Healing and shielding added this way count 1.8x,
  the 0.8 being the survival credit the simulator gives a champion's own healing (median over tanks and supports).
  Win rate boost = BETA x (start gain + 0.35 x level 18 gain), 0.35 being the share of a game's fights at level 18.
  Shown on the Tier List's Pentakill tab (`web/src/lib/pentakill.ts`) and champion pages.
- Weapon of Destiny: candidates are items bought first in 5%+ of the champion's core builds (every Legendary item
  Mayhem sells counts as a first item, Hubris and Rite of Ruin included) or in its popular build; each is upgraded with half its estimated takedowns per game. Score = sim gain x BETA + the item's real
  first-item win rate vs the champion's average (shrunk when rarely bought first).
- Augments: sum of each augment's estimated lift on this champion (`augments` above, shrunk by pick / (pick + 1%),
  and by global pick / (global pick + 0.5%) because brand-new augments with almost no games have a meaningless fair
  win rate) + BETA x sim synergy (gain of the set minus its augments' single gains), softly capped at +-3 points
  so one sim outlier can't decide a set. BETA (win-rate points per unit of log sim gain) is the within-champion
  slope of real lift on sim gain over stat-only augments, where the sim is exact (0.066, r 0.24 over ~1,070 champion-augment pairs; on all modeled
  augments the slope is ~5x flatter from x noise). Searched: 14 best by real lift + 6 best by sim gain, every pair
  simulated, the 25 best sets of 4 re-simulated whole.

About 37,000 sim runs, 2.5 hours on 4 cores; results are cached in `~/.cache/deeparam-sim/upgrades/`. Needs
`make -C simulator mayhem_sim`. Not scheduled: rerun after patches.

## Hidden gems (`synergies.json`, estimated)

`synergies.py` (daily in `fill.yml`) lists choices fewer than 2% of a champion's players make that still win
clearly more than the champion's usual ones: starting items, boots and full builds (plus single items and
three-item cores whenever those feed blocks are live again). Shown on the Tier List's Hidden gems tab.

- **Lift** = the choice's win rate minus the pick-weighted win rate of the champion's listed options for the
  same slot. **Games** = pick rate x champion pick rate x the patch's estimated total (`data/fill`).
- **Sample-only intervals don't work here.** With tens of thousands of games per choice, a 95% Wilson interval
  is about +-0.5 points, but on 16.20 -> 16.21 rare choices' lifts moved by 1.5-2.6 points between patches.
  Those intervals held next patch's lift only 28% (full builds), 31% (starting) and 47% (boots) of the time.
- **Carry-over forecast** (out-of-time empirical Bayes): over rare options seen on both of the last two
  complete patches, next lift = alpha + beta x lift. Fitted: beta 0.55 full builds, 0.56 boots, 0.60 starting
  items (just over half a rare lead carries over), drift 1.4-2.6 points. Forecast range (90%) = +-1.645 x
  sqrt(drift^2 + (1 + beta^2) x sample variance). A gem's whole range is above zero (>= 0.1 points).
- **Check** (5-fold by champion, fit without the held-out champions): next patch's lift landed inside the
  90% range 92% (starting), 91% (boots), 92% (full builds) of the time. Flagged gems still beat the usual
  pick next patch 100% (2 starting), 100% (32 boots), 89% (9 full builds), against 66%, 86% and 48% of all
  rare choices.
- **Augments**: no augment win rates are shown (Riot's policy). Listed: augments graded S or A for the
  champion by the feed, taken by under 2%, with a positive estimated lift (`augments` above), in that order.
  No interval: there's no game-level augment data.
- **Stale blocks**: a block identical for 90%+ of champions to the update 7 days earlier is skipped. The
  feed's single items, three-item cores and skill orders have not changed since 2026-10-16 (every patch since
  then shows the same numbers), so those are out until they move again.
- **Viability checks** (`synergy_checks.py`, Nico 2026-11-06: a gem must work in the game, not just in the
  numbers): every item still sold in Mayhem's shop and not one only an augment gives, every augment still in
  the live pool (real picks on the champion show it's in that champion's pool). Simulator, level 18 vs real
  enemies: boots and full builds against the champion's most popular full build ("agrees", or "disagrees" when
  15%+ lower, still listed because the wins are real: on 16.22 that's the full tank Nasus and Trundle builds,
  a known blind spot of the fight model); augments on that build with and without ("agrees", "no gain"; dropped
  when 2%+ worse, since augment gems have no real win rate behind them). Starting items and unmodelled items
  or augments are "not simulated". The Simulator's own pool list (`simulator/data/augment_pools.json`) misses
  43 newer augments, so it isn't used to drop anything.
  Bug finder (`data/checks/check_build.py`, run right before in fill.yml): gems it blocks (Traps list, an
  augment the champion can't be offered) are dropped; warnings (untested stat loops, Simulator vs real games
  gaps) keep a `caution` list and show "check in game" in the Simulator column.
- Association, not cause: the players who choose a rare option may differ from the rest.

## Tried and dropped

- **Counters and worst duos from class matchups**: a class synergy/counter model on the archive did
  worse on held-out games than champion win rates alone (log loss 0.677 vs 0.675). There's no signal
  at this size, so nothing is published.
- **Short/long-game specialists from real games**: per-champion win rate vs game length doesn't repeat
  between halves of the archive (correlation −0.02). Average game length per champion barely varies
  (split-half r 0.14). Only typical game length is published, plus the simulated curve above.
- **Map win rates**: every Mayhem game in the archive is on Howling Abyss (map 12), so there's nothing
  to split.
