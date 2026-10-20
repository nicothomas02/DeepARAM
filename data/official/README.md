# Official Riot sources (repo only)

Files here keep their source links, so they live outside the published folders. Pages that use them show the content
without naming where it came from.

## patch_notes.json

The ARAM: Mayhem section of every 2026 patch's official patch notes (26.1 to the live patch), read 2026-10-17:
`{read, patches: [{patch, gameVersion, url, date, noMayhemSection, champions: [{name, changes}], augments, items,
systems, bugfixes, aram, intro}]}`, newest first. Change lines are Riot's own ("Damage Dealt: 95% ⇒ 100%"); mid-patch
updates are tagged "(mid-patch update)"; `aram` holds plain-ARAM changes printed in the same notes. 26.2 has only bug
fixes. A few entries were tidied by hand where the page's layout didn't parse (26.3 Augment Sets, 26.12 new and removed
augments). Use it for the Patch Recaps pages and to check `data/wiki/mayhem_modifiers.json`: on 2026-10-17 every
champion stat value the notes set agreed with the wiki table.

Add each new patch's section after its notes go live.

## Champion and augment tags (written by champions/build_data.py)

The same game data as `champions/tags.json`, in the shape and names the site reads:
- `augment-build-tags.json`: `{augment id: [styles]}` from each augment's `mBuildTags` (crit, attack_speed, ap, pen,
  fighter, tank, support).
- `champion-cc.json`: `{alias: {slots: {Q, W, E, R: cc or null}, hard}}` from `mAbilitySlotCC`. Champions whose
  record has no codes (about 55) are left out: unknown, not "no CC".
- `champion-metadata.json`: `{alias: {tags: [Riot's two playstyle tags], playstyle: {damage, toughness, control,
  mobility, utility}}}` (1 to 3) from `championMetadata`. No difficulty: its 1–10 field's meaning isn't confirmed.
- `champion-tag-names.json`: the official tag names in the other site languages, by site language code
  (`python3 champions/build_i18n.py --tags`).
