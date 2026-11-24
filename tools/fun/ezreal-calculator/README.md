# Infinite Ezreal

How often Ezreal can fire Mystic Shot (Q) in ARAM Mayhem, and how long his mana keeps up.
Lives on the site's Calculators tab (`/calculators?tab=infinite-ezreal`).

- `build_data.py` writes `data.js` (`window.EZREAL_DATA`) from CommunityDragon: Q's cooldown, mana, cast time and
  1.5 s refund, W's cooldown and cost, Ezreal's mana growth, and the Mayhem augments that change Q's cooldown.
- `calc.js` plays the fight out (shared with `tests/data/test_data_lab_tools.py`).
- `app.js` is the page.

## The loop

- A Mystic Shot hit takes 1.5 s off the current cooldowns of all Ezreal's abilities, Q's own included (wiki).
- Skilled Sniper (wiki): a basic ability hitting a champion from 600+ units takes 80% of its **total** cooldown off.
  At the hit, Q has c - flight left; minus 0.8c and 1.5 s that is never above 0 (c is at most 5.5 s). So from 600+
  units Q is back the moment it lands, at any haste: one Q per 0.25 s cast plus the flight time (distance / 2,000).
  - 600 units: 109 a minute. 1,000 units: 80. 1,200 units: 71. Closer is faster, as long as it is 600 or more.
- Without Skilled Sniper: Q is back at the hit once its hasted cooldown is no more than flight + 1.5 s. At rank 5 from
  1,000 units that needs about 125 haste (the page's 90% rule finds 116).

## Rules used

- Q's cooldown starts when the cast ends; the missile leaves then. Total Ability Haste is capped at 500.
- Bread and Butter adds 100 haste to Q. Purist - Caster takes 10% of the base cooldown off.
- Archmage only picks abilities on cooldown. "Arcane Shift and Trueshot Barrage are on cooldown" adds them as targets
  (a refund on them does nothing for Q).
- Essence Flux (W, optional): marks the target for 4 s; the next Q hit sets it off and gives back 60 mana plus Q's cost.
- Mana: starts full, regenerates continuously, and a cast waits until its cost is there. Defaults are Ezreal's level
  18 mana and regeneration with no items.

## Flagged (not confirmed)

- Mystic Punch says "basic attacks on-hit". Mystic Shot applies on-hit effects, so the page lets it trigger Mystic
  Punch, behind a setting labelled "not confirmed in game".
- Every shot hits. Misses, walking and aiming are not modelled.
