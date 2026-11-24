# Infinite Zilean

How often Zilean can throw Time Bomb (Q) in ARAM Mayhem, and how long his mana keeps up.
Lives on the site's Calculators tab (`/calculators?tab=infinite-zilean`).

- `build_data.py` writes `data.js` (`window.ZILEAN_DATA`) from CommunityDragon: Q, W and E cooldowns, mana costs and
  cast times, Rewind's 10 s reduction, Zilean's mana growth, and the Mayhem augments that change his cooldowns.
- `calc.js` plays the fight out (shared with `tests/data/test_data_lab_tools.py`).
- `app.js` is the page.

## The loop

- Rewind (W) takes 10 s off the remaining cooldowns of Time Bomb and Time Warp. Time Bomb's cooldown is 10 s at
  most, so every W brings Q straight back. Rewind has no cast time, and it needs Q or E on cooldown.
- Archmage: every cast takes 30% of its own base cooldown off another random ability that is on cooldown. If Zilean
  only casts Q and W, a Q's refund (3 s at rank 1, 2.4 s at rank 5) always lands on W.
- Q-W-Q-W never waits once W's hasted cooldown fits inside that refund plus Q's 0.25 s cast:
  - W rank 5 with Q rank 1: 6 x 100 / (100 + h) <= 3.25 at about 85 haste (the page finds 84).
  - W rank 5 with Q rank 5: about 127 haste (the page finds 125).
  - That is 240 Time Bombs a minute, and every second bomb lands on a bombed target: 120 stuns a minute.
- Without Archmage: one Q per Rewind cooldown, so 60 a minute at W rank 5 and 500 haste.

## Rules used

- Cooldowns start when the cast ends. Total Ability Haste is capped at 500.
- Bread and Butter / Jam / Cheese add 100 haste to Q / W / E. Purist - Caster takes 10% of the base cooldown off.
- Archmage only picks abilities on cooldown. "Chronoshift (R) is on cooldown" adds R as a target; a refund on R does
  nothing for the loop, so then the loop doesn't close.
- "Cast Time Warp (E) on cooldown too": E's own Archmage refund (4.5 s) usually lands on W, which helps.
- Mana: starts full, regenerates continuously, and a cast waits until its cost is there. Defaults are Zilean's level
  18 mana (1,302) and regeneration (about 25 per 5 s) with no items.

## Not modelled (flagged)

- Time Bomb's flight time and walking or aiming.
- Ultimate Awakening (R refreshes basics and adds haste for 15 s): Chronoshift is cast rarely, so it is left out.
- Mayhem's per-champion damage or cooldown modifiers.
