# Mayhem Info

The site's **Info** tab (formerly Guide) (`/tools/guide`): how ARAM Mayhem works, read from the League client's own files.

- **What is Mayhem**: the mode's tutorial art, augment pool size by tier, and the Mayhem queue IDs.
- **Quests**: all 12 quest augments with every milestone and its reward (`ModesQuestData` in kiwi.bin).
- **Challenges**: the permanent ARAM challenges with every tier threshold, marked by whether they count Mayhem
  games (queue 2400 in `queueIds`). The page doesn't look up players (Nico, 2026-10-17).
- **Rules**: Mayhem's mode-wide settings from map12.bin (`Kiwi_Balance`, `Kiwi_OnFireBuff`, `Kiwi_ComboBreaker`,
  `ARAM_Augment_Manager`) and augments that add a summoner spell. Gold and XP (`economy()`: the KIWI mode's
  `mGameModeConstants` ambient gold and XP, its bounty config, `mExperienceCurveData` and `mExperienceModData`; also
  in `mode_rules.json` for the Simulator) and surrender timing (`surrender()`, `mSurrenderSettings`; type 0 is the
  remake vote; vote shares aren't shown until they're checked in a game). Minion wave timing isn't shown: map12.bin
  has ten barracks configs and nothing in it says which one Mayhem uses.
- **Augment stages**: also the fallback augments (the KIWI config with the `{857c9848}` lists): what a selection
  offers when its rarity runs out. A list leaves out `rarity` when it's Gold (the default).
- **Quests**: also champion rivalries (`CharacterQuestListConfig` in the KIWI configs, names and goals from
  `quests_*` strings). Rewards are hidden spells, so they aren't described. The newer `CharacterQuestDefinitionsList`
  in the same config isn't shown until it's confirmed to run in Mayhem.
- **Items**: items whose `DataValuesModeOverride` (Kiwi, else ARAM) differs from Summoner's Rift, from items.cdtb.bin.
- **Extras**: Mayhem-only items and Mayhem-only units.

The page no longer shows queue ids, map skins, the summoner spell list, Augment history or the Archive (Nico,
2026-10-17); `data.js` still carries that data. `history.js` (every augment change from patch 16.2 to the live patch,
built by `build_history.py` from CommunityDragon's per-patch folders, never PBE) isn't loaded by the page any more:
the site's Patch Recaps read it (web/src/lib/patches.ts), so keep building it.

Rebuild after a patch: `python3 -m pip install xxhash && python3 guide/build_data.py && python3 guide/build_history.py`
(writes `data.js` and `history.js`; both read the live patch). Page text doesn't mention where data comes from (Nico, 2026-10-16).
Images load from CommunityDragon at view time. `site-tab.json` makes this folder a site tab.

## Augment stages and augment-granted items

`build_data.py` also writes `augment_rules.json` (and `augmentRules` in `data.js`): the four augment levels, cards per
selection and rerolls per slot, the pool size and offer odds per rarity, every live augment's rarity, and
`grantedItems`, the items live augments hand out. `how: "reward"` items can't be bought (leave them out of build
stats); `how: "free"` items are given at once but are also sold. The Info page shows these on the Augment stages
and Items tabs.

It also lists `selectionAugments` (live augments that add an augment or rerolls, such as King Me) and the
`goldenReroll` reward text.

## Mayhem progression track

`build_track()` reads the newest `kMayhem` season pass from `v1/event-hub.json` (name, dates, level count from its
chapters) and takes that many entries from the end of the Mayhem block in `v1/rewards.json`, which lists every track's
rewards in level order. Each level becomes an augment (matched by icon to kiwi.bin), emote, icon, title or other
reward. `data.js` has the track as `track`; `augment_rules.json` has `unlocks` (augment id to track level) for the
augment pages. If the reward list stops lining up with the track, the track is left out rather than guessed.

## Augment details (for augment pages)

