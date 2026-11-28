# Simulator breakpoints beyond pen (2026-11-28)

Research only. Nothing here feeds the engine yet.

## Wide item sweep (sweep.py, analyse.py → breakpoints.json)

- 4,327 champion, item and slot pairs were tested. In 2,825 of them, the item loses to the planned item at the typical state.
- A breakpoint counts as clear when the item flips to winning inside the range real games reach (team p5–p95).
  - Fight length: 866. These can't be seen in game, so they aren't shipped.
  - HP: 56.
  - MR: 16.
  - Armor: 12.
- Archive check (same champion and slot, buyers vs non-buyers by enemy stat):
  - Only 2 agree. Collector over Blade of the Ruined King against squishy teams (HP at or below 1,200–1,800) for Varus and Twitch: z 2.9, but only n 18.
  - The rest can't tell. For example, Blade of the Ruined King against tanky teams (HP at or above 1,800–2,400) for 13 ADCs and fighters: z 0.3, n 43.
- Verdict: nothing to ship. Real teams sit close to the typical state, so these flips rarely fire, and the archive can't confirm them.

## Augment stat sweep (aug_breakpoints.py, aug_analyse.py → aug_flips.txt)

- 10,549 comparisons, with and without each flat-stat augment in the champion's pool, slots 2–6. That gives 3,042 flips, where a ±2% loss turns into a ±2% win.
- The archive check pools each augment and item over all champions (augment-item-shift.json): 526 agree, 326 contradict, 2,190 no signal.
- **Crit augments** (It's Critical, Critical Rhythm, Zealot, Jeweled, Twin Fire, ...): 176 agree, 53 contradict.
  - With a big crit augment, a crit item later in the path loses to a non-crit damage item such as Axiom Arc, Serylda's or Bloodthirster.
  - This fits crit overcap at 100%.
- **Big Shot and Double Tap:** with Big Shot, Lord Dominik's and other non-on-hit items pass Blade of the Ruined King and Kraken Slayer; with Double Tap, Blade of the Ruined King passes crit items. The archive mostly agrees.
- **Haste augments** (Infinite Recursion, Shrink Engine, Recursion, Back To Basics): many flips, but they're inconsistent.
  - Infinite Recursion and Shrink Engine have the same effect but get opposite archive verdicts (Archangel's or Malignance over Shadowflame).
  - Likely simulator mana or cooldown artefacts. Not used.
- Overlap: the engine's augmentShift rule already moves items by how real holders of each augment build. A simulator rule would only matter where holders are too few.
