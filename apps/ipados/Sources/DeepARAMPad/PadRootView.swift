import DeepARAMKit
import SwiftUI

/// The iPad layout: a sidebar of sections; the section's page with a champion pane beside it.
public struct PadRootView: View {
    @StateObject private var model = PadModel()
    @SceneStorage("pad.section") private var savedSection: String?
    @SceneStorage("pad.champion") private var savedChampion: String?
    @SceneStorage("pad.championPane") private var savedPane = true
    @SceneStorage("pad.split") private var savedSplit = 0.58
    @Environment(\.horizontalSizeClass) private var sizeClass

    public init() {}

    public var body: some View {
        NavigationSplitView {
            Sidebar(model: model)
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 340)
        } detail: {
            DetailView(model: model)
        }
        .focusedSceneObject(model)
        .pencilShortcuts(model: model)
        .onChange(of: sizeClass, initial: true) { _, size in model.isRegularWidth = size != .compact }
        .onAppear(perform: restore)
        .onChange(of: model.section) { _, s in savedSection = s?.id }
        .onChange(of: model.champion) { _, c in savedChampion = c }
        .onChange(of: model.showChampionPane) { _, p in savedPane = p }
        .onChange(of: model.split) { _, f in savedSplit = Double(f) }
        .task { await model.load() }
        .onOpenURL { url in model.open(Self.siteURL(from: url)) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { model.open(url) }
        }
    }

    private func restore() {
        model.showChampionPane = savedPane
        model.split = CGFloat(savedSplit)
        model.section = SiteTab.padSection(id: savedSection) ?? .padTierList
        if let alias = savedChampion { model.openChampion(alias) }
    }

    /// deeparam://champions/Jinx and https://deeparam.com/champions/Jinx both open Jinx;
    /// deeparam://tier-list?tab=pentakill keeps its ?tab= and #fragment.
    static func siteURL(from url: URL) -> URL {
        guard url.scheme == "deeparam", var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.path = "/" + [parts.host, parts.path.isEmpty ? nil : String(parts.path.dropFirst())].compactMap { $0 }.joined(separator: "/")
        parts.scheme = Site.base.scheme
        parts.host = Site.host
        return parts.url ?? Site.url(parts.path)
    }
}

/// The section page and, in regular widths, the champion pane beside it.
struct DetailView: View {
    @ObservedObject var model: PadModel

    var body: some View {
        Group {
            if let section = model.section {
                let state = model.state(for: section)
                SplitPane(fraction: $model.split, showSecondary: model.championVisible) {
                    PadWebPage(state: state)
                } secondary: {
                    ChampionPane(model: model)
                }
                .toolbar { PageToolbar(model: model, state: state, section: section) }
                .navigationTitle(section.title)
                .navigationBarTitleDisplayMode(.inline)
            } else {
                ContentUnavailableView("Pick a section", systemImage: "sidebar.left")
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let alias = urls.lazy.compactMap(Champion.alias(in:)).first else { return false }
            model.openChampion(alias)
            return true
        }
    }
}

/// Back, forward, reload, share and the champion pane switch for the section page.
struct PageToolbar: ToolbarContent {
    @ObservedObject var model: PadModel
    @ObservedObject var state: PageState
    let section: SiteTab

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            BackButton(page: state.page)
            Button { state.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
                .disabled(!state.canGoForward)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { state.page.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
            if let url = state.url, Site.isInternal(url) {
                ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
            }
            if model.isRegularWidth {
                Button { model.toggleChampionPane() } label: {
                    Label(model.showChampionPane ? "Hide Champion Pane" : "Show Champion Pane", systemImage: "rectangle.split.2x1")
                        .symbolVariant(model.showChampionPane ? .fill : .none)
                }
            }
        }
    }
}

/// Watches the page's own back history (SitePage publishes it).
struct BackButton: View {
    @ObservedObject var page: SitePage

    var body: some View {
        Button { page.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
            .disabled(!page.canGoBack)
    }
}
