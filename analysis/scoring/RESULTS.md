# DeepScore formula review (2026-11-23)

Question (Nico): is any AramHex data technically correct but scored or shown in a way that could be better, and does
DeepScore's formula fit its purpose (pick the option most likely to win this game, robust to small samples)?

Run `python3 analysis/scoring/backtest.py` for the formula tables. Every check scores on patch T and is judged on T+1's
games (16.19 to 16.23), which the rule never saw. "Thinned" resamples patch T at 10% of its games, like a patch's
first day.

## Formula: what should a row be ranked on?

Rules: **shrunk** (champion cards today: empirical-Bayes lead), **bound** (tier lists today: fitted estimate minus one
typical miss), **popprior** (shrink toward the lead typical of rows that popular, fitted per patch), **raw**,
**popular**. "Offer" = next-patch lead of the pick from random 3-option offers (augments within one rarity) minus the
offer's average; paired difference vs shrunk, with a rough 3x-inflated standard error.

| List | Data | bound - shrunk | popprior - shrunk |
|---|---|---|---|
| Augments | full | +0.008 ± 0.006 pts | +0.004 ± 0.006 |
| Augments | thinned | **+0.082 ± 0.009** | **+0.079 ± 0.009** |
| Items | full | +0.016 ± 0.049 | +0.022 ± 0.045 |
| Items | thinned | +0.088 ± 0.104 | +0.096 ± 0.080 |
| Spell pairs | full | **+0.214 ± 0.070** | **+0.207 ± 0.068** |
| Spell pairs | thinned | **+0.401 ± 0.100** | **+0.299 ± 0.086** |

Why: rare rows really are worse. Next-patch lead by a row's games as a share of its list's top row (augments): under 1%
-4.1 pts, 1-3% -2.9, 3-10% -2.0, 10-25% -0.8, 25-50% +0.3, 50%+ +1.3 (items and spells the same shape). Shrinking
every row toward the list's average flatters rare rows; a penalty for uncertainty (bound) or a popularity-aware prior
corrects it. Binomial noise is the right size (squared lead change between patches / predicted variance = 1.0-1.1 for
rows under 1,000 games), so the issue is the prior's centre, not the noise model.

## Following rule (a row needs 1/4 of the top row's games or 2,000 to lead)

Top-5 next-patch lead, with rule / without:

| List | shrunk | bound |
|---|---|---|
| Augments full | +4.86 / +4.89 | +4.85 / +4.90 |
| Augments thinned | +4.32 / +4.58 | +4.33 / +4.55 |
| Items full | +3.29 / +3.77 | +3.33 / +3.59 |
| Items thinned | +2.24 / +2.08 | +2.23 / +2.77 |
| Spells full | -1.11 / -0.74 | -1.11 / -0.30 |
| Spells thinned | -0.40 / -1.91 | -0.40 / -1.05 |

The rule costs about 0.3-0.5 pts on items' top picks at full data; with bound it can be dropped for items and augments
without losing on thin data, but not for spell pairs.

## Display scale

DeepScore is a z-score within each list (50 average, 15 per SD). One SD of true augment leads is 2.1 pts (10th
percentile champion) to 4.2 pts (90th), items 2.8 to 5.4, so a given DeepScore means up to twice the win-rate edge on
one champion as another. Every in-game decision is within one list (one champion's offers or items), where the z-score
is the right yardstick; across champions, only the Tier List compares, and it is one list.

## Other checks

- **Skill brackets:** each bracket's own champion win rates predict that bracket's next patch far better than all
  brackets pooled (16.21 to 16.22 rank correlation: high 0.970 vs 0.834, mid 0.963 vs 0.950, casual 0.968 vs 0.915).
  The Tier List bracket picker (#637) is worth it. AramHex has brackets only for champion win rates, not builds.
- **Items held at game end favouring late items:** not supported. Average item lead by usual buying slot: 1st -0.0,
  2nd +0.2, 3rd +0.0, 4th +0.0, 5th -1.7 pts.
- **Augment rarity:** average lead by rarity is within 0.2 pts (prismatic +0.18, gold -0.04, silver -0.11), so ranking
  across rarities on a champion's card doesn't push one rarity up.
- **Champion tier list formula:** next-patch rank correlation of champion win rates is 0.84-0.98; its fitted
  uncertainty is nearly the same for every champion, so bound and estimate rank alike. No change.
- **Ordered 3-item cores:** merging orders would change the most-played core for 6 of 172 champions; 16.23's cores
  are still 16.22's. Low value, left as is.
