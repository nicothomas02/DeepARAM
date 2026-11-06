# DeepARAM for Android

The Android app for phones, tablets, foldables and Chromebooks. A native tab bar (Home, Tier List,
Simulator, Kitchen, More) shows the matching deeparam.com page, so every site update reaches the app
without a new release. On screens 600 dp and wider (tablets, unfolded phones, Chromebook windows) the
tabs move to a side rail.

- **Tabs** keep their place when you switch; tapping the current tab scrolls to the top, then back to its first page.
- **Back** goes back within the page first, then out of a More page, then to Home.
- **Offline:** every page you open is saved. With no connection the tab shows the saved copy and when it was saved.
- **Haptics** on tab changes, pull to refresh and every tap the site buzzes for (the site's own haptics hook is
  wired to Android's haptic feedback). One switch in More > Haptics, the same setting as Vibration in the site's settings.
- **Patch alerts** (More > New patch alerts): every few hours the app checks the site and posts a notification for a
  new live patch or PBE update. Tapping it opens that patch recap or the PBE page.
- **Light / Dark** follows the site's own theme switch; the app's bars change with it.
- **Chromebooks and keyboards:** Ctrl+1 to Ctrl+5 pick a tab, Ctrl+R or F5 reloads, Alt+Left goes back. Windows resize freely.
- **deeparam.com links** open in the app once the site serves `/.well-known/assetlinks.json` with the app's signing key.
- The site's own phone tab bar and header links are hidden inside the app (`AppChrome`, the same CSS as the Apple apps).
- Riot's "not endorsed" notice is at the bottom of More.

## Layout

| Module | What it is |
| --- | --- |
| `core` | Android library shared code for the app: `Site` and `SiteTab` (links and tabs), `SitePage` (one tab's web view with offline copies), `AppChrome`, `AppBridge` and `Haptics`, `OfflineStore`, `PatchWatcher`, `Legal`. No Compose, minSdk 23. |
| `app` | The phone, tablet and ChromeOS app (Jetpack Compose), `com.deeparam.app`. |

## Build it

Needs JDK 17 or newer and the Android SDK (Android Studio has both). Open `apps/android` in Android Studio and
press Run, or from the command line:

```sh
cd apps/android
./gradlew :core:testDebugUnitTest :app:assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:connectedDebugAndroidTest              # with an emulator or phone connected
```

Every pull request that touches `apps/android` runs `.github/workflows/android-app.yml`: unit tests, lint, the
debug app and the release bundle, then the device tests on an emulator with phone and tablet screenshots. The
debug APK is kept on each run as `deeparam-debug-apk`, ready to install on a phone or Chromebook.

## Releasing

Not on Google Play yet; publishing waits for Nico. A release needs an upload key, passed as Gradle properties
(`deeparam.keystore`, `deeparam.keystorePassword`, `deeparam.keyAlias`, `deeparam.keyPassword`, for example in
`~/.gradle/gradle.properties`, never in the repo), then `./gradlew :app:bundleRelease`.
