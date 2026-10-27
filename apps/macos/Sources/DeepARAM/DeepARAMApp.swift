import AppKit
import DeepARAMKit
import SwiftUI

@main
struct DeepARAMApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @AppStorage(AppSettings.Key.showMenuBar) private var showMenuBar = true

    init() { AppSettings.register() }

    var body: some Scene {
        WindowGroup("DeepARAM", id: "main") {
            MainWindow()
                .frame(minWidth: 820, minHeight: 520)
        }
        .defaultSize(width: 1360, height: 900)
        .commands { AppCommands() }
        // deeparam:// links are routed by the app delegate into an existing window, not a new one each time.
        .handlesExternalEvents(matching: [])

        Settings {
            SettingsView()
        }

        MenuBarExtra("DeepARAM", systemImage: "chart.bar.xaxis", isInserted: $showMenuBar) {
            MenuBarPanel()
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        // deeparam://champions/Ahri style links (from other apps, Shortcuts or the browser).
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURL(_:withReply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Running straight from `swift run` has no bundle; make it a regular app with a Dock icon anyway.
        if Bundle.main.bundleIdentifier == nil {
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
        }
        NSWindow.allowsAutomaticWindowTabbing = true
        PatchNotifier.shared.start()
        OfflineSaver.shared.saveIfDue()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Stay running so patch alerts and the menu bar lookup keep working; the Dock icon opens a new window.
        false
    }

    @objc private func handleGetURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
        guard let s = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let link = URL(string: s), let page = Site.pageURL(forAppLink: link) else { return }
        Task { @MainActor in WindowRouter.shared.open(page) }
    }

    /// Right-click on the Dock icon: jump straight to a section.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        for tab in WindowModel.sections {
            menu.addItem(DockItem(title: tab.title, url: tab.url))
        }
        return menu
    }
}

/// A Dock menu item that opens a site page.
private final class DockItem: NSMenuItem {
    private let url: URL

    init(title: String, url: URL) {
        self.url = url
        super.init(title: title, action: #selector(go), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func go() {
        let url = self.url
        Task { @MainActor in WindowRouter.shared.open(url) }
    }
}
