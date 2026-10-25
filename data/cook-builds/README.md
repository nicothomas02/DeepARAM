# Cook builds (part of The Lab)

Troll builds for ARAM Mayhem built on strange augment interactions (a hook that applies
on-hit effects, an artillery mage gone melee, champions who swap their range), each checked
against Mayhem win rates and the all-champion damage simulator. The page is the Cook Builds section of The Lab
(`tools/fun/cook-builds/`, on the site at `/tools/lab#cook-builds`); this folder keeps the
hand-written builds and the generator.

| File | What it is |
| --- | --- |
| `builds.json` | The builds, written by hand: champion, title, augments, items, why it's funny, how to play |
| `build_data.py` | Adds augment text and icons, Mayhem stats and simulator numbers, and writes `data.js` |
| `tools/fun/cook-builds/data.js`, `icons/` | Generated; committed so the page works as static files |
| `tools/fun/cook-builds/index.html`, `app.js`, `style.css` | The page (site theme); The Lab's `build_preview.py` bundles it into the Lab preview |

## Rebuilding

```sh
python3 -m pip install xxhash
python3 data/cn/fetch_cn.py                  # Mayhem stats (data/cn/, PR #5)
make -C simulator mayhem_sim                 # optional (simulator/, PR #4)
python3 data/cook-builds/build_data.py --cn data/cn --sim simulator/mayhem_sim
NODE_PATH=$(npm root -g) node data/cook-builds/share_images.js   # link preview images
python3 tools/fun/i18n/build_keys.py         # then translate any new keys (below)
```

Leave out `--sim` to skip the simulator numbers. Augment names, tooltips and icons come from
the live client's Mayhem (KIWI) augment pool on CommunityDragon.

## How a build is scored

- **Tier** is the average Mayhem win rate of the build's core augments (the first `core`
  entries in `augments`; the rest are flex picks): Secretly strong at 55.5% or more, Holds up
  from 51.5%, Pure troll below that. Augment win rates aren't published per champion.
- **Best on** marks augments where the champion is on the best-champion list.
- **Simulator** runs the build's items against the simulator's own top build for that
  champion, both with the top build's augments, since most cook augments (death explosions,
  polymorphs, snowballs) aren't in the simulator. Support items aren't modeled, so supports
  get no simulator number.

## Adding a build

Add an entry to `builds.json` with augment names exactly as the client spells them and item
names as the simulator spells them (`./mayhem_sim --list`), then rerun `build_data.py`.

## Today's Chef Special

A build with a `"chef": "YYYY-MM-DD"` field was the Chef Special that day. The Cook Builds page
features the newest one as Today's Chef Special at the top (`/lab#chefs-special`), with an archive of
every earlier special browsable by date (`/lab#chef-archive`, or `/lab#chefs-special-YYYY-MM-DD` for one
day). Earlier specials also stay in the list with a dated "Chef Special" chip. `build_data.py` also writes
`tools/fun/cook-builds/chef.js`, a small file The Lab's front page reads to name today's special and count
the archive, and `data/cook-builds/chefs-special.json`, which Home reads for its Chef Special card (title,
champion, augments, items, text, icon paths as the site serves them, and the links `/lab#chefs-special`
and `/lab#chef-archive`).

A Chef Special ignores win rate and pick rate, and its card shows no stats or tier. It is a rarely used
build that completely changes what the champion is, built on two or more augments whose text works together
(Tap Dancer's stacking Movement Speed feeding Don't Blink's speed-to-damage, Ethereal Weapon putting on-hit
effects on abilities that Mystic Punch then turns into cooldown refunds, ADAPt and Marksmage trading Attack
Damage for Ability Power and back). The build also has to use a piece of the champion's own kit, even a
minor one, and an item where possible. The model is The Bloodlust Doctor (Nico's pick, 2026-10-17): Tryndamere's
Fury already gives him crit chance, Critical Healing lets his Bloodlust heal crit off it, Circle of Death turns
that healing into damage, and Rite of Ruin and Spirit Visage feed the same loop, so a crit carry becomes an AP
healer whose heals do the killing. A side effect of the kit becomes the champion's main job. A scheduled task
adds a new one every day at 7:50 PM New York, next to the PBE update: it appends one dated build (never
removing or redating earlier ones, so the archive grows), reruns `build_data.py` and merges the PR once
Tests pass.

## Sharing

Every card has a Share button: phones open the share sheet, other devices copy the link. A Chef Special
shares its dated link (`/lab#chefs-special-YYYY-MM-DD`), any other build `/lab#cook-<build id>`, which opens
the Cook Builds page at that card. `share_images.js` draws each build's 1200x630 link preview image
(`tools/fun/cook-builds/share/<build id>.png`, served at `/embed/fun/cook-builds/share/`), with no stats.

## Languages

The Lab shows in the site's language (see web/README.md "Languages"). `tools/fun/i18n.js` reads it, loads
`tools/fun/i18n/<code>.json` (English text to translation) and the site's official champion, item and augment
names, and leaves anything untranslated in English. `tools/fun/i18n/build_keys.py` lists every English string
The Lab shows, build text and augment tooltips included, in `tools/fun/i18n/en.json`; a new build's title, why,
play and augment texts must be added to every language file (`pytest tests/data` checks). `chefs-special.json`
carries today's special's text in every language under `i18n`, with augment and item ids for the names.
