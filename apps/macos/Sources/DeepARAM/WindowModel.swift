import AppKit
import DeepARAMKit
import WebKit

/// One window: a page per sidebar section (each remembers where you were, like the iPhone app's tabs)
/// and the state of the selected one for the toolbar and menus.
@MainActor
final class WindowModel: ObservableObject {
    static let sections: [SiteTab] = SiteTab.primary + SiteTab.more
    private static let lastSectionKey = "deeparam.lastSection"
    static let handoffActivity = "com.deeparam.mac.browsing"

    @Published var selection: String {
        didSet {
            UserDefaults.standard.set(selection, forKey: Self.lastSectionKey)
            watchCurrent()
        }
    }
    @Published private(set) var title = "DeepARAM"
    @Published private(set) var url: URL?
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = false

    private var pages: [String: SitePage] = [:]
    private var observers: [NSKeyValueObservation] = []

    init(open url: URL? = nil) {
        let saved = UserDefaults.standard.string(forKey: Self.lastSectionKey)
        let start = AppSettings.reopenLastPage ? saved : nil
        selection = Self.sections.contains { $0.id == start } ? start! : SiteTab.home.id
        if let url { open(url) }
        watchCurrent()
    }

    var currentTab: SiteTab { Self.sections.first { $0.id == selection } ?? .home }
    var current: SitePage { page(for: currentTab) }

    func page(for tab: SiteTab) -> SitePage {
        if let p = pages[tab.id] { return p }
        let p = SitePage(tab: tab, platform: "macos")
        p.webView.allowsMagnification = true
        p.webView.pageZoom = AppSettings.pageZoom
        pages[tab.id] = p
        return p
    }

    // MARK: Navigation

    func select(_ tab: SiteTab) {
        if selection == tab.id { current.reselect() } else { selection = tab.id }
    }

    /// Opens a site link in the section it belongs to (a patch alert's PBE link lands on the PBE tab).
    func open(_ url: URL) {
        guard Site.isInternal(url) else {
            NSWorkspace.shared.open(url)
            return
        }
        let tab = Self.section(for: url) ?? currentTab
        if selection != tab.id { selection = tab.id }
        page(for: tab).open(url)
    }

    static func section(for url: URL) -> SiteTab? {
        let path = url.path.isEmpty ? "/" : url.path
        return sections.first { $0.path != "/" && (path == $0.path || path.hasPrefix($0.path + "/")) }
            ?? (path == "/" ? .home : nil)
    }

    func goBack() { current.goBack() }
    func goForward() { current.webView.goForward() }
    func reload() { current.reload() }
    func stop() { current.webView.stopLoading() }

    func openSearch() {
        // The site's search palette opens on ⌘K; the menu item claims that shortcut, so pass it on.
        current.webView.evaluateJavaScript(
            "window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))"
        )
    }

    var shareableURL: URL? {
        guard let url, Site.isInternal(url), url.scheme?.hasPrefix("http") == true else { return nil }
        return url
    }

    func openInBrowser() {
        if let u = shareableURL { NSWorkspace.shared.open(u) }
    }

    func copyLink() {
        guard let u = shareableURL else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(u.absoluteString, forType: .string)
    }

    // MARK: Zoom (applies to every section, and is remembered)

    func zoom(by step: CGFloat) { setZoom(AppSettings.pageZoom + step) }
    func resetZoom() { setZoom(1) }
    private func setZoom(_ z: CGFloat) {
        let clamped = min(max(z, 0.5), 3)
        AppSettings.pageZoom = clamped
        for p in pages.values { p.webView.pageZoom = clamped }
    }

    // MARK: Toolbar state

    private func watchCurrent() {
        let wv = current.webView
        let sync: (WKWebView) -> Void = { [weak self] wv in
            Task { @MainActor in
                guard let self, wv === self.current.webView else { return }
                self.title = Self.cleanTitle(wv.title, fallback: self.currentTab.title)
                self.url = wv.url
                self.canGoBack = wv.canGoBack
                self.canGoForward = wv.canGoForward
                self.isLoading = wv.isLoading
            }
        }
        observers = [
            wv.observe(\.title) { w, _ in sync(w) },
            wv.observe(\.url) { w, _ in sync(w) },
            wv.observe(\.canGoBack) { w, _ in sync(w) },
            wv.observe(\.canGoForward) { w, _ in sync(w) },
            wv.observe(\.isLoading) { w, _ in sync(w) },
        ]
        sync(wv)
    }

    /// "Tier List · DeepARAM" -> "Tier List"; the app already says it's DeepARAM.
    static func cleanTitle(_ raw: String?, fallback: String) -> String {
        guard let raw, !raw.isEmpty else { return fallback }
        for sep in [" · DeepARAM", " | DeepARAM", " - DeepARAM", " — DeepARAM"] where raw.hasSuffix(sep) {
            return String(raw.dropLast(sep.count))
        }
        return raw
    }
}
