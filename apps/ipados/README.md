# DeepARAM for iPad

The iPad layout of the DeepARAM app, in SwiftUI. Every section is the live deeparam.com page
(through the shared `apps/shared/DeepARAMKit` package), so site changes show up without an app update.

## What it adds on iPad

- **Sidebar** in the site's order: Home, Tier List, Simulator, The Kitchen, then More (PBE, Patches,
  Info, Champions) and Account (with My Stats). The selected section lists its own tabs underneath, such
  as Champions, Augments, Items, Weapon of Destiny and Pentakill on the Tier List. One search covers
  champions, augments, items and pages.
- **Champion pane**: champion links open beside the current page, for example the Tier List on the
  left and a champion on the right. Drag the divider to resize; double-tap it to reset. With no
  champion picked, the pane shows a grid of every champion. A champion can also open in its own
  window (Stage Manager, Split View) or be dragged in from search.
- **Keyboard shortcuts** (hold ⌘ to see them): ⌘1–⌘9 sections, ⌃⇥ / ⌃⇧⇥ next and previous tab, ⌘F find, ⇧⌘F search the page,
  ⌘R reload, ⌘[ / ⌘] back and forward, ⌘↑ top, ⌥⌘C champion pane, ⇧⌘G all champions.
- **Apple Pencil**: double-tap or squeeze toggles the champion pane (unless the Pencil gesture is set
  to do nothing in Settings), 44-point targets with hover highlights, Scribble in search fields.
- Each window remembers its section, champion, pane and split. `deeparam://champions/Jinx` and
  deeparam.com links open in place. In Slide Over or a narrow Split View the pane folds away and
  champions open in the main page.

The site's own tab bar and header links are hidden in the app (the shared package does this); its
Settings and Account buttons and the footer with Riot's notice stay. The About sheet repeats the notice.

## How it ships

iPhone and iPad are one App Store app (`com.deeparam.app`, project in `apps/ios`). This folder is a
Swift package, `DeepARAMPad`, with the whole iPad UI: `PadRootView`, `PadCommands` and
`PadChampionWindow`. The app shows `PadRootView` when it runs on an iPad and the tab bar on an iPhone.

## Build

Open `apps/ios/DeepARAM.xcodeproj` in Xcode 16 and run on an iPad simulator. CI builds the app on every
change to `apps/ios`, `apps/ipados` or `apps/shared` (`.github/workflows/ios-app.yml`).
