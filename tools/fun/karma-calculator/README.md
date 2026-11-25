# Infinite Karma

How often Karma can empower Inner Flame (Q) and Focused Resolve (W) with Mantra (R) in ARAM Mayhem, and how long her
mana keeps up. Lives on the site's Calculators tab (`/calculators?tab=infinite-karma`).

- `build_data.py` writes `data.js` (`window.KARMA_DATA`) from CommunityDragon: Q, W, E and R cooldowns, mana costs and
  cast times, Karma's mana growth, and the Mayhem augments in her pool that change her cooldowns.
- `calc.js` plays the fight out (shared with `tests/data/test_data_lab_tools.py`).
- `app.js` is the page.

## The loop

- Gathering Fire: every enemy champion hit by a damage instance takes 4 s off Mantra (League wiki). Q hits once and
  Soulflare (RQ) explodes again 1.5 s later; W hits on cast and again when its 2 s tether ends.
- Mystic Punch takes 1.25 s off every cooldown per on-hit, never leaving less than 0.5 s (game data MinCDR). Ethereal
  Weapon makes ability hits apply on-hit, once per enemy every 1.5 s (game data; the wiki text says 1 s).
- Archmage: each cast takes 30% of its own base cooldown off another random ability on cooldown, Mantra included.
- Ultimate Awakening: every Mantra resets Q, W and E and adds 300 basic haste for 15 s (20 s cooldown), plus 30
  Ultimate Haste.
- With all four and Q hitting three enemies, every Q is a Soulflare (240 a minute, one per 0.25 s cast) from about
  80 Ability Haste. With two enemies hit it needs about 150 to 180. Mana runs out within seconds.
- Off-meta check (AramHex 16.23, Karma games): Mystic Punch 0.4% and Ethereal Weapon 1.4% of picks.

## Rules used

- Cooldowns start when the cast ends. Total Ability Haste is capped at 500. E and R have no cast time.
- Karma casts Mantra whenever it is up and Q or W is ready, then the empowered spell, then whichever of Q and W is ready.
- Bread and Butter / Jam / Cheese add 100 haste to Q / W / E. Purist - Caster takes 10% of the base cooldown off.
- Ultimate Revolution resets Mantra once per 75 s; Ultimate Recursion adds 50 Ultimate Haste (wiki).

## Not modelled (flagged)

- Travel time, walking, aiming and missed skillshots: every Q hits the set number of enemies.
- Renewal's (RW) and Soulflare's extra effects beyond the hits above.
