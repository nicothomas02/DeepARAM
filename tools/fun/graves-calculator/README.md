# Infinite Graves

How often Graves can shoot without ever reloading in ARAM Mayhem, and how long his mana keeps up. Lives on the
site's Calculators tab (`/calculators?tab=infinite-graves`).

- `build_data.py` writes `data.js` (`window.GRAVES_DATA`) from CommunityDragon: Q, W, E and R cooldowns, mana costs,
  Graves' mana growth and attack numbers, and the Mayhem augments in his pool that change his cooldowns.
- `calc.js` plays the fight out (shared with `tests/data/test_data_lab_tools.py`).
- `app.js` is the page.

## The loop

- Quickdraw (E): each pellet that hits takes 0.5 s off its cooldown. A shot fires 4 pellets (6 on a crit). Quickdraw
  reloads one shell and resets Graves' attack.
- Mystic Punch: 1.25 s off every cooldown per enemy a shot hits, never leaving less than 0.5 s.
- Purist - Caster turns bonus attack speed into Ability Haste (0.65 per 1%) and cuts cooldowns 10%, so Graves shoots
  and reloads at base speed but Quickdraw comes back much faster.
- Bread and Cheese adds 100 haste to Quickdraw.
- The page's preset (Mystic Punch, Purist - Caster, Bread and Cheese, 1.5 attack speed, 50 haste) never reloads: a dash
  and a shot every 0.4 s, 150 shots a minute. Mana runs out in about 10 s at level 18 with no items.
- Off-meta check (AramHex 16.23, Graves games): Mystic Punch 1.3%, Purist - Caster 0.4% of picks.

## Rules used

- Loop = share of reloads Quickdraw replaces (0 = a full reload after every two shots, 1 = never reloads).
- Graves shoots when a shell and his attack are ready; he dashes when dashing gets the next shot out sooner than
  waiting. Quickdraw's 0.4 s dash counts as its cast time. Q, W and R are cast on cooldown only if those settings are on.
- Reload of both shells: 2.08 s with no bonus attack speed, 1 / 0.891 s at 150% bonus (League wiki). In between is a
  straight line (an estimate).

## Not modelled (flagged)

- Attack wind-up, walking and aiming. Pellets that hit are a setting.
