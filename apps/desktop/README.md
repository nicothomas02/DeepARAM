# DeepARAM desktop app (Windows, and Linux next)

A small Tauri 2 app that opens deeparam.com in its own window. All features (Tier List, Simulator, PBE, champion pages) come straight from the live site, so the app never needs an update for new content. The same Rust code builds for Windows today; Linux bundles are being added on top. Platform-only bits sit behind `cfg(target_os)` and platform-only bundle settings in `src-tauri/tauri.<platform>.conf.json`.

What the app adds on top of the site:

- Native window that remembers its size and position, and reopens on the page you used last.
- Tray icon: Tier List, Simulator, Patches and PBE shortcuts, "Check for patch updates", toggles for patch notifications and "Start with Windows" (starts hidden in the tray).
- Closing the window keeps the app in the tray; Quit is in the tray menu. A second launch focuses the running app.
- Shortcuts: Ctrl+1 to Ctrl+7 for Home, Tier List, Simulator, Patches, PBE, Champions and The Kitchen; Ctrl+Shift+C copies the page's link. Back (Alt+Left), reload (F5) and zoom (Ctrl +, Ctrl −, Ctrl 0) come with the web view.
- Patch notifications: every 30 minutes it reads `https://deeparam.com/data/app-status.json` (`web/src/app/data/app-status.json/route.ts`, also read by the Mac, iPhone and iPad apps) and notifies when the live patch or the PBE build changes.
- Offline: a bundled start page (`ui/index.html`) waits for the connection and retries; while browsing, a banner shows when the connection drops. WebView2 keeps its own disk cache, so pages already opened load fast.
- Links to other sites open in the default browser.

## Build

On Windows with Node 22 and Rust stable:

```
cd apps/desktop
npm ci
npm run dev      # run against the live site
npm run build    # installers in src-tauri/target/release/bundle/{nsis,msi}
```

CI (`.github/workflows/desktop-app.yml`) lints, tests and builds both installers on every change under `apps/desktop/`, and keeps them as a workflow artifact for 14 days. Public downloads come only from `release.yml` (a `v*` tag or "Run workflow"), which attaches them to a GitHub release next to the Mac app. Bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`, `package.json`) for a new release. Ask Nico before putting it in the Microsoft Store or any other store.

The installers aren't code-signed yet, so Windows SmartScreen shows "Windows protected your PC" on first run (More info, then Run anyway).

Icons are generated from `app-icon.png` with `npm run icons`.
