import DeepARAMKit
import SwiftUI

/// The menu bar: a Go menu for the site's sections plus browser-style View and navigation items.
struct AppCommands: Commands {
    @FocusedObject private var model: WindowModel?
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .appInfo) {
            Button("About DeepARAM") {
                let credits = NSAttributedString(
                    string: Legal.riotNotice,
                    attributes: [.font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize),
                                 .foregroundColor: NSColor.secondaryLabelColor]
                )
                NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
                NSApp.activate(ignoringOtherApps: true)
            }
        }

        CommandGroup(after: .newItem) {
            Button("New Tab") {
                // A new window joins the current one as a tab when tabbing is on.
                NSApp.keyWindow?.tabbingMode = .preferred
                openWindow(id: "main")
            }
            .keyboardShortcut("t")

            Divider()

            Button("Open in Browser") { model?.openInBrowser() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
                .disabled(model == nil)
            Button("Copy Link") { model?.copyLink() }
                .keyboardShortcut("c", modifiers: [.command, .shift])
                .disabled(model == nil)
        }

        CommandGroup(after: .textEditing) {
            Button("Search…") { model?.openSearch() }
                .keyboardShortcut("k")
                .disabled(model == nil)
        }

        CommandGroup(before: .toolbar) {
            Button("Reload Page") { model?.reload() }
                .keyboardShortcut("r")
                .disabled(model == nil)
            Divider()
            Button("Actual Size") { model?.resetZoom() }
                .keyboardShortcut("0")
                .disabled(model == nil)
            Button("Zoom In") { model?.zoom(by: 0.1) }
                .keyboardShortcut("+")
                .disabled(model == nil)
            Button("Zoom Out") { model?.zoom(by: -0.1) }
                .keyboardShortcut("-")
                .disabled(model == nil)
            Divider()
        }

        CommandMenu("Go") {
            Button("Back") { model?.goBack() }
                .keyboardShortcut("[")
                .disabled(model?.canGoBack != true)
            Button("Forward") { model?.goForward() }
                .keyboardShortcut("]")
                .disabled(model?.canGoForward != true)
            Divider()
            ForEach(Array(WindowModel.sections.enumerated()), id: \.element.id) { i, tab in
                Button(tab.title) { model?.select(tab) }
                    .keyboardShortcut(i < 9 ? KeyboardShortcut(KeyEquivalent(Character(String(i + 1)))) : nil)
                    .disabled(model == nil)
            }
        }

        CommandGroup(replacing: .help) {
            Button("DeepARAM Website") { NSWorkspace.shared.open(Site.base) }
            ForEach(SiteTab.legal) { tab in
                Button(tab.title) { WindowRouter.shared.open(tab.url) }
            }
            Divider()
            Button("Report a Bug or Request a Feature") {
                if let url = URL(string: "mailto:admin@deeparam.com?subject=DeepARAM%20for%20Mac") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }
}
