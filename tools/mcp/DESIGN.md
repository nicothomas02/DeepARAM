# Dashboard MCP server: design

## Goals

1. Let Claude answer questions about DeepARAM's data (Mayhem stats, builds, augments, patch changes) from the
   committed files, with no scraping and no second copy of the numbers.
2. Give Nico's Desk, the personal dashboard artifact, a project view: what is open, what shipped, how fresh the
   data is, ranked the way the Desk ranks everything (quickest to longest, then most to least important).
3. Stay small and testable. Each tool is a plain Python function returning a dict; the MCP layer is one
   `build_server()` call. Tests call the functions directly, so CI needs only pytest.
4. Be forgiving at the edges. Champion and augment names are fuzzy-matched, unknown names return suggestions, and
   every answer carries the stat date so the model can say how old the numbers are.

Non-goals for this draft: writing repo data (the to-do file is the one exception), touching the website or
Cloudflare config, replacing the site's own pages.

## Tools

`champion_stats`, `tier_list`, `best_build`, `augment_stats`, `best_duos`, `champion_trend`, `patch_changes`,
`search`, `project_status`, `desk_todos`, `add_todo`, `complete_todo`. The README has the signatures. They were chosen because the repo already keeps clean JSON for
each; nothing is derived that the site doesn't also derive. Two candidates were left out: per-augment win rates by
champion (the Tencent build pages publish pick rate and grade only) and summoner spells (no Mayhem source).

## Data sources

| Source | Updated by | Used for |
| --- | --- | --- |
| `data/cn/champions.json`, `augments.json`, `duos.json` | `Mayhem stats` Action, about daily | stats, tier list, augments, duos |
| `data/cn/builds/<id>.json` | same Action (`builds.py`) | best build |
| `data/cn/history/by_patch.json` | `history.py` | trend |
| `simulator/viewer/replay-data/best-builds.json` | simulator runs | damage profile, simulator build |
| `data/pbe/tracker.json` | `tools/datamine/tracker.py` | PBE changes |
| `data/official/patch_notes.json` | manual read of patch notes | live changes |
| `web/public/assets/cd/latest/.../champion-summary.json`, `items.json`, `cherry-augments.json` | client sync | names and roles |
| `tools/mcp/todos.json` | by hand | Desk to-dos |

The champion summary contains mode variants (`Jade_*`, ids 60001+) with the same display names as real champions;
the index keeps the lowest id per name and skips `Jade_` aliases. Rates are stored as fractions and returned as
percentages rounded to one decimal, which is what the site shows.

## Auth for a remote version

Stdio needs no auth: the client spawns the process. A hosted version does, because claude.ai connectors and the Desk
artifact can only reach HTTPS. The data is public already (it is in a public repo), so the risk is cost and abuse,
not leakage, and the to-do list is the one private part.

- **Transport**: the SDK's streamable HTTP (`/mcp`) behind TLS. No SSE.
- **First step (done)**: `--http --token` wraps the SDK's Starlette app in a tiny ASGI middleware that requires
  `Authorization: Bearer <token>` on every request (constant-time compare, 401 otherwise) and refuses to start
  without a token unless `--insecure-local`. The token is passed on the command line or `DASHBOARD_TOKEN`, never
  stored in the repo. Enough for a single user behind a Cloudflare Tunnel; the README has the steps.
- **Proper step**: MCP's OAuth 2.1 flow with the SDK's `token_verifier` (Cloudflare Access, or a Worker on
  `workers-oauth-provider`), so claude.ai can connect as a custom connector without pasting tokens.
- **Scopes**: read-only tools need none. If to-dos become writable, split a `todos:write` scope and keep the
  stats tools open.
- **Rate and size limits**: cap `top` and reject bodies over a few KB; cache the JSON reads for an hour.
- **Freshness**: the Worker reads from `raw.githubusercontent.com` on `main`, so it follows the data Actions with no
  deploy step.

## Done since the first draft

- `--http` mode over the SDK's streamable HTTP with a bearer-token gate, `--allowed-host` for the tunnel hostname,
  README instructions for a Cloudflare Tunnel + claude.ai custom connector (instructions only, no config in the repo).
- To-dos are writable: `desk_todos` (Desk order, plus `importance` / `due` sorts, compact text), `add_todo`,
  `complete_todo`, atomic writes, tolerant of a missing file. This is the first half of next step 1.
- `search` over champions, items and augments in one call.

## Next steps

1. **Desk hook-up.** Have the Desk artifact call `project_status` on load and render the to-dos in its own order,
   with `days_left` turning into the urgency colour. Move `todos.json` into the artifact's database so the Desk can
   write and the server reads.
2. **Calendar-aware ranking.** Add `due` and free-time inputs: pull the day's free slots from Google Calendar (the
   connector exists) and promote to-dos that fit the next free slot. The sort key becomes
   `(fits_next_slot, minutes, -importance)`.
3. **Sleeper fantasy tools.** `sleeper_matchup(week)`, `sleeper_waivers(position)` from Sleeper's public API
   (no auth for league reads), so the Desk shows the week's lineup next to the Mayhem tier list.
4. **Watch tools.** `champion_movers(days=7)` from `history/daily/*.csv`, and `data_freshness()` that flags when the
   Tencent feed is late (`history/published.csv`), useful for the daily Action's health line on the Desk.
5. **Resources and prompts.** Expose `data/cn/README.md` and the guide as MCP resources and add a
   `chef-special` prompt that drafts the Discord post from `champion_stats` + `best_build`, which is what
   `tools/discord/post_chef_special.py` does by hand today.
