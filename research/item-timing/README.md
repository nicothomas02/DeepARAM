# Item timing from reasons (2026-11-27)
Nico: find the reason behind an order, back it with math, check it against data.

- Archive (owner games, all players; scripts in /mnt/project-files/research/item-timing/, private input): % pen items
  are bought ~1 slot later than other items (mean slot 3.9 vs 2.9); within the same slot, earlier vs more enemy resist
  (z +1.7 to +5.9) and, for Void Staff / Lord Dominik's, with more own damage (z +3.0 / +3.4). Rabadon's only follows
  own AP (z +10), as a multiplier on AP should.
- Simulator (`pen_breakpoints.py`, fixed dummy at the archive's typical level/health/resists for each decision):
  vs the core's planned damage item of the same type, a pen item as 2nd legendary loses (median -2.5%, wins 61 of 189)
  and as 3rd is even (-0.2%, wins 81 of 164). Magic pen wins as 2nd item from about 70 enemy MR (median champion; typical
  MR at that decision is 44, 54 at the 3rd, 64 at the 4th). Armor pen results don't separate (often "wins" from 20 armor),
  so they aren't used.
- Check: on 2nd-item decisions where enemy MR was at or above the champion's simulated breakpoint, players took magic pen
  0.07% of the time (2 of 2,848) vs 0.19% below. Nobody acts on it, so the archive can't confirm the gate.
