import DeepARAMKit
import SwiftUI
import WebKit

/// The native tab bar: Home, Tier List, Simulator, The Kitchen and More, like the site's phone tabs.
struct RootView: View {
    @StateObject private var pages = PageStore()
    @State private var selection = SiteTab.home.id
    @State private var morePath: [SiteTab] = []

    var body: some View {
        TabView(selection: tabBinding) {
            ForEach(SiteTab.primary) { tab in
                WebTab(page: pages.page(for: tab))
                    .tabItem { Label(tab.title, systemImage: tab.symbol) }
                    .tag(tab.id)
            }
            MoreView(pages: pages, path: $morePath) { open($0) }
                .tabItem { Label("More", systemImage: "ellipsis") }
                .tag("more")
        }
        .onOpenURL { url in open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { open(url) }
        }
        .onReceive(NotificationCenter.default.publisher(for: PatchAlerts.openPage)) { note in
            if let url = note.object as? URL { open(url) }
        }
        .onReceive(AppLinks.shared.$pending) { url in
            guard let url else { return }
            AppLinks.shared.pending = nil
            open(url)
        }
    }

    /// Tapping the tab you're already on scrolls to the top, then back to that tab's first page.
    private var tabBinding: Binding<String> {
        Binding(get: { selection }, set: { new in
            if new == selection {
                if let tab = SiteTab.primary.first(where: { $0.id == new }) { pages.page(for: tab).reselect() }
                Haptics.shared.play(.tap)
            } else {
                Haptics.shared.play(.step)
            }
            selection = new
        })
    }

    /// Opens a site link (from a notification, a shortcut or a deeparam.com link) in the tab it
    /// belongs to: a main tab, or a page under More. Anything else opens on Home.
    private func open(_ link: URL) {
        guard let url = Site.pageURL(forAppLink: link) else { return }
        let tab = SiteTab.tab(for: url) ?? .home
        if SiteTab.more.contains(tab) {
            selection = "more"
            morePath = [tab]
        } else {
            selection = tab.id
        }
        pages.page(for: tab).open(url)
    }
}

/// Keeps one page per tab for the life of the app, so switching tabs never reloads.
@MainActor
final class PageStore: ObservableObject {
    private var pages: [String: SitePage] = [:]

    /// Every page made so far, for things that apply to all of them (the Haptics switch).
    var webViews: [WKWebView] { pages.values.map(\.webView) }

    func page(for tab: SiteTab) -> SitePage {
        if let p = pages[tab.id] { return p }
        let p = SitePage(tab: tab, platform: "ios")
        pages[tab.id] = p
        return p
    }
}

/// A site page with a thin progress bar and a note when it's showing a saved copy.
struct WebTab: View {
    @ObservedObject var page: SitePage
    @State private var retrying = false

    private func retry() {
        Haptics.shared.play(.tap)
        retrying = true
        page.reload()
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.background.ignoresSafeArea()
            SiteWebView(page: page)
                .ignoresSafeArea(.container, edges: .bottom)
            if page.isLoading {
                ProgressView().progressViewStyle(.linear).tint(Theme.accent).frame(height: 2)
            }
            if page.failedOffline {
                OfflineEmpty { retry() }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let date = page.offlineCopyDate { OfflineBanner(date: date) { retry() } }
        }
        .onChange(of: page.offlineCopyDate != nil || page.failedOffline) { _, offline in
            if offline { Haptics.shared.play(.warning) }
        }
        .onChange(of: page.isLoading) { wasLoading, loading in
            // A retry that came back online.
            if wasLoading, !loading, retrying { retrying = false; if page.offlineCopyDate == nil && !page.failedOffline { Haptics.shared.play(.done) } }
        }
    }
}

struct OfflineBanner: View {
    let date: Date
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text("Offline. Saved \(date, format: .relative(presentation: .named)).")
                .lineLimit(1)
            Spacer()
            Button("Retry", action: retry).bold()
        }
        .font(.footnote)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}

struct OfflineEmpty: View {
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("You're offline", systemImage: "wifi.slash")
        } description: {
            Text("This page hasn't been saved yet. It will open offline after you've viewed it once with a connection.")
        } actions: {
            Button("Try again", action: retry).buttonStyle(.borderedProminent)
        }
        .background(Theme.background)
    }
}
