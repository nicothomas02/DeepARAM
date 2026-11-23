# AramHex match statistics

Since 2026-11-21 (Nico: "base all data on AramHex") the site's numbers come from **AramHex**
([github.com/czgreat/aramhex-data](https://github.com/czgreat/aramhex-data), CC BY-NC 4.0): real game and win counts
from China-server ARAM Mayhem games. 101.qq.com (`data/cn`) stays the backup for what AramHex doesn't have.

License: credit + link on the Info page (`guide/index.html`, `#data-credit`), and **no commercial use** (no ads or
paid features) while we use this data.

| Script | What it does |
|---|---|
| `fetch.py` | Downloads every "normal" dataset into compact `patches/<patch>/*.json` ([games, wins] pairs), and logs notable upstream changes to `changes.json` (new patches, tables, fields, MMR bands, schema or license changes, no release for 5+ days). `--is-new` tells the hourly check whether AramHex published. |
| `merge.py` | Lays the real numbers over the 101 files after each refresh (idempotent). |
| `common.py` | Shared loaders. |

| From AramHex | Kept from 101 |
|---|---|
| Champion win and pick rates (every patch since 16.19), matches per patch | Skill orders |
| Champion × augment games and wins (DeepScore ranks on them) | Starting items |
| Boots, single items, ordered 3-item cores (when the patch has its own) | Six-item builds, boots slot, teammates |
| Summoner spell pairs (real, no longer estimated) | Damage share, kill participation, time dead, daily trends |
| Augment win and pick rates over all champions | Any patch AramHex hasn't published yet |

Methodology notes: AramHex counts augments and items **held at game end**. Items that transform (Tear, Winter's
Approach, Whispering Circlet) and tank items read lower than purchase-based counts, and late-stage augments are held
more often by the winning, higher-level team. Treat win rates as correlated, not causal.

`changes.json`: the daily Website task reports entries with `"reported": false` and flips them to true.
