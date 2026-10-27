# DeepARAM for Wear OS

A small native app (Compose for Wear OS), the Wear OS twin of the Apple Watch app, meant for a quick look mid-game:

- **Patch** at the top of the home screen.
- **Chef's Special:** today's build from The Kitchen, with how to play it, its augments and items.
- **Champions:** search by voice, keyboard or handwriting, then see the skill max order, the build
  (boots first, then the build that wins most) and the top augments at each rarity. Pin champions
  you play to the home screen.
- **Offline:** the last download is kept on the watch and refreshed when the app opens (at most once an hour,
  or from About).
- Riot's "not endorsed" notice is on the About screen.

It runs on its own (no phone needed, `com.google.android.wearable.standalone`). It uses the same
applicationId as the phone app in `apps/android` (`com.deeparam.app`) so both ship in one Google Play
listing; watch versionCodes use the 1xxxxxx range so they never collide with the phone's.
Plugin versions match `apps/android`, and Riot's notice comes from the shared module `apps/android/core`
(included through `settings.gradle.kts`).

Data comes from `/data/watch.json` on the site (`web/src/app/data/watch.json/route.ts`), the same file
the Apple Watch app reads.

## Build and test

Needs JDK 17+ and the Android SDK (platform 35). Put `sdk.dir=...` in `local.properties` or set `ANDROID_HOME`.

```sh
cd apps/wearos
./gradlew testDebugUnitTest assembleDebug lintDebug
```

Install on a Wear OS emulator or watch with `adb install app/build/outputs/apk/debug/app-debug.apk`.
CI: `.github/workflows/wearos-app.yml`.

A Play release needs an upload key and a signed `bundleRelease`; ask Nico before publishing.
