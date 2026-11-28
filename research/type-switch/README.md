# Damage-type switches

- `augment_type_switch.py`: which augments make holders build the other damage type, from the archive (z >= 4). The engine reads the result from `web/src/data/augment-type-switch.json` (augmentTypeSwitch, engine 1.4.19).
- `team_mix.py` (2026-11-28, Nico's AP Zeri reasoning: two allied ADCs and no enemy tanks). Question: on flex champions, does going against a one-type team win more? Results are in `team_mix.json`. **Not confirmed, so nothing shipped.**
  - Pre-set test, flex champions = both types at 15%+ (10 champions), matched within champion:
    - Heavy team overall: +3.3 ± 7.9 pts (z 0.4).
    - Heavy team with no enemy tank: +15 ± 6.1 (z 2.5, n 47 vs 19).
    - Heavy AD team: +9.6 ± 10.9.
  - Sensitivity, flex at 8%+ (16 champions):
    - Heavy team with no enemy tank: +20.3 ± 6.5.
    - Placebo, the same champions in teams that are not one-type with no enemy tank: going off their usual type also wins +7.1 ± 6.3.
    - The team-mix part is therefore about 13 pts with an SE of about 9 (z ~1.4). That is underpowered, and it came from several looks at the data.
  - Re-test when the archive is about 3 times larger.
