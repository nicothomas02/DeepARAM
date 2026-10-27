# DeepARAM for Apple Vision Pro

The same app as iPhone and iPad (bundle `com.deeparam.app`, Xcode project `apps/ios`), with
Apple Vision Pro added as a destination. On visionOS the app shows the layout in this package
(`DeepARAMVision`) instead of the iPhone tab bar or the iPad sidebar.

- **Tabs** (Home, Tiers, Simulator, PBE, More) sit in the ornament on the window's leading edge. Each keeps its place when you switch; choosing the current tab again scrolls to the top, then back to its first page.
- **Page toolbar:** back, reload, share, and **Open in New Window**, so a champion page or the tier list can float beside the main window. Links to pages outside the four main tabs (patch recaps from a patch alert, for example) open in their own window.
- **Offline copies** and **patch alerts** work as on iPhone (shared `DeepARAMKit`, and `PatchAlerts` in the app). The alert switch is in More.
- **Champions in 3D:** a champion page's toolbar has **View in 3D**, and More has a **3D Champions** gallery. Either opens the champion's model in a volume beside your windows, playing its idle animation. Drag to turn it; the ornament below has pause and a link to the champion page. Base models only (no skins), downloaded from deeparam.com the first time and kept for offline use until the next patch's models arrive.
- Riot's "not endorsed" notice is at the bottom of More.
- The app icon is a two-layer visionOS icon (`VisionAppIcon` in the app's asset catalog).

The iPad package (`apps/ipados`) is linked for iOS only, and this package for visionOS only
(platform filters in the Xcode project), so neither has to build on the other platform.

## The 3D models

visionOS can't open the site's `.glb` models (meshopt-compressed, WebP textures), so
`tools/build_usdz.py` writes a `model.usdz` beside each `web/public/assets/models/<champion>/<id>/model.glb`
and lists them in `web/public/assets/models/models-usdz.json`. Each keeps the visible meshes and the
idle animation, with PNG textures. Run it after the site's models change (setup is in the script):

```sh
/tmp/usdz-venv/bin/python apps/visionos/tools/build_usdz.py          # only champions without one
/tmp/usdz-venv/bin/python apps/visionos/tools/build_usdz.py --force  # rebuild every model
```

## Run it

Needs Xcode 16 or newer with the visionOS platform installed (Xcode > Settings > Components).

```sh
open apps/ios/DeepARAM.xcodeproj
```

Pick an Apple Vision Pro simulator and press Run. From the command line:

```sh
cd apps/ios
xcodebuild build -project DeepARAM.xcodeproj -scheme DeepARAM -destination 'platform=visionOS Simulator,name=Apple Vision Pro'
```

`swift test` in this folder checks how windows are named. CI (`.github/workflows/ios-app.yml`,
job "Apple Vision Pro build") runs those tests and compiles the app for the Vision Pro simulator.
