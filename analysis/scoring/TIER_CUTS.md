# Do the DeepScore tier cuts hold up? (2026-11-25)

Nico asked: do higher tiers really do better, and should the cuts (S 70+, A 59+, B 44+, C 32+, D below) move?
Run `python3 analysis/scoring/tier_cuts.py` (numbers in `tier_cuts.json`), then `python3 analysis/scoring/common_cuts.py`.

## 1. Public data, held out (score on patch T, judge on T+1, 16.19 to 16.23)

Next-patch lead over the list's average by tier, win-rate points (games-weighted; ± is one standard error):

| List | S | A | B | C | D |
|---|---|---|---|---|---|
| Champions | +5.00 | +1.71 | −0.34 | −2.82 | −4.89 |
| Augments (per champion) | +4.04 | +1.10 | −1.05 | −3.48 | −5.82 |
| Items (per champion) | +1.81 | +0.21 | −1.84 | −4.30 | −8.01 |
| Spell pairs (per champion) | +0.28 | +0.06 | −2.70 | −7.54 | −23.96 |

Every list is in order, S > A > B > C > D, and every step is many standard errors apart (most ± are 0.01 to 0.2). The
same holds on patch data thinned to 10% (a patch's first day).

## 2. Nico's games (archive, all 10 players, 2,560 player-games on 16.20 to 16.23, tiered with the previous patch)

| | S | A | B | C | D |
|---|---|---|---|---|---|
| Champion played | 53.2% (295) | 51.5% (400) | 51.6% (1,071) | 44.7% (604) | 49.5% (190) |
| Augments taken | 54.5% (1,632) | 50.3% (2,595) | 48.1% (3,652) | 47.3% (1,066) | 49.5% (204) |
| Items built | 59.5% (210) | 50.9% (434) | 43.8% (233) | 43.4% (53) | 44.4% (9) |

S is clearly above B in all three. D is too small to read (±3.5 to ±17). These numbers are correlated, not causal: who
picks what, and when.

## 3. Should the cuts move?

A grid sweep looked at every set of 4 cuts and asked how much of the next-patch lead the 5 tiers explain (R²).

- **Per list**, the best cuts differ: augments (85, 67, 55, 43), items (73, 64, 55, 40) full but (70, 64, 58, 49) on thin
  data, spells (61, 55, 40, 22). For champions, today's cuts are as good as any (gain 95% range −0.005 to +0.018).
- **One set for every list** (the site's single scale): (76, 64, 55, 40) explains a little more on average (R² 0.633 vs
  0.610; gain 95% range +0.008 to +0.035). But it is worse for champions (0.805 vs 0.824), and it puts 50, the list
  average, in C. "50 = average = B" is what the new legend teaches.

**Decision: keep S 70 / A 59 / B 44 / C 32.** The tiers do what they claim on every list. The only gain from moving
them is small, differs by list, and would break the one-scale, 50-is-B meaning Nico chose on 2026-11-24.
