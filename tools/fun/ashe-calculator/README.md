# Infinite Ashe

How often Ashe can cast Enchanted Crystal Arrow (R) in ARAM Mayhem. Open `index.html` in a browser; nothing to
install. It is the second tab of the site's Calculators page (`/calculators?tab=infinite-ashe`), after Infinite Ryze.

Archmage takes 30% of a cast ability's base cooldown off another random ability. Hawkshot (E) is a 2-charge ability
with a 90 to 50 s recharge, so each Hawkshot can take 27 to 15 s off R, and each R takes 30 / 24 / 18 s off
Hawkshot's recharge. With enough haste the two keep bringing each other back. Hawkshot can't be cast more than once
per 5 s gap (shortened by haste) plus its cast time, so an R for every Hawkshot at that pace is a closed loop.

The target is random, so `calc.js` plays the fight out many times (seeded, so a build always shows the same numbers):
R first whenever it is up, then Hawkshot, then Volley if that setting is on, 0.25 s per cast, no walking or aiming.

| File | What it does |
| --- | --- |
| `build_data.py` | Pulls Ashe's W/E/R cooldowns, Hawkshot's charges and recharge, and the Mayhem augments that change them from CommunityDragon into `data.js`. Run after a patch: `python3 build_data.py`. |
| `calc.js` | The fight math, with no DOM, usable from Node (`require("./calc.js")`). |
| `app.js`, `index.html`, `ashe.css` | The page (shared styles in `../style.css`). |

## Assumptions (confirmed by Nico, 2026-11-23; changed 2026-11-24 after checking against AramHex's Ashe page)

- Archmage's refund lands only on abilities on cooldown, and Volley (W) isn't cast, so Hawkshot and R refund each other
  (AramHex's AP Ashe Archmage guide; Nico chose this reading on 2026-11-24, replacing "Q can take it" from 2026-11-23).
  Settings switch back to "any ability" and to casting Volley.
- For a Hawkshot cast, Archmage's "base cooldown" is the recharge (90 to 50 s), not the 5 s gap between casts.
- Changed 2026-11-24 (Nico asked to verify against AramHex's Ashe page; its results only match with these):
  - Haste shortens Hawkshot's 5 s gap between casts (Ultimate Awakening's 300 included).
  - Cooldowns start when the 0.25 s cast ends (the wiki: most abilities do), so the fastest loop is one Hawkshot
    per gap plus a cast time.
  - A refund bigger than what is left of Hawkshot's recharge gives a charge and the rest goes into the next one.
  - The loop counts as closed at 90% of the Hawkshots the gap allows (AramHex's stable thresholds land within 2 haste).
  - Total haste is capped at 500 (wiki: Haste).
- Ultimate Awakening refills both Hawkshot charges and resets Volley; its 300 haste speeds up W and E only.
- Ultimate Revolution resets R right after the cast, once per 75 s.
- Mystic Punch takes 1.25 s off R, W and Hawkshot's recharge per basic attack, keeping at least 0.5 s of what's left
  (the Simulator's reading of `MinCDR`), Hawkshot's recharge included. Attacks only land between casts.
- Purist - Caster: only its 10% shorter cooldowns are added; its attack speed to haste is already in the panel haste.
  It takes 10% of the base cooldown off the hasted cooldown, as AramHex's page does (Nico chose this 2026-11-24 over
  10% off the hasted cooldown; neither the wiki nor the game files settle it).
- Ultimate Recursion's 50 Ultimate Haste and Purist's 10% are missing from the game files and come from the wiki.

Checked against AramHex's Ashe page (2026-11-24, Archmage only, R per minute after the first minute): R3 E4 at 100,
150, 202 and 300 haste: 5.0, 9.6, 28.4 and 40 on both; R2 E2 at 210: 29.2 on both; Ultimate Awakening at 100: 11.4 on
both. Stable thresholds: R3 E4 202 / 202, R2 E2 210 / 210, R1 E1 249 / 250, R3 E5 261 / 263, Ultimate Awakening 185 /
185, Bread and Cheese 209 / 210, Purist - Caster 132 / 132 (34.3 / 34.4 R per minute at 150 haste) (AramHex / ours).

The "infinite build" preset: Archmage, Ultimate Awakening, Ultimate Recursion and Mystic Punch at 1.5 attacks per
second close the loop from 20 haste at Hawkshot rank 1, 65 at rank 3 and 170 at rank 5. Archmage alone needs about
200 at R rank 3 (Hawkshot rank 4, patch 26.23).

`data/estimates/ashe_archmage.js` (kept out of this folder so it doesn't ship) writes the haste every set of loop augments needs, per R and Hawkshot rank, to
data/estimates/ashe_archmage.json for AP Ashe's Archmage build on her champion page and in the apps
(web/src/lib/archmage-route.ts). Run it after `build_data.py`.
