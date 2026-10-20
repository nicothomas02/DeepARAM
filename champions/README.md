# Mayhem Champions

One page per champion at `/champions#Alias` (e.g. `#MonkeyKing`). The nav tab is hidden; pages are reached from the
Tier List, search and the Home champion search. `site-tab.json` still makes sync-embeds copy this folder.

- **Builds** (Mayhem match stats from 101.qq.com, read from `data/cn/builds/{id}.json`, which the My Stats
  thread refreshes daily): most-picked augments by tier with grade,
  starting items, boots, core three-item paths, full builds, most-built items, skill max/level orders and best
  teammates, each with win and pick rate. There are no per-champion augment win rates.
- **Builds by style**: each core path and full build is sorted into a style (Crit, On-hit, AP, Lethality, AD, Tank,
  Enchanter) from its items' shop categories (`item_style`). Each style shows its share of the core paths, pick-weighted
  win rate, core paths, full builds, other finished items of that style the champion builds, and the champion's
  most-picked augments that fit the style. An augment's styles come from its own build tags in `kiwi.bin`
  (`mBuildTags`, a bit field; `BUILD_TAGS`): 512 crit, 64 on-hit, 32 AP, 2 lethality, 16 AD, 256 tank, 8 enchanter.
  Bits 4, 128, 1024 and 2048 don't line up with one style yet and are ignored. Untagged augments fit no style.
  `tags.json` also lists every tagged augment's styles under `augments`, for "fits this build" filters.
- **Crowd control**: each ability's CC (Q, W, E, R) from the champion record's `mAbilitySlotCC`, shown as a chip on the
  ability. The code-to-CC names (`CC_CODES`) were worked out from well-known abilities: 2 blind, 5 fear, 7 knockback,
  8 knock-up, 11 polymorph, 12 pull, 13 silence, 14 slow, 15 root, 16 stun, 17 suppression, 18 taunt. Codes 1, 3, 10
  and 20 aren't named yet. About 55 champions (Annie, Yasuo, Braum...) have no codes in their record, so `tags.json`
  gives `cc` and `hardCC` only for champions that have them; don't treat a missing `cc` as "no crowd control".
- **Mayhem changes**: every ability number Mayhem changes, from each champion's bin
  (`game/data/characters/{alias}/{alias}.bin.json`): `DataValuesModeOverride` (ARAM, then Kiwi on top) and the
  per-mode cooldown override `{f9c2333e}`, compared with the Summoner's Rift values.
- **Abilities**, title, roles, splash and pick quote from `v1/champions/{id}.json`.
- **Tier List stats** from `data/cn/champions.csv`.

Not in the client: per-champion damage dealt/taken, healing, tenacity and ability haste adjustments.

Rebuild: `python3 champions/build_data.py` (live patch, standard library only; writes `data.js`). Build stats change
daily, so the daily routine should rerun it. Page text doesn't mention where data comes from (Nico, 2026-10-16).

## Base stats

Each champion page has a Base stats table (level 1, growth per level and level 18, from the champion's game data).
The site doesn't show skins (Nico, 2026-10-17).

Build stats leave out items that only augments give (quest rewards such as Wooglet's Witchcap or the Golden
Spatula). The list comes from `guide/augment_rules.json`, so run `guide/build_data.py` first after a patch.

## Champion tags

`build_data.py` also writes `tags.json`, for colour-coded tags on the site. For each champion it lists:
- **roles:** the official roles from the game files.
- **classes / subclasses:** Riot's classes and subclasses (Enchanter, Catcher, Juggernaut, Diver, Burst,
  Battlemage, Artillery, Marksman, Assassin, Skirmisher, Vanguard, Warden, Specialist). These are hand-kept in
  `classes.py` because no game file has them. New champions start without one until they're added there.
- **playstyles:** Poke, Engage, Sustain, Shields/Heals and Crowd control, read from ability text and range plus the
  subclass.

`colors` gives one colour per tag, and `meanings` gives a one-line description of each.

## Champion regions

`build_regions.py` writes `regions.json` (`{"regions": [{key, name}], "champions": {alias: [region keys]}}`) from the
League of Legends Universe site's champion index, using the aliases in `tags.json`. Universe gives each champion one
home region; champions without one are under `unaffiliated` ("Runeterra"). The Lab and the Team Builder's region
filter read it.

## Mayhem balance changes

`build_modifiers.py` reads each champion's mode-wide adjustments (damage dealt and taken, healing, shielding,
tenacity, ability haste, attack speed, energy regen) from the official League wiki's ARAM and ARAM: Mayhem pages.
Riot's servers apply these, so no client file has them. The full table, with the page each value came from and the
date it was read, is `data/wiki/mayhem_modifiers.json` (kept out of the published folder so the source never ships);
`mismatches` lists champions whose ARAM page value differs from the Mayhem page's "from" value. The page's "Mayhem
changes" card reads the Mayhem values from `modifiers.js`. Rerun after each patch's wiki update.

## Official roles, difficulty and region

`build_official.py` reads each champion's official roles and difficulty (Low, Medium, High) from Riot's champion
pages into `official.json` (`difficulty` is 1 to 3), for color-coded tags. It also writes `profile.js` (region from
`regions.json`, roles and difficulty), which the champion page shows under the champion's title. Run
`build_regions.py` first. Riot's ability preview videos are on an outside host, so they aren't used.

## Languages

The page follows the site's language like the Info page (`i18n.js`, the same file as `guide/i18n.js`; see the Info
README). Page text is in `i18n/<code>.json` (keys from `python3 guide/i18n_keys.py`). Game text comes from
`python3 champions/build_i18n.py` (after `build_data.py`): `i18n/data/<code>.json` holds champion names, titles and
ability names and text by alias and slot, and item and augment names by id, from each language's Data Dragon
`championFull.json` and the client's item and augment lists. Only text that differs from English is kept. The Thai and
Indonesian clients keep item and augment names in English, so those files are small.
