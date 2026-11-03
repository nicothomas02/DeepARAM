# DeepARAM

The code behind [deeparam.com](https://deeparam.com): ARAM Mayhem tier lists, a damage simulator, PBE changes, and the apps.

## What's where

| Folder | What it holds |
| --- | --- |
| `web/` | The website (see [web/README.md](web/README.md)). Deploys from `main`. |
| `simulator/` | The damage simulator and its fight replay viewer ([README](simulator/README.md)) |
| `data/cn/` | Mayhem stats feeding the Tier List ([README](data/cn/README.md)) |
| `data/pbe/`, `tools/datamine/` | PBE changes and the client-file tools behind them ([README](data/pbe/README.md), [README](tools/datamine/README.md)) |
| `guide/` | The Info page: Mayhem rules, items, maps and augment history ([README](guide/README.md)) |
| `champions/` | Per-champion pages ([README](champions/README.md)) |
| `tools/fun/`, `data/cook-builds/` | The Lab's tools and cook builds ([README](data/cook-builds/README.md)) |
| `dashboard/`, `importer/` | My Stats: the personal stats page and the League client importer (below) |
| `apps/` | iPhone/iPad and Mac apps ([iOS](apps/ios/README.md), [iPad](apps/ipados/README.md), [macOS](apps/macos/README.md)) |
| `analysis/` | Notebook write-ups on the Mayhem data: win-rate persistence across patches ([README](analysis/win-rate-persistence/README.md)) |

A folder with a `site-tab.json` is embedded into the site by `web/scripts/sync-embeds.mjs`.

## Stats dashboard

`dashboard/` is a static page that reads a Mayhem match archive (`mayhem-backup.json`,
the format the mayhem-archive scraper writes) and shows win rate, KDA, damage,
win rate by month, champion and augment tables, and recent games. Filters cover
queue, date range and champion.

Open `dashboard/index.html` and drop the archive on it. The file is read in the
browser and never uploaded. To load it automatically, put it at
`dashboard/data/mayhem-backup.json` (git-ignored) and serve the folder:

```
cd dashboard && python3 -m http.server
```

Champion and augment names come from Data Dragon and CommunityDragon; without
network access the page shows ids instead.

## Importing match history (macOS)

`importer/mayhem_import.py` pulls your ARAM Mayhem games from the League client
into a JSON archive the dashboard reads. It uses only macOS's built-in `python3`
and `curl`. Start League, sign in, then double-click
`importer/Import Mayhem Games.command`, or run:

```
python3 importer/mayhem_import.py -o ~/Downloads/mayhem-backup.json
```

It gets match ids from Riot's match-history service (the one the client itself
uses, as in [mayhem-tracker](https://github.com/Yhprum/mayhem-tracker)) and
fetches each game through the client. Riot only serves an account's last 1000
matches across all queues, so older games can't be downloaded. The script merges
into an existing archive and never removes games, so pointing it at your current
backup keeps everything you already have. `--full` rechecks every game Riot still
serves to fill gaps.

### Sync button

To keep the dashboard current without running the import by hand, start League,
then double-click `importer/Open Mayhem Stats.command`, or run:

```
python3 importer/mayhem_import.py --serve -o ~/Downloads/mayhem-backup.json
```

This opens the dashboard at `http://127.0.0.1:8787/` with a **Sync from League**
button. Pressing it pulls any new games from the client into the archive and
redraws the page. The helper only listens on your own computer and refuses
requests from other sites. Close the Terminal window to stop it.
