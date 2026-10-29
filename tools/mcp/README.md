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
| `search(query, limit=8, types=None)` | Fuzzy name search over champions, items and augments in one call: best matches with `type`, `id`, `name`, `score` (and roles / price / rarity) | client `champion-summary.json`, `items.json`, `cherry-augments.json` |
| `project_status(include_done=False, commits=5)` | Open to-dos in Desk order (quickest first, then most important), newest commits, branch, data dates | `tools/mcp/todos.json`, `git log` |
| `desk_todos(sort="desk", include_done=False, project=None)` | The to-dos in Desk order (`desk`: quickest to longest, then most to least important), or by `importance` or `due`; `text` is a one-line-per-item rendering | `tools/mcp/todos.json` |
| `add_todo(title, minutes, importance=3, project=None, due=None)` | Append a to-do (id made from the title); creates the file if missing | writes `tools/mcp/todos.json` |
| `complete_todo(id)` | Mark a to-do done (`done`, `done_at`) | writes `tools/mcp/todos.json` |

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
python3 tools/mcp/dashboard_mcp.py --call search blade
python3 tools/mcp/dashboard_mcp.py --call desk_todos
python3 tools/mcp/dashboard_mcp.py --call add_todo "Write the Chef Special post" 20 4
python3 tools/mcp/dashboard_mcp.py --call complete_todo write-the-chef-special-post
```

Works with mcp 1.x (`FastMCP`) and 2.x (`MCPServer`); `--http` needs `uvicorn`, which the SDK already depends on. Python 3.10+.

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

Restart Claude Desktop; the twelve tools show up under the server name.

### Claude Code

```
claude mcp add deeparam-dashboard -- python3 /absolute/path/to/deeparam/tools/mcp/dashboard_mcp.py
```

### claude.ai custom connector and the Desk artifact

claude.ai connectors and artifacts can only reach a server over HTTPS, not stdio, so run the HTTP mode below
and expose it through a Cloudflare Tunnel. Then add it under Settings > Connectors > Add custom connector with
the tunnel URL plus `/mcp`, and the Desk artifact can call the same tools through Claude.

## HTTP mode (`--http`)

```
python3 tools/mcp/dashboard_mcp.py --http --port 8765 --token "$(openssl rand -hex 24)"
```

serves the same twelve tools over the MCP streamable-HTTP transport at `http://127.0.0.1:8765/mcp`, using the
SDK's built-in Starlette app (`MCPServer.streamable_http_app`) run by `uvicorn`. Every request, including the
first `initialize`, must carry `Authorization: Bearer <token>`; anything else gets `401` before it reaches the
MCP layer (the session id alone is not enough). The token is compared in constant time and can also come from the
`DASHBOARD_TOKEN` environment variable. **The server refuses to start with `--http` and no token** unless you pass
`--insecure-local`, which only ever binds to localhost.

| Option | Default | Use |
| --- | --- | --- |
| `--port` | `8765` | listening port |
| `--host` | `127.0.0.1` | bind address; keep it on localhost and let the tunnel do the exposing |
| `--token` | `$DASHBOARD_TOKEN` | the bearer token clients must send |
| `--allowed-host HOST` | localhost only | extra `Host` header values to accept (the SDK rejects others against DNS rebinding); repeatable |
| `--insecure-local` | off | serve without a token, localhost only; for poking at it with `curl` |

Smoke test:

```
curl -s -X POST http://127.0.0.1:8765/mcp -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

(without the header you get `{"error":"unauthorized"}` and a `WWW-Authenticate: Bearer` header.)

### Pointing a claude.ai custom connector at it through a Cloudflare Tunnel

These are instructions only; nothing in this folder changes the site's Cloudflare config, wrangler files or
secrets, and the tunnel lives in your Cloudflare account, not in the repo.

1. Install `cloudflared` on the box that has the checkout and run the server there, bound to localhost:
   `python3 tools/mcp/dashboard_mcp.py --http --port 8765 --token "$TOKEN" --allowed-host mcp.example.com`
   (`--allowed-host` is the public hostname you will pick in step 2; the tunnel forwards it as the `Host` header).
2. Create a named tunnel and route a hostname to the local port:
   ```
   cloudflared tunnel login
   cloudflared tunnel create deeparam-mcp
   cloudflared tunnel route dns deeparam-mcp mcp.example.com
   cloudflared tunnel run --url http://127.0.0.1:8765 deeparam-mcp
   ```
   For a throwaway test, `cloudflared tunnel --url http://127.0.0.1:8765` prints a random `*.trycloudflare.com`
   URL instead; pass that hostname as `--allowed-host`.
3. Check from outside: the `curl` above against `https://mcp.example.com/mcp` should answer, and the same call
   without the header should get `401`.
4. In claude.ai: Settings > Connectors > Add custom connector. Name it, set the URL to `https://mcp.example.com/mcp`,
   open the advanced settings and set the authentication to a bearer token / `Authorization` header with
   `Bearer <token>` (the exact field name changes between releases; any option that sends a fixed header works).
   Claude.ai does not support pasting the token anywhere visible to other users, so keep the token out of the repo
   and rotate it by restarting the server with a new `--token`.
5. Optional hardening, in order: put Cloudflare Access (service token or your Google login) in front of the
   hostname so the bearer token is the second lock; cap the tunnel with a WAF rate-limit rule; run the server under
   `systemd` with `Restart=on-failure` and a `git pull` timer so the data follows `main`.

Stdio clients (Claude Desktop, Claude Code) keep working unchanged; `--http` is additive.

## Running it remotely (alternatives)

The Tunnel above is the cheapest. The other route that fits the repo is a **Cloudflare Worker**: port the functions
to TypeScript with `@modelcontextprotocol/sdk` (or `agents/mcp`) and read the same JSON from
`raw.githubusercontent.com/.../main/data/cn/...` cached in KV for an hour, so there is no filesystem to sync. Gate it
with Cloudflare Access or an OAuth provider; see `DESIGN.md`. Either way the tool contract stays the one in the table
above, so clients don't change.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `DEEPARAM_REPO` | the checkout this file is in | Read data from another checkout |
| `DASHBOARD_TODOS` | `tools/mcp/todos.json` | Another to-do file (same shape) |
| `DASHBOARD_TOKEN` | unset | Bearer token for `--http` (same as `--token`) |

## To-dos file

`todos.json` is `{"_note": "...", "todos": [...]}` where each to-do is
`{id, title, minutes, importance (1-5), project?, due? (YYYY-MM-DD), done?, done_at?}`. A bare list is accepted too.
`desk_todos` and `project_status` sort open ones by `minutes` ascending then `importance` descending, the Desk's
order, and add `days_left` when `due` is set. `add_todo` and `complete_todo` write the file atomically (temp file
in the same folder, then rename), keep `_note` and the other items untouched, create the file when it is missing,
and refuse to overwrite a file that does not parse. Editing it by hand still works; moving it into the Desk
artifact's own database is on the list.

## Tests

`python3 -m pytest tests/data/test_mcp_server.py -q` calls every tool function directly against the repo's data
(to-do writes go to a temp file), no server started. It is part of the `tests/data` job in CI, where `mcp` is not
installed: the tests that build the server or drive the HTTP app through Starlette's `TestClient` (401 without or
with a wrong token, `tools/list` and a `tools/call` with the right one) are skipped there and run locally when
`mcp` is present. The bearer check itself is a pure function and is tested everywhere.
