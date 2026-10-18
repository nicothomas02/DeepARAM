# Temporary fill: summoner spells and game counts

**Temporary.** Tencent's open Mayhem feeds (`data/cn/`) have no summoner spells and no
game counts. Nico allowed (2026-10-18) filling only those two from ARAMKit
(`data.aramkit.com`, China-server games, the same player base as `data/cn/`) until a
direct Tencent source is found. Nothing else from ARAMKit is used.

- `config.json`: `"enabled": false` switches it off everywhere: the fetch does nothing
  and the site ignores `spells_games.json` even if it exists.
- `fetch_fill.py`: daily (`.github/workflows/fill.yml`). Reads `versions.json` first and
  stops if ARAMKit hasn't published a new build; waits 2 s between requests.
- `spells_games.json`: per champion, its game count and its top spell pairs.
- Site side: `web/src/lib/fill.ts`. Shown only when the file's patch is the live patch.

ARAMKit's terms (aramkit.com/en-US/terms, 2026-09-23) allow "personal, non-commercial
reference" and bar bulk scraping and copying their data product, so it ships switched off
until Nico decides.

**To remove:** delete `data/fill/`, `.github/workflows/fill.yml` and `web/src/lib/fill.ts`,
then drop the `fill` imports the type check flags (champion page, tier list).
