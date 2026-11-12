# Traps and Bug finder

The Kitchen's **Traps** tab (`/kitchen?tab=traps`) lists builds that work on paper but not in real games; the
**Bug finder** tab (`/kitchen?tab=bug-finder`) lists interactions that might be broken, each with how to test it
in a game. Both read `findings.json`, which `findings.py` writes (daily, in `fill.yml`).

| File | What it is |
| --- | --- |
| `findings.py` | The checks: stat loops, augments a popular champion never gets, Simulator favourites that lose in real games, Mana augments on champions without Mana, and Kitchen builds whose augments may not be offered |
| `curated.json` | Hand-written: what happened when a finding was tried in game (`trap`, `bug` or `fine`), plus whole findings written by hand (Tickle Monster Jhin) |
| `check_build.py` | The pre-post check for Chef Specials, synergy finder picks and community builds |
| `findings.json` | Generated |

```sh
python3 data/checks/findings.py
python3 data/checks/check_build.py Jhin "Tickle Monster"      # one build; exit 1 when something blocks
python3 data/checks/check_build.py --chef                      # today's Chef Special
python3 data/checks/check_build.py --kitchen                   # every Kitchen build
```

## Before posting a build

Run `check_build.py` on every new Chef Special and every synergy the synergy finder would publish. **block**
means don't post it as is: an augment the champion has never been seen taking (or one that's ranged-only or
melee-only on the wrong champion), an augment not in Mayhem this patch, or a combo already on the Traps list.
**warn** means post only after looking: a stat loop nobody has tested in game, an augment with no stats yet this
patch, or an item the Simulator likes that loses in real games.

## Moving a finding

When someone tries a Bug finder entry in game, add its id to `curated.json` with what happened:
`"status": "trap"` moves it to Traps (put the in-game result in `practice`), `"bug"` marks it a confirmed bug
worth reporting to Riot, `"fine"` hides it.

"Never seen taking" comes from the per-champion augment stats, which list every augment players took on that
champion this patch. It is strong evidence, not proof: a very rare pick can be missing too.
