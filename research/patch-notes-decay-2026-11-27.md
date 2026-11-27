# How old-patch data fades, with patch notes (2026-11-27)

Question (Nico, via coordinator): should earlier patches fade faster for champions/augments/items the patch notes
touched, and slower for the rest, instead of one fixed rule? Also: game quality (remakes, AFKs, fun surrenders) and
outcomes other than win rate.

Data: AramHex 16.19-16.23 (4 patch changes). Patch notes: official pages 26.19-26.23 parsed into `touched.json`
(main Champions section = "kit", ARAM: Mayhem champion modifiers, Mayhem augment changes, Items). Items/spells have too
few patch changes (items only 16.22->16.23), so this covers augments and champions.

## 1. Do touched things actually move more? (drift.py)
True change between patches, after removing sampling noise:

| Group | Champion win rate | Champion x augment lead |
|---|---|---|
| Untouched | 0.96 pts SD (642) | 0.57 pts (74,369 rows) |
| SR kit change (main notes) | 1.00 pts (41) | 0.54 pts (5,624 rows) |
| Mayhem modifier change (dmg dealt/taken etc.) | **3.42 pts** (9) | (cancels: leads are vs the champion's own average) |
| Augment changed in Mayhem notes | n/a | **1.29 pts** (2,164 rows); 21% move > 4 SE vs 5% |

SR kit changes don't move Mayhem numbers more than normal drift. Mayhem modifier changes and augment changes do.

## 2. Champion x augment rows (bt_rows.py, grid.py)
Early-patch sample = 1/5/20/50% of the live patch, target = the rest (independent). Error = squared error minus target
noise (pts^2). Shipped = depth 2, decay 0.5, 4-SE gate (data/aramhex/common.py pool).

| Variant | 1% all | 5% all | 20% all | 50% all | touched rows 1/5/20/50% | top-5 next-best lead |
|---|---|---|---|---|---|---|
| Shipped | 0.411 | 0.229 | 0.107 | 0.058 | 1.05 / 0.48 / 0.148 / 0.073 | +4.11 / 4.58 / 4.91 / 5.08 |
| Reset touched augments | 0.429 | 0.226 | 0.106 | 0.058 | 1.55 / 0.41 / 0.117 / 0.063 | same |
| **Drift weights 0.5 pts/patch, 1.3 for touched augments** | **0.372** | **0.189** | **0.088** | **0.053** | **0.67 / 0.26 / 0.095 / 0.057** | +4.13 / 4.58 / 4.91 / 5.08 |
| Drift 0.5 for all (no patch notes) | 0.378 | 0.187 | 0.090 | n/a | 0.88 / 0.33 / 0.103 | same |
| Also reset champs touched (kit or modifier) | worse | worse | worse | worse | | slightly worse |
| Untouched slower decay (0.75, 1.0, depth 3) | worse | worse | worse | worse | | same |

Drift weights: an earlier patch's lead gets weight 1 / (its noise + age x tau^2) instead of 0.5^age / noise, so a
big old sample can't swamp a moderately sized live one. Flat across tau 0.3-0.8 / 1.0-2.0. Gate and depth unchanged.
Today on 16.23: 58 of 173 champions swap one augment in an approximate top-5 (near-ties; e.g. nerfed Bouncing Bees and
Boom and the Bass drop out), median row moves 0.08 pts, 90th pct 0.28.

## 3. Champion "{live}+" (bt_champ.py)
Mayhem-modifier champions reset to live patch only (like the pool-change reset): their error halves on day 1
(1,000 live games: MAE 2.37 -> 1.22 pts; 3,000: 1.25 -> 0.75; 10,000: 0.56 -> 0.40; 30,000: 0.24 -> 0.23), overall
0.98 -> 0.90 pts^2 at 1,000 games. Only 9 champion-patches (16.20, 16.23): small sample, clear mechanism.
SR kit reset: worse. Bigger prior for untouched champions (K=30k): worse at 10k+ games.

## 4. Game quality and other outcomes
- AramHex already drops games under 4 minutes, games without exactly 10 players / 5 wins + 5 losses, abnormal endings,
  and (16.22+) bots, duplicate players, private games; items only from 5+ minute games. ~3% of 16.23 games dropped.
- Nico's archive (1,267 games, LCU): remakes under 4 min 2.0% (dropped upstream), surrender at 4-10 min 2.4%,
  surrender while close (kills within 5, towers within 1) 2.4%, likely AFK (damage < 12% of team mean, 8+ min) 0.6%.
  In clean games the stronger-on-paper team won 58.4% (245); in the ~20 noisy games about 35% (too few to read).
- So noisy games are ~3-5% of what AramHex counts. They shrink every gap a little (a 55% champion would be ~55.2%) but
  can't reorder rankings unless some champions get more of them, which aggregate data can't show.
- Other outcomes: AramHex has only games + wins. 101 has champion-level damage share/KP, but champion win rates are
  already precise (millions of games). Where other outcomes would help (small champion x augment rows, own record) we
  need per-game data: the public app's shared games already carry duration, damage, gold, level per player, but NOT
  Riot's surrender flags (gameEndedInSurrender / EarlySurrender) — adding them would let own data filter fun surrenders.
