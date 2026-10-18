# Yunara ARAM Mayhem DPS simulator

A Monte Carlo simulator for Yunara builds in ARAM Mayhem. Each trial plays out one teamfight with random fight length, crowd control, enemy grouping, crit rolls and W hits, and reports damage per second for each build.

```sh
cd simulator
make run              # build and run every preset build
make test             # sanity checks
./yunara_sim --help   # all options
```

Example custom build:

```sh
./yunara_sim --items berserkers,yuntal,ie,pd,ldr,runaan \
             --augs symphony_of_war,critical_rhythm,upgrade_ie,double_tap \
             --enemy-dps 700,250 --clump 4,0.6
```

`./yunara_sim --list` shows every item, augment and preset build id. `--json` prints machine-readable results for the website.

## Where the numbers live

Every game number is in [`data/yunara_mayhem.json`](data/yunara_mayhem.json): champion stats, ability values, Mayhem rule changes, items, augments, preset builds and the default fight scenario. The C++ only holds mechanics, so a patch update is a data edit.

Each entry has a `confidence`:

- `verified`: two or more current sources agree.
- `likely`: one current source.
- `approx`: an estimate. These are the values to correct from in-game tooltips.

The biggest estimates right now are Yunara's W damage, Q active duration and spread ratio, the R refund on W, the Mayhem augment values (Critical Missile's firecrackers, Symphony of War runes, Critical Rhythm, Typhoon, Deft) and how often Stormrazor charges.

## What a trial models

- **Fight:** length drawn from a normal distribution (default 18 ± 6 s) and 0 to 4 grouped enemies near her target.
- **Enemy team:** each fight draws 5 enemy champions by their China-server ARAM Mayhem pick rate (101.qq.com), from `data/cn_enemy_pool.json`. Each champion has their real level-18 base stats plus an estimated late-game item package for their role, their damage type and Tencent's 1-3 crowd-control rating. Overkill is wasted. When the target dies she switches to a grouped enemy, or waits for a new one if none is near. `--target HP,AR,MR` swaps in one fixed target, and `--enemies archetypes` uses a simple squishy/bruiser/tank mix instead.
- **Crowd control:** the drawn team's CC ratings set how often Yunara gets interrupted (about 0.125 per second on an average team, each 0.75 to 1.75 s). She can't act while interrupted.
- **Enemy damage:** the enemy team starts hitting Yunara 2 to 6 s in. The base rate (500 ± 200 per second for an average player, before armor and MR) is an estimate; it is scaled by Yunara's real share of her team's damage taken in CN games (0.79x the average player) and by how damage-heavy the drawn champions are, and the physical/magic split follows their damage types. Health items, lifesteal and Soul Siphon healing keep her alive longer. If she dies she deals no more damage, and DPS is still averaged over the whole fight, so fragile builds pay for it. The report shows how often she survives and how long she stays alive. `--enemy-dps 0,0` turns this off.
- **Kit:** passive crit magic damage; Q on-hit, stacks, and the active's attack speed, extra on-hit and spread; W impact plus lingering zone, cast time shortening with bonus attack speed; R with Arc of Ruin and E attack resets.
- **Mayhem rules:** Mayhem inherits all regular ARAM balance changes and adds its own on top, so both are applied (Yunara's ARAM damage dealt and taken are both unchanged; BotRK's ARAM on-hit buff is in). Also 200% base crit damage, crit above 100% turning into AD, the 5.0 attack speed cap (10 with full Lethal Tempo) and the 80/70/60 s ultimate.
- **Items and augments:** stat items plus Rageblade Seething and Phantom Hit, BotRK (with its ARAM on-hit override), Kraken, Runaan's, Stormrazor, Atma's Reckoning and Yun Tal Flurry. Augments: Dual Wield, Critical Missile, Soul Siphon, Deft, Upgrade Infinity Edge, Double Tap, Critical Rhythm, Jeweled Gauntlet, Symphony of War, Mystic Punch and Typhoon.

Not modeled: mana, Yunara taking damage, lifesteal, and positioning-dependent augments (Scopiest Weapons, Tap Dancer).

## Enemy pool data

`tools/build_enemy_pool.py` builds `data/cn_enemy_pool.json`. It reads the champion snapshot from `data/cn/fetch_cn.py` (pick rates, damage and damage-taken shares, time dead; fetches the table itself if that file is missing) and adds each champion's base stats, role, damage type and CC rating from Tencent's champion files on game.gtimg.cn. Re-run it to refresh:

