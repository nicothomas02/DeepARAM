#if os(visionOS)
import DeepARAMKit
import SwiftUI

/// The main window on Apple Vision Pro. The tabs sit in the ornament on the window's leading
/// edge; each page has a toolbar for back, reload, share and opening it in a window of its own.
/// `settings` is shown in the More tab (the app passes its patch alert switch).
@MainActor
public struct VisionRootView<Settings: View>: View {
    @StateObject private var pages = VisionPageStore()
    @State private var selection = SiteTab.home.id
    @Environment(\.openWindow) private var openWindow
    private let openNotification: Notification.Name
    private let settings: Settings

    /// `openNotification` carries a site URL to show, e.g. from a tapped patch alert.
    public init(openNotification: Notification.Name, @ViewBuilder settings: () -> Settings) {
        self.openNotification = openNotification
        self.settings = settings()
    }

    public var body: some View {
        TabView(selection: tabBinding) {
            ForEach(SiteTab.primary) { tab in
                NavigationStack {
                    VisionPage(page: pages.page(for: tab), title: tab.title)
                }
                .tabItem { Label(tab.title, systemImage: tab.symbol) }
                .tag(tab.id)
            }
            VisionMoreView(pages: pages, settings: settings)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag("more")
        }
        .onOpenURL { open($0) }
        .onReceive(NotificationCenter.default.publisher(for: openNotification)) { note in
            if let url = note.object as? URL { open(url) }
        }
    }

    /// Choosing the tab you're already on scrolls to the top, then back to that tab's first page.
    private var tabBinding: Binding<String> {
        Binding(get: { selection }, set: { new in
            if new == selection, let tab = SiteTab.primary.first(where: { $0.id == new }) {
                pages.page(for: tab).reselect()
            }
            selection = new
        })
    }

    /// Main-tab pages open in their tab; any other site page gets a window of its own.
    private func open(_ url: URL) {
        guard Site.isInternal(url) else { return }
        if let tab = PageTitle.tab(for: url), SiteTab.primary.contains(tab) {
            selection = tab.id
            pages.page(for: tab).open(url)
        } else {
            openWindow(id: VisionPageWindow.id, value: url)
        }
    }
}

/// Keeps one page per tab for the life of the window, so switching tabs never reloads.
@MainActor
final class VisionPageStore: ObservableObject {
    private var pages: [String: SitePage] = [:]

    func page(for tab: SiteTab) -> SitePage {
        if let p = pages[tab.id] { return p }
        let p = SitePage(tab: tab, platform: "visionos")
        pages[tab.id] = p
        return p
    }
}
#endif
