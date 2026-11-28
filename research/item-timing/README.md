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

## 2026-11-28 rerun: Bloodletter's and armor items

Same method, adding Bloodletter's Curse (MR shred) and Black Cleaver (armor shred) next to the armor pen items
(Lord Dominik's, Mortal Reminder, Serylda's, Terminus). 365 champion-item pairs. A breakpoint is kept only when it is
clear: the planned 2nd item is the same damage type, the pen item loses at the typical resist (44 MR / 53 armor at the
2nd-item decision) and wins at some resist above it.

| Item | Pairs | Clear breakpoint | Median resist | Wins already at typical | Never wins (to 250) | Planned 2nd is another type |
|---|---|---|---|---|---|---|
| Void Staff | 83 | 36 | 70 MR | 20 | 2 | 25 |
| Cryptbloom | 76 | 39 | 120 MR | 16 | 2 | 19 |
| Bloodletter's Curse | 36 | 2 | 130 MR | 6 | 23 | 5 |
| Lord Dominik's | 44 | 9 | 100 armor | 12 | 3 | 20 |
| Mortal Reminder | 55 | 8 | 80 armor | 14 | 21 | 12 |
| Serylda's | 23 | 5 | 110 armor | 7 | 6 | 5 |
| Terminus | 28 | 7 | 100 armor | 5 | 5 | 10 |
| Black Cleaver | 20 | 4 | 180 armor | 7 | 8 | 1 |

"Wins already at typical" is a stat-package effect (the pen item simply out-damages the planned item), not a resist
breakpoint, so it isn't shipped. Bloodletter's barely ever pays as a 2nd item: its shred needs stacks, and the dummy
fight at level 6 rarely gets there. Estimated: players almost never buy these 2nd, so the archive can't confirm them.