`augment_details.json`: every live augment by id with `text` (short description) and `tooltip` (full tooltip), both
filled with the augment's own numbers; sentences whose numbers the client doesn't hold are dropped. `grants` lists
keystone runes or abilities it gives (e.g. Symphony of War: Lethal Tempo, Conqueror), `values` its raw DataValues,
and `unlockLevel` its progression-track level (null if it isn't on the track).

## Mode rules (attack speed cap, crits, runes)

`build_data.py` writes `mode_rules.json` for the Simulator and the site:
- `attackSpeedCap`: 1 / `gcd_AttackMinDelay` in the KIWI mode's GameModeConstants (map12.bin); `aramAttackSpeedCap`
  is the same for regular ARAM.
- `critOverflow`: `"adaptive"` when the Mayhemic Magic buff text (`buff_desc_MayhemicMagic`) says excess crit
  chance turns into Adaptive Force. The conversion ratio isn't in the client files (see `critConversion` below).
- `runes`: false when the KIWI constants set `SuppressRunesMasteriesPerks` (no rune page in Mayhem).
- `aura`: the Mayhemic Magic buff's lines. `keystoneAugments`: augment id to the keystones it grants.

It also holds the mode's mechanics (`mechanics()` in `build_data.py`), which the Rules tab shows too:
- From map12.bin: `respawn` (seconds by level from `mDeathTimes`, plus the late-game growth), `longRange.range` and
  `reductionMin` (`ARAMGamePacingScriptData` poke reduction), `structures` (late bonus damage to structures and the
  times it ramps between), `minions` (area damage to minions; Blackout's trap reveal range and time from
  `ARAMMinionTrapDetectionScriptData`), the relic beam (`HowlingAbyssRelicAura_AOE`, with its Mayhem override) and
  `portalSpeed` (`Bloom_Hexgate_SpeedBuff`).
- From the official League wiki (`WIKI_MECHANICS`, read 2026-10-17; Nico allowed it): `startLevel`,
  `longRange.reductionMax` and what it excludes, `critConversion` (AD and AP per 1% crit over 100%), relic pickup heal
  and spawn times, and each map's fast travel. Update them when the wiki's pages change.

The Rules tab shows these, plus a Champion select card (no rune page, keystone augments, summoner spells regular
ARAM allows but Mayhem doesn't). Per-champion damage, healing and shielding adjustments are applied server-side and
aren't in any client file.

## Augment groups by icon

`augment_groups.py` (needs Pillow and numpy) clusters the live augments by how their icon glyph looks. It names each
group after its glyph, from the hand-kept `GLYPHS` map. It then lists what most members share: rarity, build style,
stat or effect words, and the win-rate range. It writes `augment_groups.json`. Run it after `build_data.py`.

## Official track details and the mode's story

`OFFICIAL_TRACK` in `build_data.py` adds what Riot's support article gives for the live 32-level track: XP per level,
reward names the client leaves blank, notes on the reward-only levels, how Mayhem XP is earned and the guaranteed-offer
rule. It's applied only while the track has 32 levels; update it with each new set. `STORY` is a short history of the
mode written from Riot's /dev posts and dev updates (What is Mayhem tab). Neither names its source on the page.

## Official game constants

`build_constants.py` writes `game_constants.json` from Riot's developer constants in `data/constants/` (run `data/constants/update.py` first): the public Mayhem queue id
(`mayhemQueue`), the live ARAM-map queues, the ARAM map ids and the ARAM game modes. `build_data.py` takes the Mayhem
queue id from it. Rerun when Riot adds a queue.

## Languages

The page follows the site's language (the parent page's `<html data-lang>`, else `localStorage["deeparam-lang"]`) and
reloads when it changes. `i18n.js` (the same file is in `champions/`) loads two files before `app.js` renders:
- `i18n/<code>.json`: page text keyed by its English wording. `python3 guide/i18n_keys.py` rewrites `en.json` (for
  this folder and `champions/`) from the `data-t` elements in `index.html`, the `t("...")` calls and labels in
  `app.js`, the hand-written text in `build_data.py` and the value names in the data; every other language maps the
  same keys. Add a new string to every language file in the same change (tests/data/test_data_i18n.py checks).
- `i18n/data/<code>.json`: the game text in that language, merged into `GUIDE_DATA` by the page. `python3 guide/build_data.py --languages` builds the page once per client language
  and keeps what differs from English at text keys (`overlay()`; list items are matched by id, key or icon). It also
  writes `i18n/augments/<code>.json`: each live augment's name, text and tooltip, for the site's augment pages.
Rerun both after a patch, with `champions/build_i18n.py`.
