# DeepARAM for Android TV and Google TV

A native app built for the remote (Jetpack Compose for TV, no web view). Tabs along the top
switch as you move across them; press down to enter a tab, Back to leave a champion page.

- **Tier List:** every champion grouped by tier, best win rate first. Select one for its page:
  tier, win rate, pick rate, skill order, build and best augments by rarity.
- **Augments:** the augment tier list with All / Prismatic / Gold / Silver filters.
- **Chef Special:** today's build. Select the champion card to open their page.
- **PBE:** new, changed and removed augments plus champion, item and mode changes. PBE content
  only appears on this tab.
- **About:** version and Riot's "not endorsed" notice.
- **Offline:** the last good load is saved. Without a connection the app shows that copy, marks
  "Offline" next to the patch, and tries again every minute.

Data is one fetch of `https://deeparam.com/data/tv.json` (shared with the Apple TV app). If that
route is missing the app falls back to `/data/watch.json` plus `/data/champion-tiers.json`, which
has no augment tier list or PBE, so those tabs hide.

## Ids

- `applicationId` is `com.deeparam.app`, the same as the phone app (`apps/android`), so the TV
  build ships in the same Google Play listing on the Android TV form factor.
- TV `versionCode`s are `2xxxxxx` (phone uses small numbers, Wear OS `1xxxxxx`).
- The manifest requires `android.software.leanback` and not a touchscreen, so Play only offers this
  build to TVs. The launcher banner is `res/drawable-xhdpi/banner.png`.

Riot's notice comes from the shared module `apps/android/core` (included in `settings.gradle.kts`).

## Build and run

Needs JDK 17+ and the Android SDK (platform 35). Android Studio works too: open this folder.

```sh
cd apps/androidtv
./gradlew testDebugUnitTest assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Run it on an Android TV emulator (Device Manager > TV > 1080p, API 34) or a real Google TV with
USB or network debugging on. CI (`.github/workflows/androidtv-app.yml`) runs the tests and uploads
the debug APK and an unsigned release bundle.

Publishing needs a Play upload key and Nico's go-ahead.
