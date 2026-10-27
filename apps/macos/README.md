# DeepARAM for Mac

A native macOS window around deeparam.com: a sidebar of the site's sections (Tier List, Simulator, PBE and
the rest), each shown in its own web view that remembers where you were, plus what a browser tab can't do.

- **Menus and shortcuts**: Go menu with the sections on ⌘1–⌘9, ⌘[ / ⌘] back and forward, ⌘K search
  (opens the site's own search), ⌘R reload, ⌘+ / ⌘− / ⌘0 zoom, ⌘T new tab, ⌘⇧C copy link,
  ⌘⇧O open in browser.
- **Offline**: every page that loads keeps a saved copy, and all sections are saved in the background once
  a day (and after each new patch). With no connection a page shows its saved copy under a banner.
- **Patch notifications**: every 3 hours (and on wake) the app reads `/data/app-status.json` and posts a
  notification when a new live or PBE patch appears. Clicking it opens the Tier List or PBE page.
- **Menu bar lookup**: a menu bar icon opens a small panel with today's Chef Special and a champion search.
  Pick a champion to see their tier, win rate, skill order, items and augments for the live patch, or open
  their page. It reads `/data/watch.json` and keeps the last copy for offline use. Switch it off in Settings.
- **Handoff**: the page on screen is offered to a nearby iPhone or iPad.
- **App links**: `deeparam://champions/Ahri` (or any site path) opens that page in the frontmost window.
- **Dock menu**: right-click the Dock icon to jump to a section. About DeepARAM shows Riot's notice.
- Links to other sites open in the default browser. Sign-in and settings persist like Safari's.

The web view, offline copies, sections, link rules and patch check come from `apps/shared/DeepARAMKit`,
shared with the iPhone and iPad apps. This folder adds the Mac window, menus, settings and notifications.

## Build

Needs macOS 14+ and Xcode or the Command Line Tools.

```sh
apps/macos/scripts/build-app.sh          # runs the shared package's tests, then builds
open apps/macos/build/DeepARAM.app
```

`UNIVERSAL=1` builds for Apple silicon and Intel. The default is ad-hoc signed, fine on this Mac; to hand
it to others, set `SIGN_ID` to a Developer ID identity and notarize the result.

For quick iteration `swift run --package-path apps/macos` works too, without notifications (they need the
app bundle).
