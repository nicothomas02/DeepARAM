import Combine
import DeepARAMKit
import SwiftUI
import WebKit

/// One window's state: the selected section, the champion beside it, and their pages.
@MainActor
final class PadModel: ObservableObject {
    @Published var section: SiteTab? = .tiers {
        didSet {
            focusChampionPane = false
            if let section, section != oldValue {
                Haptics.shared.play(.step)
                state(for: section).page.loadIfNeeded()
            }
        }
    }
    /// The champion in the side pane, by alias; nil shows the champion grid.
    @Published var champion: String?
    @Published var showChampionPane = true {
        didSet { updateLinkRouting() }
    }
    /// Share of the width the section page gets while the champion pane is open.
    @Published var split: CGFloat = 0.58
    @Published var searchText = ""
    @Published var searchPresented = false
    /// False in compact widths (Slide Over, a narrow Split View), where two pages don't fit.
    @Published var isRegularWidth = true {
        didSet { updateLinkRouting() }
    }
    /// Whether Back, Reload and the like act on the champion pane: true right after a champion opens,
    /// false again once the section page moves.
    @Published var focusChampionPane = false
    @Published private(set) var status: SiteStatus?

    let search = SearchIndex()
    let championState = PageState(page: SitePage(tab: .page("/champions", title: "Champions"), platform: "ipad"))
    private var states: [String: PageState] = [:]
    private var watchers: Set<AnyCancellable> = []

    /// Every page in this window, for the Haptics switch.
    var webViews: [WKWebView] { [championState.page.webView] + states.values.map(\.page.webView) }

    var championVisible: Bool { showChampionPane && isRegularWidth }
    var current: PageState? { section.map(state(for:)) }
    var active: PageState? { focusChampionPane && championVisible && champion != nil ? championState : current }

    func state(for section: SiteTab) -> PageState {
        if let s = states[section.id] { return s }
        let s = PageState(page: SitePage(tab: section, platform: "ipad"))
        states[section.id] = s
        route(s)
        // Moving around the section page hands Back and Reload back to it.
        s.$url.dropFirst().sink { [weak self] _ in self?.focusChampionPane = false }.store(in: &watchers)
        return s
    }

    func openChampion(_ alias: String) {
        if alias != champion { Haptics.shared.play(.tap) }
        champion = alias
        if championVisible {
            championState.page.open(Champion.url(alias))
            focusChampionPane = true
        } else {
            current?.page.open(Champion.url(alias))
        }
    }

    func showChampionGrid() {
        champion = nil
        if !showChampionPane { toggleChampionPane() }
    }

    /// Opens a search result or link: champions go to the side pane, section pages switch the
    /// sidebar, anything else (augments, items) opens in the current page.
    func open(_ url: URL) {
        searchText = ""
        searchPresented = false
        if let alias = Champion.alias(in: url) { openChampion(alias); return }
        guard Site.isInternal(url) else { return }
        if let target = SiteTab.padSection(for: url) {
            section = target
            if url.path != target.path { state(for: target).page.open(url) }
        } else {
            current?.page.open(url)
        }
    }

    func toggleChampionPane() {
        withAnimation(.snappy) { showChampionPane.toggle() }
        if showChampionPane, let champion, championState.url == nil { championState.page.open(Champion.url(champion)) }
    }

    func load() async {
        await search.load()
        status = try? await PatchWatcher().status()
    }

    private func route(_ s: PageState) {
        s.onChampionLink = championVisible ? { [weak self] alias in self?.openChampion(alias) } : nil
    }

    private func updateLinkRouting() {
        states.values.forEach(route)
    }
}
