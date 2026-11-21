# DeepARAM for iPhone

A SwiftUI app with a native tab bar (Home, Tier List, Simulator, The Kitchen, More), the same tabs as the
site's phone tab bar. More holds PBE, Patch Recaps, Info, Champions and Account & My Stats. Each tab shows the
matching deeparam.com page, so every site update reaches the app without a new release.

- **Tabs** keep their place when you switch; tapping the current tab scrolls to the top, then back to its first page.
- **Subtab shortcuts:** More lists every Tier List, Simulator and Kitchen subtab (Weapon of Destiny, Pentakill, Duos,
  2v2, Infinite Ryze and so on); tapping one opens it in its own tab. The list is `SiteTab.sections` in the shared package.
- **Quick actions:** press and hold the app icon for Tier List, Weapon of Destiny, Pentakill and today's Chef Special
  (`UIApplicationShortcutItems` in `Config/Info.plist`; each type is the page's path).
- **Siri, Spotlight and Shortcuts:** "Open Pentakill in DeepARAM" and the other pages in `Shortcuts.swift`.
- **Links:** `deeparam://tier-list?tab=pentakill` (and deeparam.com links handed to the app) open in the tab they belong to.
- **Offline:** every page you open is saved. With no connection the tab shows the saved copy and when it was saved.
- **Haptics** on tab changes, re-taps, pull to refresh, retry and going offline, plus every tap the site itself buzzes for (it calls `navigator.vibrate`, which the app turns into native haptics). One switch in More > Haptics, the same setting as Vibration in the site's settings menu.
- **Patch alerts** (More > New patch alerts): iOS wakes the app in the background now and then; it checks
  `/data/app-status.json` (falling back to the sitemap) and posts a notification for a new live patch or PBE update.
  Tapping it opens that patch recap or the PBE tab.
- The site's own phone tab bar, header links and first-visit tour are hidden inside the app (`AppChrome` in the shared package).
- Riot's "not endorsed" notice is at the bottom of More.
- **Apple Watch:** the `DeepARAMWatch` target (sources in `apps/watchos`) is embedded, so the watch app installs with the phone app. See `apps/watchos/README.md`.

- **Widgets** (`DeepARAMWidgets`, an app extension embedded in the app): three widgets for between games, made for
  StandBy's Modular face on a stand (This week large, the other two small) and fine on the Home Screen too.
  - **This week** (small, medium, large): record, a win bar, and three leading indicators against your own previous
    60 days: deaths per 10 minutes, damage to champions per minute, and share of your team's kills. Large adds the tip.
  - **Next game** (small, medium, Lock Screen): one thing to work on, the indicator furthest below your usual.
  - **Your champions** (small, medium): the three champions you played most in the last 30 days, with their DeepScore
    tier on the live patch, how it moved since last patch, and Riot's Mayhem balance lines for them.
  The data is private. More > iPhone widgets trades the app's sign-in (the web view's cookies) for a widget token,
  kept in the keychain and shared with the extension through the App Group `group.com.deeparam.app`. The widgets read
  `https://deeparam.com/api/widget` with it (`web/src/app/api/widget/route.ts`, `web/src/lib/widget-summary.ts`).
  Only the site owner's account can connect, since it's the owner's own games. Disconnect deletes the token on the site.
  **Live game:** while the owner's PC app reports a game, This week and Next game switch to it (refreshing about once
  a minute), and a Live Activity follows it on the Lock Screen, in the Dynamic Island and full screen in StandBy,
  updated by pushes the PC app sends. See `docs/iphone-live-game.md`.
  The first build with your team in Xcode registers the App Group for both `com.deeparam.app` and `com.deeparam.app.widgets`.

Shared code (tabs, web view, offline copies, patch checks) lives in `apps/shared/DeepARAMKit` so the iPad and Mac apps use the same pieces.

## Run it

Needs Xcode 16 or newer.

```sh
open apps/ios/DeepARAM.xcodeproj
```

Pick an iPhone simulator and press Run. To run on a real phone, choose your team under Signing & Capabilities.

From the command line:

```sh
cd apps/ios
xcodebuild build -project DeepARAM.xcodeproj -scheme DeepARAM -destination 'platform=iOS Simulator,name=iPhone 16'
```

To test background patch checks in the simulator, pause the app in the debugger and run
`e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.deeparam.app.refresh"]`.
