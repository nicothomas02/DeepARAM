# Infinite Ashe

How often Ashe can cast Enchanted Crystal Arrow (R) in ARAM Mayhem. Open `index.html` in a browser; nothing to
install. It is the second tab of the site's Calculators page (`/calculators?tab=infinite-ashe`), after Infinite Ryze.

Archmage takes 30% of a cast ability's base cooldown off another random ability. Hawkshot (E) is a 2-charge ability
with a 90 to 50 s recharge, so each Hawkshot can take 27 to 15 s off R, and each R takes 30 / 24 / 18 s off
Hawkshot's recharge. With enough haste the two keep bringing each other back. Hawkshot can't be cast more than once
per 5 s, so about 12 R per minute is a closed loop: an R for every Hawkshot.

The target is random, so `calc.js` plays the fight out many times (seeded, so a build always shows the same numbers):
R first whenever it is up, then Hawkshot, then Volley if that setting is on, 0.25 s per cast, no walking or aiming.

| File | What it does |
| --- | --- |
| `build_data.py` | Pulls Ashe's W/E/R cooldowns, Hawkshot's charges and recharge, and the Mayhem augments that change them from CommunityDragon into `data.js`. Run after a patch: `python3 build_data.py`. |
| `calc.js` | The fight math, with no DOM, usable from Node (`require("./calc.js")`). |
| `app.js`, `index.html`, `ashe.css` | The page (shared styles in `../style.css`). |

## Assumptions (confirmed by Nico, 2026-11-23; the first changed 2026-11-24)

- Archmage's refund lands only on abilities on cooldown, and Volley (W) isn't cast, so Hawkshot and R refund each other
  (AramHex's AP Ashe Archmage guide; Nico chose this reading on 2026-11-24, replacing "Q can take it" from 2026-11-23).
  Settings switch back to "any ability" and to casting Volley.
- For a Hawkshot cast, Archmage's "base cooldown" is the recharge (90 to 50 s), not the 5 s gap between casts.
- Haste doesn't shorten Hawkshot's 5 s gap between casts. A refund that finishes a charge doesn't carry over.
- Ultimate Awakening refills both Hawkshot charges and resets Volley; its 300 haste speeds up W and E only.
- Ultimate Revolution resets R right after the cast, once per 75 s.
- Mystic Punch takes 1.25 s off R, W and Hawkshot's recharge per basic attack, keeping at least 0.5 s of what's left
  (the Simulator's reading of `MinCDR`), Hawkshot's recharge included. Attacks only land between casts.
- Purist - Caster: only its 10% shorter cooldowns are added; its attack speed to haste is already in the panel haste.
- Ultimate Recursion's 50 Ultimate Haste and Purist's 10% are missing from the game files and come from the wiki.

The "infinite build" preset: Archmage, Ultimate Awakening, Ultimate Recursion and Mystic Punch at 1.5 attacks per
second close the loop from any haste at Hawkshot rank 1 to 3 (30 at rank 5); with Purist - Caster instead of Mystic
Punch, from 0 at rank 1 and 90 at rank 5. Archmage alone needs about 200 (rank 3 or 5) at R rank 3 (patch 26.23).

`thresholds.js` writes the haste every set of loop augments needs, per R and Hawkshot rank, to
data/estimates/ashe_archmage.json for AP Ashe's Archmage build on her champion page and in the apps
(web/src/lib/archmage-route.ts). Run it after `build_data.py`.
