# DeepARAM for Apple Watch

A small native SwiftUI app (watchOS has no web view), meant for a quick look mid-game:

- **Patch** in the title of the home screen.
- **Chef Special:** today's build from The Kitchen, with why it works, how to play it, its augments and items.
- **Champions:** search by name (dictation or scribble), then see the champion page's quick build: tier and
  DeepScore, skill max order, summoner spells, items (boots, best core, then the best 4th to 6th item) and
  the top augments at each rarity by DeepScore. Pin champions you play to
  the home screen.
- **Offline:** the last download is kept on the watch and refreshed when the app opens (at most once an hour,
  or pull down to refresh).
- Riot's "not endorsed" notice is on the About screen.

It runs on its own (no iPhone needed) and ships inside the iPhone & iPad app
(`com.deeparam.app.watchkitapp`, companion `com.deeparam.app`): the `DeepARAMWatch` target lives in
`apps/ios/DeepARAM.xcodeproj` and the iPhone app embeds it, so one App Store release carries both.

Data comes from `/data/watch.json` on the site (`web/src/app/data/watch.json/route.ts`), rebuilt on every deploy.
The data code lives in `DeepARAMWatchKit` (no UI, so its tests also run on a Mac).

## Run it

Needs Xcode 16 or newer.

```sh
open apps/ios/DeepARAM.xcodeproj
```

Pick the DeepARAMWatch scheme and an Apple Watch simulator, then press Run. From the command line:

```sh
cd apps/watchos/DeepARAMWatchKit && swift test
cd ../../ios && xcodebuild build -project DeepARAM.xcodeproj -scheme DeepARAMWatch -destination 'generic/platform=watchOS Simulator'
```
