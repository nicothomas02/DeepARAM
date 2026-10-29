# Dashboard MCP server

A small [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes this repo's ARAM: Mayhem data
and Nico's Desk to-dos as tools, so Claude (Desktop, claude.ai, Claude Code) and the Desk dashboard can ask
"what's Teemo's win rate", "best build for Jhin" or "what's open on the project" and get compact JSON back.

Everything is read from the committed files in this checkout: no network, no League client, no secrets.
The numbers are as fresh as the last `Update Mayhem stats` / PBE commit on the branch you run it from.

## Tools

| Tool | What it answers | Reads |
| --- | --- | --- |
| `champion_stats(champion)` | Win/pick rate, rank, damage and tank share, kill participation, best partners, most-picked augments, simulator damage profile | `data/cn/champions.json`, `simulator/viewer/replay-data/best-builds.json` |
| `tier_list(role=None, metric="win_rate", top=10, ascending=False)` | Top champions by `win_rate`, `pick_rate`, `damage_share`, `tank_share`, `kill_participation` or `avg_death_time`, optionally for one client role | `data/cn/champions.json` |
| `best_build(champion)` | Starting items, boots, core, full builds, skill order, top augments per tier, partners, and the simulator's best build | `data/cn/builds/<id>.json`, `best-builds.json` |
| `augment_stats(augment)` | Tier, win and pick rate with ranks and rank changes, best champions | `data/cn/augments.json` |
| `best_duos(champion=None, top=10)` | Best champion pairs by win rate, optionally only pairs with one champion | `data/cn/duos.json` |
| `champion_trend(champion, patches=4)` | Whole-patch win/pick rate over the last N patches and the change | `data/cn/history/by_patch.json` |
| `patch_changes(latest=True, champion=None, source="pbe")` | `pbe`: PBE vs live changes from the tracker. `live`: the Mayhem section of the official patch notes | `data/pbe/tracker.json`, `data/official/patch_notes.json` |
| `project_status(include_done=False, commits=5)` | Open to-dos in Desk order (quickest first, then most important), newest commits, branch, data dates | `tools/mcp/todos.json`, `git log` |

Champion and augment names are fuzzy-matched (`teeemo`, `kai sa`, `master yi`, `blunt`, ids all work). An unknown
or ambiguous name returns `{"error": ..., "suggestions": [...]}` instead of raising. Rates are percentages.
Champion, item and augment names come from the client files under `web/public/assets/cd/latest/`.

## Install and run

```
pip install -r tools/mcp/requirements.txt      # just `mcp`; add --break-system-packages on Debian/Ubuntu pythons
python3 tools/mcp/dashboard_mcp.py             # serves MCP over stdio, waits for a client
```

Quick check without a client:

```
python3 tools/mcp/dashboard_mcp.py --call champion_stats Teemo
python3 tools/mcp/dashboard_mcp.py --call tier_list mage damage_share 5
python3 tools/mcp/dashboard_mcp.py --call project_status
```

Works with mcp 1.x (`FastMCP`) and 2.x (`MCPServer`). Python 3.10+.

### Claude Desktop (stdio)

Add to `claude_desktop_config.json` (Settings > Developer > Edit Config), with the absolute path of your checkout:

```json
{
  "mcpServers": {
    "deeparam-dashboard": {
      "command": "python3",
      "args": ["/absolute/path/to/deeparam/tools/mcp/dashboard_mcp.py"]
    }
  }
}
```

Restart Claude Desktop; the eight tools show up under the server name.

### Claude Code

```
claude mcp add deeparam-dashboard -- python3 /absolute/path/to/deeparam/tools/mcp/dashboard_mcp.py
```

### claude.ai custom connector and the Desk artifact

claude.ai connectors and artifacts can only reach a server over HTTPS, not stdio, so the server has to be hosted
first (next section). Once it has a URL, add it under Settings > Connectors > Add custom connector with that URL,
and the Desk artifact can call the same tools through Claude.

## Running it remotely (later)

Nothing in this folder touches the site's Cloudflare config, wrangler files or secrets; that stays a separate step.
Two ways that fit the repo, cheapest first:

1. **Tiny HTTP wrapper on a box you own.** The SDK already ships the transport: `build_server().run(transport="streamable-http")`
   serves `/mcp` on localhost. Put it behind a reverse proxy with TLS (Caddy, or a `cloudflared` tunnel) and a bearer
   token, and point the connector at it. The server reads the checkout on disk, so a `git pull` cron keeps the data fresh.
2. **Cloudflare Worker.** Port the eight functions to TypeScript with `@modelcontextprotocol/sdk` (or `agents/mcp`) and
   read the same JSON from GitHub (`raw.githubusercontent.com/.../main/data/cn/champions.json`, cached in KV for
   an hour) so there is no filesystem to sync. Gate it with Cloudflare Access or an OAuth provider; see `DESIGN.md`.

Either way the tool contract stays the one in the table above, so clients don't change.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `DEEPARAM_REPO` | the checkout this file is in | Read data from another checkout |
| `DASHBOARD_TODOS` | `tools/mcp/todos.json` | Another to-do file (same shape) |

## To-dos file

`todos.json` is a list of `{id, title, minutes, importance (1-5), project, due (YYYY-MM-DD), done}`.
`project_status` sorts open ones by `minutes` ascending then `importance` descending, the Desk's order, and adds
`days_left` when `due` is set. Edit it by hand for now; moving it into the Desk artifact's own database is on the list.

## Tests

`python3 -m pytest tests/data/test_mcp_server.py -q` calls every tool function directly against the repo's data,
no server started. It is part of the `tests/data` job in CI, where `mcp` is not installed: the one test that
builds the server is skipped there and runs locally when `mcp` is present.
