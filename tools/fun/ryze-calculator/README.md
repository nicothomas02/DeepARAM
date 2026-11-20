# Infinite Ryze

An interactive calculator for how much Ability Power Ryze reaches in ARAM Mayhem with a
given set of items and augments. Open `index.html` in a browser; nothing to install. `tools/fun/site-tab.json` makes `tools/fun/` a "Fun Tools" tab on the website (web/, PR #3), with `tools/fun/index.html` linking to each tool.

Ryze's passive gives him 10% max Mana per 100 AP. Seraph's Embrace gives 2% of bonus Mana
as AP, and Riftmaker (2%) and the Lich Brain augment (4%) give bonus Health as AP, which Mind to Matter (50% of max Mana
as Health) and Fimbulwinter (15% of bonus Mana as Health) feed from Mana. So AP feeds Mana
and Mana feeds AP. Every stat in that loop is linear in AP:

```
AP = start + loopGain × AP   →   AP = start / (1 − loopGain)
```

The page shows `loopGain` as the loop strength. At 100% or more the loop never settles and
AP is infinite; the page also says how much more base Mana would get there.

Picked items and augments live in the URL, so **Copy link** shares a build.

| File | What it does |
| --- | --- |
| `build_data.py` | Pulls Ryze, item and Mayhem augment numbers from CommunityDragon into `data.js` (ARAM/Mayhem item overrides applied). Run it after a patch: `python3 build_data.py` (or `--channel pbe`). |
| `calc.js` | The math, with no DOM, usable from Node (`require("./calc.js")`). |
| `app.js`, `index.html` | The page (styles are shared in `../style.css`). |
| `../cdragon.py` | CommunityDragon helpers shared by the Fun Tools data builders. |

## Assumptions

- AP % bonuses (Rabadon's, Wooglet's, Goliath, Hand of Baron, Mad Scientist, ADAPt, Blackfire Torch) add together, then multiply all AP, including Seraph's and Riftmaker's.
- Stacking effects (Rod of Ages, Mejai's, Phenomenal Evil, Master of Duality, Slap Around, Blackfire targets, Double Time's +25 max Mana per proc) use the numbers set on the page.
- Lich Brain's numbers are missing from the game files, so the page uses the wiki's 30 AP + 4% bonus Health.
- Mind to Matter's Health is capped at 99,999 in the game files. The page ignores the cap, so a build past 100% loop strength
  really levels off (around 25,000 AP) rather than going on forever.
- Cooldowns use rank 5 and all Ability Haste from items, Mad Scientist's tiny form and Eureka (30% of the final AP).
  W and E reset Q, so Ryze casts nonstop once E is back within two casts (E-Q-E-Q), or W and E within four (E-Q-W-Q).
- Items that the game limits to one (for example Seraph's and Archangel's, or Rabadon's and Wooglet's) can't be picked together; the limits come from the game's item groups.
- Wooglet's Witchcap comes from the Mayhem quest augment, so it needs that augment.
- Ability damage is rank 5, before resists; Mayhem's per-champion damage modifiers are not applied.

The "highest-AP build" preset came from trying every combination of 6 of the loop-relevant
items and 4 of the augments in Ryze's Mayhem pool at level 18 with default stacks: Seraph's Embrace,
Rabadon's Deathcap, Rod of Ages, Blackfire Torch, Riftmaker, Fimbulwinter with Goliath, Mad Scientist,
Mind to Matter and Lich Brain, for about 7,170 AP (74% loop strength) on patch 16.23. Swapping Goliath for
Double Time makes the loop infinite at about 153 stacks; swapping it for Eureka gives about 1,100 Ability
Haste, enough for the full E-Q-W-Q rotation without waiting.
