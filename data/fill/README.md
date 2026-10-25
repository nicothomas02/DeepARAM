# Estimated summoner spells and game counts

The Mayhem stats feed (`data/cn/`) has no summoner spells and no game counts, so both are
estimated here. The site marks them as estimates: spell rows show pick rate and games but no
win rate, and game counts carry a "~".

- `config.json`: `"enabled": false` hides both everywhere (`web/src/lib/fill.ts`).
- `build_estimates.py`: after each stats refresh (`.github/workflows/fill.yml`, triggered by "Mayhem stats"). Writes
  `spells_games.json` for the live patch. Standard library only.
- `model.py`: the shared pieces.
- `fit_spells.py` + `spell_model.json`: the spell model's coefficients (numpy + scipy).

## Game counts

A champion's pick rate is its share of all games (pick rates add up to 10), so its games are
pick rate x total. The total comes from noise: the daily feed is cumulative per patch, so two
consecutive days give the win rate of each day's new games. That jitters by binomial noise,
sd = sqrt(p(1-p) / (games per day x pick rate)), while real drift grows with the gap between
days. Fitting both across ~170 champions gives games per day (`estimate_daily_games`). The
live patch uses the median over the last six complete patches with low drift and 10+ days,
times the live patch's days so far. On simulated data with a known total, the estimate
lands within about 10% when drift is low. Real patches give about 3-4 million a day.

## Summoner spells

Flash is in ~99% of Mayhem loadouts, so the model predicts the second spell from the Mayhem
pool (Mark, Ghost, Barrier, Heal, Ignite, Clarity, Cleanse; no Exhaust) with a softmax over:
Data Dragon class tags, melee/ranged, move speed, the champion's Mayhem stats (damage share,
tank share, kill participation, time dead) and its Summoner's Rift spell shares
(`lol_101strategy_skill`, lanes averaged), with Exhaust's share moved to Heal
(the owner's call). Every loadout is shown as Flash + that spell.

Fitted on 994 Mayhem games from the owner's own client archive (9,940 players; the archive
stays on the owner's computer, only coefficients are stored). 5-fold check by game: log
loss 0.949 vs 1.218 for overall shares; top spell right for 79% of champions with 60+ games.
Refit with:

    python3 data/fill/fit_spells.py ~/path/to/mayhem-backup.json

Real counts from the shared-games pool should replace both once it has volume.
