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

## Early vs late game (`power_curve.json`, simulated)

`power_curve.py` runs the Simulator on each champion's best build at level 8 with 2 items, level 13 with
4 items and level 18 with a full build, each against a level-matched dummy, and ranks the damage per
second at each point. `scaling` is log(late / early DPS) as a z-score. Real games can't confirm any
early/late ranking yet: in the archive, no score (this one, base stat growth, class) changes win rate
by game length beyond noise (effect under ~1 point per 4.6 minutes). This curve agrees weakly with how
champions' damage share grows in longer games (r 0.17). Show it as simulated. Full notes:
research note `early-vs-late-game.md` in the project files.

## Headliners (`headliners.json`, Set 3)

`headliners.py` writes the Tier List's Headliners tab. Pentakill is simulated: each champion's most popular
build runs with HEAVY / POWER / THRASH / DOOM (20 haste, 10% damage, healing and shielding on one ability)
at level 8 (2 items, dummy) and level 18 (full build, real enemies); the start pick is the basic ability with
the best average gain, and the level 18 pick is tried on top of it. The other Headliners rank champions from
`estimates.json` (augment lifts and spread, Prismatic vs Silver gap, multi-kills and tower damage, third item
timing, damage taken vs healing, dashes). `kiwi_hub.json` holds the live band missions from the client's Mayhem
hub, each with the estimate its champions are ranked by. Rerun after a patch (about 10 minutes on 4 cores):

    make -C simulator mayhem_sim && python3 data/estimates/headliners.py

## Tried and dropped

- **Counters and worst duos from class matchups**: a class synergy/counter model on the archive did
  worse on held-out games than champion win rates alone (log loss 0.677 vs 0.675). There's no signal
  at this size, so nothing is published.
- **Short/long-game specialists from real games**: per-champion win rate vs game length doesn't repeat
  between halves of the archive (correlation −0.02). Average game length per champion barely varies
  (split-half r 0.14). Only typical game length is published, plus the simulated curve above.
- **Map win rates**: every Mayhem game in the archive is on Howling Abyss (map 12), so there's nothing
  to split.
