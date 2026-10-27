# DeepARAM for Apple TV

A native SwiftUI app for the big screen. tvOS has no web view, so unlike the iPhone, iPad and Mac apps
it draws its own screens from one data file the site builds on every deploy: `/data/tv.json`
(`web/src/lib/tv.ts`).

Tabs along the top:

- **Champions:** the live-patch tier list, one row per tier. Click a champion for its quick build: tier,
  win and pick rate, skill order, items and the best Prismatic, Gold and Silver augments.
- **Augments:** the augment tier list, one rarity at a time.
- **Chef's Special:** today's build from The Kitchen, with why it works and how to play it.
- **PBE:** what's changing for ARAM Mayhem on the test server (only on this tab; everything else is live patch).
- **Search:** find a champion by typing, with the iPhone keyboard or by voice.
- **About:** a QR code to open deeparam.com on a phone, a refresh button and Riot's "not endorsed" notice.

The last good copy of the data is saved, so the app opens offline and says when that copy was saved.

## Layout

- `DeepARAMTV/` is the app (views and the brand assets: layered app icon and Top Shelf images).
- `DeepARAMTVKit/` is a Swift package with the data model, loading and the tier grouping. It has no views,
  so `swift test` runs on a Mac. Its test sample `tv-sample.json` is a trimmed copy of `/data/tv.json`.
- It reuses `apps/shared/DeepARAMKit` for the site address and Riot's notice.

The bundle id is `com.deeparam.app`, the same as the iPhone and iPad app, so it can join that App Store
listing as a universal purchase. Never submit without asking Nico.

## Run it

Needs Xcode 16 or newer.

```sh
open apps/tvos/DeepARAMTV.xcodeproj
```

Pick an Apple TV simulator and press Run. From the command line:

```sh
cd apps/tvos/DeepARAMTVKit && swift test
cd .. && xcodebuild build -project DeepARAMTV.xcodeproj -scheme DeepARAMTV -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)'
```

CI (`.github/workflows/tvos-app.yml`) runs both on every change to `apps/tvos` or `apps/shared`.