```sh
python3 simulator/tools/build_enemy_pool.py
```

The item package per role and the average CC rate are estimates (listed in the pool file's `meta`); everything else comes from the CN data.

## Augment availability

Each augment in the data file has `offered_to_yunara`. It is `confirmed` when the augment shows up in Yunara's ARAM Mayhem augment stats on current stat sites, which means players actually get offered it on her. Preset builds only use confirmed augments, and `make test` checks that. A custom build that uses an unconfirmed augment (currently Stats on Stats and Goliath) still runs but prints a warning.

## Reproducibility and the website

The simulator core (`src/sim.cpp`) is single-threaded and seeds each trial from `(seed, trial index)` with its own random number generator. Results are identical no matter how trials are split across threads, and the same seed gives the same answer natively and in the browser.

`make wasm` builds a WebAssembly version with Emscripten. The plan for the site is to run one copy per Web Worker, each taking a slice of the trials. That avoids WebAssembly threads, which need COOP/COEP headers that static hosts can't set.

# All-champion simulator (`mayhem_sim`)

`mayhem_sim` runs the same kind of teamfight for any of the 173 champions and searches for the item and augment build with the highest damage per second. It shares the Yunara sim's fight model, CN enemy pool and RNG, but each champion's kit is built automatically from game data rather than written by hand, so treat it as an approximation.

```sh
make                          # builds yunara_sim and mayhem_sim
./mayhem_sim --champ Ahri     # best builds for Ahri
./mayhem_sim --champ Jinx --items berserkers,infinity_edge,botrk,lord_dominiks,runaans,seryldas \
             --augs deft,its_critical,mystic_punch,dual_wield
./mayhem_sim --kit Lux        # what the sim read from Lux's abilities
./mayhem_sim --all --json     # every champion (about 2 minutes on 4 cores)
make test                     # both test suites
```

## How a champion is built

`tools/build_champion_pool.py` writes `data/champions.json` from:

- The client's champion list and per-champion game data (CommunityDragon `latest`, live 16.20) for roles, cooldown fallbacks and icons.
- CommunityDragon champion bins for base stats (`CharacterRecord`), ability values, damage formulas, cooldowns and ammo. Riot's own per-mode values (`DataValuesModeOverride`, ARAM then Kiwi = Mayhem) are applied on top, and so is the Mayhem cooldown override (`{f9c2333e}`).
- The CommunityDragon string table for ability tooltips. Damage tags (`<magicDamage>`, `<physicalDamage>`, `<trueDamage>`) say which formulas deal damage and of what type. Heals, shields and minion or monster damage are skipped.
- The official League wiki only for the server-side Mayhem modifiers the client files don't carry, read from `data/wiki/mayhem_modifiers.json` (shared with the guide). Each champion's `mayhem` block holds damage dealt and taken, `healing` and `shielding` (multipliers), `tenacity` (0-1, stacked with items' tenacity), ability haste and attack speed. Cooldown changes come from the bins above. Mode rules the guide also shows (attack speed cap, crit conversion, the long-range damage cut) are copied from `guide/mode_rules.json` into `data/mayhem_rules.json` by `tools/sync_mode_rules.py`; a test fails when they drift.
- `data/cn/champions.json` (101.qq.com) for role, damage share and damage taken.

Each champion gets a `parse_quality` of good, partial or none (currently 142 / 31 / 0). Abilities the parser gets wrong are fixed in `data/champion_overrides.json`, each with a reason. Passive damage comes from each passive's tooltip the same way; `data/passives.json` says when it lands (every Nth attack, on ability hits, after an ability, cooldowns), and passives left out of it deal no damage. Stat and stacking passives are in `data/kit_passives.json`, written in the same stats and effects keys as augments: permanent stacks use an assumed count at level 18 (Veigar 300 AP, Senna 60 souls, Thresh 70 souls, Cho'Gath, Sion and Swain Health), and in-fight stacks build up as the fight goes (Jax, Jinx, Ezreal and Irelia attack speed). Kayle attacks from 525 range from level 6. Champion crit rules are there too: Yasuo and Yone double their crit chance and crit for 10% less, and Jhin keeps a fixed attack speed, crits every fourth shot for 14% less, and turns level, crit and attack speed into AD. Abilities cost mana or energy (each spell's cost at its rank, the champion's pool and regeneration from its record, plus item mana): a champion short of it waits for it to come back, so long fights favor cheap or free kits. Enemies cast their own abilities on you: each damaging or hard-CC ability goes off on its cooldown once you're in its range, skillshots land 70% of the time, and those hits carry 65% of the enemy's damage (35% for marksmen; the rest is a steady stream while you're in its reach), so a kiting champion still gets hit by long-range spells. The stuns and knockups you suffer are the enemy's own, with their real durations, at real games' crowd control rate (the replay names each one). `enemy_abilities` in `data/mayhem_rules.json` turns this off. Abilities that heal their caster restore the first flat amount in their tooltip's healing text when cast (39 abilities); heals that only go to allies or only on kills are switched off with `"heal": null` in the overrides. Stacks that only add to one ability use `hit_adds` in the overrides (Nasus Q, 350 stacks). Toggles (`"toggle": true`: Singed Q, Karthus E, Amumu W, Anivia R) stay on whenever an enemy is in their reach, deal their numbers every second without taking a cast, and show in the replay as a ring while switched on; Anivia's storm sits on her target while it stays in range. The champion-by-champion kit review behind most overrides is summarized in each entry's `why`. To rebuild: `python3 tools/build_champion_pool.py` and `python3 tools/build_items.py` (downloads are cached in `~/.cache/deeparam-sim`).

**PBE patch.** Everything defaults to the live patch. `--pbe` on `build_champion_pool.py`, `build_items.py` and `build_augments.py` builds the PBE (test server) patch into `data/pbe/` instead (same hand-written effects and overrides, the Mayhem balance table stays live, augments missing on PBE are left out). `mayhem_sim --game-data data/pbe` runs on it, and the replay's "Change the simulation" panel has a Live/PBE switch that does the same in the browser. The precomputed best builds and replays stay live. `sh tools/refresh_pbe.sh` runs the three builders with `--pbe` and copies the result to `viewer/replay-data/pbe/`, which the browser loads when PBE is picked, so a refresh needs no engine rebuild; the daily PBE check runs it.

## Positions and movement

Fights are played on a 2D lane: x runs along it, y across it (±550 units). You start at the origin and the enemy team 1300 units away, spread 250 apart. Every 0.05 s everyone moves:

- **Abilities have real shapes.** `build_champion_pool.py` reads each ability's targeter from the champion bin (line width and length, circle radius and cast range, cone angle, missile speed) into `geometry`. Abilities cast on yourself with a small radius count as self buffs.
- **You** walk toward your target until your next ability or attack is in range, waiting a moment for an earlier ability in your combo that is almost in range. Ranged champions back away from short-ranged enemies, but not past 1200 units behind the start. If your target is out of reach and another enemy is much closer, you switch.
- **Enemies** hold position, then walk in to 0.85x their own reach (the median range of their basic abilities, between their attack range and 800), strafe sideways, and back off at about half speed when you push them.
- **Skillshots** aim where the target will be, partly leading its movement (`aim_lead`). Each enemy inside the shape when it lands dodges with chance `dodge_chance` if the cast time plus flight time is longer than `reaction_time`, moving sideways out of the way. Instant and on-self abilities can't be dodged.
- **Damage taken** comes only from enemies whose reach you are inside, each in proportion to its share of its team's damage. Without allies the sim would put you in range of everyone far too often, so each champion's total damage taken is anchored to its real CN damage-taken share; positions decide when and from whom it lands. `in_range_damage_boost` scales the rate while in reach. In a team fight the enemies' first spells and attacks are split with your teammates, so their damage on you builds up from nothing to full over `focus_ramp` seconds (3) after they engage; without it squishy melee champions died walking in before landing anything.

Settings: `start_distance`, `enemy_spread` (fight), `dodge_chance` 0.75, `reaction_time` 0.25 s, `aim_lead` 0.5, `hitbox_radius` 65, `lane_half_width` 550 (model). Simulated skillshots land about 74% of the time, and simulated damage taken averages 0.9x the real CN numbers.

## Items and augments

`data/item_effects.json` is hand-written: which items exist, which roles they suit, and their passives as effect keys. `tools/build_items.py` reads each item's name, cost and stats from the game's own item data on the live patch, and the passive numbers the item bin holds (`mDataValues`, with Riot's ARAM and then Mayhem overrides applied) replace the hand-written values; its `BIN_EFFECTS` table lists which effect key comes from which value. It writes `data/items.json`. The remaining passive values (for example Kraken's damage, Titanic's on-hit, Shojin's amp and Sunfire's aura) are tooltip values as best known and should be checked in game. Effect keys:

| Key | Meaning |
|---|---|
| `attack_cdr_pct` | basic abilities' cooldowns drop by this share on each attack |
| `bolts`, `bolts_ad` | extra bolts per attack at this share of AD |
| `execute` | kills targets under this share of max HP |
| `spellblade_*` | next attack after a cast deals base/bonus AD or AP; `spellblade_cd` |
| `storm_every`, `storm_magic` | magic damage every Nth attack |
| `onhit_cur_hp`, `onhit_own_hp`, `onhit_magic(_ap)` | on-hit damage |
| `kraken_*`, `phantom_every` | every-Nth-attack procs |
| `armor_shred`, `cleave_ad` | armor reduction, splash damage |
| `cleaver_shred` | Black Cleaver: armor reduction that builds up over 5 physical hits on each enemy |
| `grievous` | the item applies Grievous Wounds: an enemy carrying it cuts your healing by 40% while it can reach you |
| `tenacity` | shortens crowd control on you (not knock-ups) |
| `healing_received` | more healing from every source (Spirit Visage) |
| `ability_amp`, `ap_amp`, `damage_amp` | damage or AP multipliers |
| `maxhp_proc(_cd)` | max-HP damage proc with a cooldown |
| `burn_*` | damage over time after an ability hits |
| `proc_*`, `active_*` | Luden's-style procs and active items |
| `aura_flat`, `aura_bonus_hp` | Sunfire-style aura damage per second |

Items that share a group in `item_effects.json` (`group`: Last Whisper, Blight, Hydra, Lifeline) can't be in one build, as in the game: `--items` with two of them is an error and the build search skips such pairs. Move speed goes through the game's soft caps (above 415 only 80% counts, above 490 only 50%).

`data/augments.json` has every Mayhem augment in the live patch (216), with Riot's Kiwi ids. 141 of them have an effect in the simulator; the rest carry a `not_modeled` reason (they help allies, change summoner spells, give gold or items, need takedowns or movement, or double champion stacks) and the optimizer skips them. The original 14 augments keep a hand-written mapping in `tools/build_augments.py`; every other augment's effect keys are written in `tools/augment_effects.py`, with values read from the augment spell's DataValues and calculations (`dv`, `calc`, and `lvl` for values that grow from level 1 to 18). Values with no client equivalent stay hand-written with a note: Erosion assumes 15 stacks on average, Tank Engine 10 takedowns, and Witchful Thinking gives 20-80 AP by level as its tooltip shows (its unused DataValue says 70).

Augment effects come in a few families, handled by the engine in `src/champ.cpp`:

| Keys | Meaning |
|---|---|
| plain stats, `*_l1`/`*_l18` | flat stats, or values that scale linearly with level |
| `trig_on` + `trig_*` | a proc on attack, ability, hit, crit, immobilize, dash, timer, kill, shield, channel or damage taken: damage (`trig_flat`, `trig_ap`, `trig_ad`, `trig_max_hp`...), heal (`trig_heal_*`), shield (`trig_shield_*`), CC, with cooldown, every-Nth, per-target and radius options |
| `stack_on` + `stack_*` | stacks gained on an event, each giving AP, AD, attack speed or move speed, with a cap and duration |
| `spell_bind` + `spell_*` | buffs to one ability: the best basic ability by damage per cooldown of the kind named (any, aoe, missile, cc, buff, dash) |
| conversions | `ap_to_ad`, `ad_to_ap`, `crit_per_ap`, `as_per_ap`, `as_to_ah`, `ms_to_as` and similar |
| `revive_*`, `invuln_*`, `start_shield_*` | revives (Hellbent), short invulnerability, a shield at the start of the fight |

`data/augment_pools.json` lists the augments each champion can be offered, made by `tools/build_augment_pools.py` from every augment seen on that champion in the per-champion build stats (95 to 162 each). The optimizer only picks from the champion's own pool, and `--list --json` includes it. **Poro Stampede** (a quest augment) is modeled as already completed with 20 Poros fed: its Poro Charge spell fires 3 waves of Poros down the lane once per fight, each a wide, slow skillshot dealing 100-200 (by level) + 20 per Poro fed as physical damage, half to champions already hit (`poros_fed` in the augment changes the waves; the waves' length, width and spacing are estimates).

## 5v5 teamfights

`--champ Jinx --allies Lulu,Leona,Ahri,Darius` pits your team of five against five enemies (`--team`, default: the five most likely enemies not on your team). Everyone uses their most popular build unless given one (`Name:items=a+b:augs=c+d`; `--items`/`--augs` for yours). Each of the ten champions first plays its own fight against the other team, which gives, fight by fight, its damage per second against them and how much damage it takes before going down (Health, healing and shields). The two teams then trade that damage at once: each side's damage spreads over the other side's champions still standing in the shares each takes of its team's damage in real games (front-liners soak the most), and a champion who goes down stops dealing damage. Both teams' damage is scaled by one factor so the damage everyone takes per second matches its own fight; that sets how long fights last, not who wins. The result is the share of fights your team wins (a fight still going at 120 s counts half), the median fight length, each champion's damage share, time standing and survival, and who goes down when in a median-length fight. Swapping the teams gives exactly the opposite odds. `viewer/team.html` is the page for it (the site's "5v5 teamfight" tab).

## Short against long fights

Every summary reports `dps_short_fight` and `dps_long_fight`: damage per second over the first 6 and the first 20 seconds from the champion's first hit (going down early counts against both). `tools/build_fight_length.py` runs every champion's simulated best build and writes `viewer/replay-data/fight-length.json` with each champion's long-fight edge (its long/short ratio against the median champion's), shown on the site's "Short vs long fights" tab.

