# Mayhem stats (101.qq.com)

`fetch_cn.py` pulls ARAM Mayhem (海克斯大乱斗) stats from the
backend behind Tencent's official strategy site, [101.qq.com](https://101.qq.com/).
No login is needed. Python 3 standard library only.

```
python3 data/cn/fetch_cn.py            # newest day
python3 data/cn/fetch_cn.py --date 20261014
```

| File | What it holds |
| --- | --- |
| `champions.json` / `.csv` | Per champion: rank, win rate, pick rate, rank change, damage/tank share, kill participation, avg time dead, best partners |
| `augments.json` / `.csv` | Per augment: win rate, pick rate, ranks, tier, best champions |
| `duos.json` | Top 2,000 champion pairs by win rate and pick rate |
| `raw/` (git-ignored) | Untouched API responses |

Endpoints (all on `https://mlol.qt.qq.com/go/battle_info/odp_proxy/`):

- `fuwen_aram_hero_rank_v2?dtstatdate=YYYYMMDD` champions (daily; yesterday is newest)
- `fuwen_aram_rune_rank_v2?augmentid_level=255` augments
- `fuwen_aram_hero_parttner?role1=255&role2=255&championid=255` duos

Names come from `game.gtimg.cn` (`hero_list.js`, `kiwi/kiwi_augments.json`).

## Full history

`history.py` downloads champion stats for every day since 2025-11-02, the earliest
date the API returns, and builds patch and all-time tables in `history/`:

| File | What it holds |
| --- | --- |
| `daily/YYYY-MM.csv` | Every day's champion stats; the script only fetches days not already here |
| `patches.csv` | Each patch's data window (15.21 to now) |
| `by_patch.csv` | Each champion's whole-patch numbers |
| `by_patch.json` | The same per patch for the site, with each champion's `weight` (estimated games) and `live` on the newest patch. Combine any set of patches: win rate and `avg_*` averaged by weight, pick rate by patch `days` |
| `all_time.csv` | Each champion across every patch |
| `by_month.csv` | Each champion per calendar month |
| `augments/`, `duos/` | One file per day, written by `fetch_cn.py`; starts 2026-10-15 |

Each day's numbers are cumulative since the current patch's window opened, and they
reset when the next patch's window opens. The script finds those resets as jumps near
each release date from Tencent's `versionlist`. The last day of each window is used as
that patch's full sample. Augments and duos have no history in the API, so `fetch_cn.py` saves one file per day
from now on.

`all_time.csv` combines patches by estimated games. Pick rate is a share of games, so a
champion's games in a patch are estimated as pick rate × window days, which assumes
about the same number of games each day. `est_game_share` is the champion's share of all
champion slots.

## Augment tiers and augments with no data

`augments.json` takes each augment's tier and key from the live game client (`kiwi.bin` rarity:
0 Silver, 1 Gold, 2 Prismatic), falling back to Tencent's list if the client files can't be
reached. Its `no_data` list holds live Mayhem augments that have no stats yet (`augment_id`, `key`,
`name`, `tier`), so pages can show them as "no data yet". In `builds/`, item 3097 is mapped to
3095 (Stormrazor's id in the client).

## Champion builds

`builds.py` fetches each champion's Mayhem build page data (`fuwen_hero_rank?championid=N`)
and writes `builds/<champion_id>.json`, plus `builds/index.json` listing them. The API only
serves the newest day, so the daily run overwrites these files. Rates are fractions (0.52 = 52%).

| Key | What it holds |
| --- | --- |
| `augments.all/silver/gold/prismatic` | Most picked augments: `id`, `pick_rate`, `grade` (S/A/B). No win rate is published here |
| `skills[]` | Skill max orders (`max_order` like Q,E,W) with `pick_rate`, `win_rate`, and `orders[]`: the common level 1 to 15 sequences |
| `items.starting`, `items.boots` | Starting items and boots: `items` (ids), `pick_rate`, `win_rate` |
| `items.core` | Three-item cores |
| `items.other` | Other finished items, one each |
| `items.full_builds` | Most common six-item builds |
| `partners[]` | Best teammates: `id`, `win_rate`, `pick_rate` |

Mayhem has no rune pages, and this endpoint has no summoner spell data.

## Filtering by patch, month or dates

`history/by_patch.csv` and `history/by_month.csv` are ready-made splits. For anything
else, `query.py` works offline from `history/`:

```
python3 data/cn/query.py --patch 16.19                  # one patch
python3 data/cn/query.py --patch 16.18 --patch 16.19    # several patches combined
python3 data/cn/query.py --month 2026-09
python3 data/cn/query.py --from 2026-09-01 --to 2026-09-14
python3 data/cn/query.py --out sept.csv --month 2026-09
```

A whole patch is exactly Tencent's own final numbers. A date range that cuts through a
patch is the difference between the running totals at its end and the day before its
start, using the same games estimate as above, so short ranges (a day or two) are rougher
than whole patches. 15.21 started before the API's first day (2025-11-02), so a range
that starts in early November 2025 counts from 15.21's release on 2025-10-23. That's why
November 2025 shows 39 days in `by_month.csv`.

The `Mayhem stats` GitHub Action checks every hour (`newest.py`) whether Tencent has published the previous Beijing
day yet, and runs both scripts and commits the new data as soon as it has (about once a day). Each run notes when
the day first appeared in `history/published.csv`, which shows when Tencent publishes.

Caveats: the API is undocumented and can change without notice. Rates are fractions
(0.5575 = 55.75%). The champion `rank` is Tencent's own ordering, not sorted by win
rate. Sample sizes are not published.