## Mode rules

data/mayhem_rules.json holds the mode-wide Mayhem and ARAM rules the engine applies to everyone: crit chance over 100% becomes Adaptive Force (0.75 per 1%, so AP or 0.45 bonus AD), the 5.0 attack speed cap, bonus base health (to 600 melee, 400 ranged at 18) and bonus armor and magic resist (melee), Combo Breaker (each separate immobilize grants 20% more tenacity for 3.25 s, stacking), and the ARAM long-range cut (85% to 70% of damage from enemy champions 1000 to 2000 units away, not damage over time or ultimates). The On Fire! buff is an optional fight setting (`--set on_fire=1`; "Your champion" in the panel's advanced settings).

## Public and admin editions

`viewer/index.html` is the public fight replay: the full settings panel, every mode, the numbers and the Survival leaderboard, with the fight drawn in 2D with champion icons and short synthesized sounds. `viewer/full.html` is the admin edition: the same page plus the 3D models, the game's ability sounds and the preview clips. It is generated from index.html by `python3 tools/make_full_viewer.py` (a test checks it is current). The website serves full.html, `/assets/models/` and `/assets/clips/` to signed-in admins only.

## Modes

Damage is the default measure. `--metric taken|mitigated|healing|cc` (the page's Mode picker) makes the build search rank builds by another per-fight total instead: damage you take (Health lost), damage mitigated (what the enemies threw at you that your Armor, Magic Resist, shields and damage reduction kept off your Health), Health you restore to yourself, or seconds of crowd control you put on enemies (overlapping crowd control on one enemy counts once). Every summary carries all four as `damage_taken`, `damage_mitigated`, `healing` and `cc_seconds`, averaged per fight; the replay shows the chosen one's running total for the fight. For healing, mitigation and crowd control the search also tries the items that keep you alive longest, since those totals grow with time alive.

## Survival leaderboard

After a run on the live patch, the replay page offers *Submit to Survival*. On the Survival board every champion fights the same enemy, Ashe with her most popular build (Teemo for Ashe), with the default settings until it falls. The build (champion, items, augments) goes to `/api/sim-scores` (web/src/app/api/sim-scores/route.ts) and is stored as pending in the `deeparam-sim` D1 database (table `submissions`, one row per build, at most 30 a day per visitor). The damage the browser sends is never shown. `tools/verify_leaderboard.py` takes the pending rows, checks the build is legal (known items, at most 6 with one pair of boots, no repeats, at most 4 augments from the champion's pool), runs it with the native `mayhem_sim` against that enemy and prints SQL that marks it verified with that run's numbers, or rejected. A scheduled job runs it every few hours; after a new live patch, verified rows go through it again. The Simulator page's Survival tab lists the best verified build per champion, and each row links to `/simulator?tab=replays#Champion&items=…&augs=…`, which loads and simulates that build against the same enemy.

## Optimizer

Boots, five legendaries and four augments. Items are searched greedily to pick about 14 candidates, then every five-item combination is screened on a few fights, then augments are added greedily, and the finalists are re-run on 2000 fights. Every build sees the same fights (common random numbers). Only items whose roles fit the champion's class and ability scalings are searched; `--any-items` lifts that. The objective is mean DPS over the whole fight, so dying early counts against a build. Settings live in `data/mayhem_rules.json`.

`--search smart` (used by `make replay` for the published best builds) searches items and augments together. It shortlists 15 items and about 10 augments, screens every five-item set and every four-augment set, then races the best 24 item sets × 12 augment sets, every boots option and the quick search's best builds with successive halving. Each build starts with 250 fights, and the best third go on with three times as many. The last 4 are compared on 20,000 fights. Fights are shared between rounds, so each round only plays new ones. It takes about 3 to 8 times as long as the quick search (Jinx: 80 s instead of 10 s on 4 cores). Settings are in `optimizer.smart`.

## Limits

- Passives, stacking and HP-scaling kits are mostly missing, so fighters and juggernauts (Sett, Sion, Mundo, Mordekaiser, Gwen, Diana) are underrated.
- Supports are compared on damage builds, and tanks build glassy because only damage is optimized.
- Across all champions, simulated DPS correlates only weakly with real CN damage share (Spearman 0.26). Use it to compare builds for one champion, not to rank champions.
- Mystic Punch is picked very often; its value may be too generous.
- For Yunara, `yunara_sim` is the better model.

## Fight replays

`viewer/` animates one simulated fight per champion: you, the enemy you are hitting and the rest of their team, with every cast, attack, damage number, kill and stun drawn as it happens. Everyone stands where the simulation put them, and each ability is drawn at its real size and shape (line, circle or cone); a faint red line marks each enemy whose reach you are inside. The floor is the Howling Abyss itself (the game's minimap art, turned so the bridge is the lane), and Poro Charge waves run down it as rows of Poros. Choosing a champion plays their champion-select pick quote. These three are streamed from CommunityDragon, so they aren't in the repo; a page that can't reach it uses copies in `viewer/replay-data/art/` (`floor.png`, `poro.png`) and `viewer/replay-data/pick/{championId}.ogg` if present. Every fighter is the champion's animated 3D model (three.js), posed from the simulated timeline: each cast plays that ability's animation, attacks and crits play theirs, champions play their run while they walk, and stuns and deaths show too. Models are drawn at the champion's in-game size on the same scale as the floor and ability shapes (the model's own units times its base skin's scale, so Malphite stands taller than Teemo). Enemies fight from the first second, as you do. Clicking an ability, or pressing Q/W/E/R, makes your champion cast it. Enemies open with their recommended combo when they engage and then keep casting their Q, W and E in that order (R once), with the ability's icon above them; each stun on you is shown as an enemy's ability landing. The simulator models enemy damage as a steady rate, so enemy casts are for show and don't change the numbers. A missing animation falls back to the basic attack (Garen has no separate W, for example). Champions without a model fall back to Riot's ability preview clips.

```sh
make replay                          # traces for all champions + icons; clips stream from Riot
make replay CLIPS=--clips            # also store shrunk clips locally (about 50 MB, needs ffmpeg)
make replay MODELS=1                 # also build the 3D models (about 130 MB, needs Node; see below)
cd viewer && python3 -m http.server  # then open http://localhost:8000/#Ahri
./mayhem_sim --champ Jinx --trace jinx.json   # one champion's trace
```

The replay shown is the median-DPS fight out of the first 200 for the best build, so it is a typical fight rather than a lucky one. `--trace` records the same fight the simulator scores (recording never changes the random draws; `make test` checks this). In `viewer/replay-data/`, the simulator's own output is committed so the website can show it: `index.json`, `traces.json`, `best-builds.json` and the WebAssembly engine. The icon atlas, clips and built models are not, because they belong to Riot Games. Without them the viewer loads icons, ability clips, built models, fonts and three.js from the website's own copies under `/assets/` (`web/public/assets/`, kept by `web/scripts/fetch_assets.py`; see the Website thread's asset map). After changing the viewer or its data, bump `REPLAY_VERSION` and the `?v=` tags in `viewer/index.html` so browsers fetch the new files.

**Sounds.** With the models, each cast plays that ability's sound and each death the champion's death sound, yours at full volume and the enemies' quieter; the Sound button turns them off, and browsers only allow sound after the first click or key press. `tools/build_game_sounds.py` (run by `make replay SOUNDS=1`) takes them from a local League install: each champion's Wwise banks name their events after the spell (`Play_sfx_Ahri_AhriQ_OnCast`, `Play_vo_Ahri_Spell3DQCast`, `Play_vo_Ahri_Death3D`), so every slot gets its own sound effect mixed with its voice line. It writes `viewer/replay-data/sounds/sounds.m4a` and `sounds.json` (Riot audio, not committed). It needs `pip install cdtb zstandard xxhash`, `cdtb fetch-hashes` once, and vgmstream-cli to decode the banks; `--dry-run` prints the events chosen for each champion. A few spells whose events don't carry the spell's name are mapped by hand in `EVENT_ALIASES`. Without those files the page uses the website's pack in `/assets/sounds/` (owner-only): `tools/pack_clip_sounds.py` cuts each ability's sound (the `sound` offsets in `index.json`, picked by `tools/build_sounds.py`) from the ability preview clips into one small `sounds.m4a`, so the replay needs no video clips. That pack has no death sounds, and its sound is sometimes the wrong action.

**Models.** `tools/build_models.mjs` keeps the animations the replay uses (idle, attack, crit, Q, W, E, R, stunned, death and the extras below), shrinks textures to 512 px WebP and compresses meshes with meshopt, about 0.4 to 1.7 MB per champion. For now it downloads the exports from modelviewer.lol; they are meant to be replaced with models exported from a local League install. `viewer/clips.js` picks the clips by name (shared by the builder and the viewer): besides the main ones it keeps one idle variation, up to two more versions of each ability and the clip that eases each ability back to idle. The viewer hides the parts the game hides (Teemo's mushroom, Ornn's poro) using the visibility data in those files, and keeps each model on its spot in the arena by ignoring root motion. **Animation.** `tools/build_anim_data.py` reads each champion's animation graph and spell tags from a local League install into `viewer/replay-data/anims.json` (clip names and tags only, committed): an ability plays its clips in the game's order (wind-up, cast, channel loop, hit), successive casts take turns where the game has several (Riven's Q: A, B, C; clicking the ability again plays the next), the idle slips into the champion's idle variations every few loops, and clips blend into each other instead of snapping. Spells tagged `PositiveEffect_MoveBlock` (the champion is carried by the spell) dash the model toward its target and back, and `PositiveEffect_Teleport` blinks it there and back with a flash at both ends; a spell that only sends a shadow (Zed W) doesn't move it. Champions or slots the graph doesn't cover use the name-based picks from `clips.js` instead (the n-th cast plays the n-th version, then its ease-back clip), and their dashes come from the ability descriptions (`dash` in `index.json`).

### Combos

Every champion casts in its recommended combat combo (`data/combos.json`, e.g. Ahri `EQRW`): when several abilities are ready, the one earliest in the combo goes first. The combos are written by hand from common guide combos, so they are approximate. `--combo RWQE` (or the page's Combo field) changes yours; `--set combo_order=0` goes back to strongest ability first.

### Changing the simulation in the page

Under the replay, **Change the simulation** edits the build (boots, five items, four augments), the enemies and the main fight settings (level, fight length, enemy damage, crowd control, dodging; the rest, including the combo, are under **Advanced settings**), then re-runs the simulator in the browser (`make wasm-mayhem`, run in a Web Worker) and replays a typical fight with the new setup. Enemies default to the China-server mix; you can instead pick five champions and change each one's HP, armor, MR and share of their team's damage, or fight training dummies, which default to the average enemy's HP, armor and magic resist (change them under Advanced settings, Training dummy). The same settings work on the command line:

```sh
./mayhem_sim --list --json                       # every setting with its default and the enemy pool
./mayhem_sim --champ Yunara --set level=13,enemy_damage_scale=1.5 \
             --team "Malphite:hp=6000:armor=300,Brand,Sivir,Nami,Trundle"
```
