import Foundation
import SwiftUI
import WebKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One tab's web page. Keeps its own web view so each tab remembers where you were, saves an
/// offline copy of pages that load, and shows the saved copy when there is no connection.
@MainActor
public final class SitePage: NSObject, ObservableObject {
    public let tab: SiteTab
    public let webView: WKWebView

    @Published public private(set) var isLoading = false
    @Published public private(set) var canGoBack = false
    /// Set while the page on screen is a saved copy; holds when it was saved.
    @Published public private(set) var offlineCopyDate: Date?
    @Published public private(set) var failedOffline = false

    private let store: OfflineStore
    private var started = false
    private var loadingCopy = false

    public init(tab: SiteTab, platform: String, store: OfflineStore = OfflineStore()) {
        self.tab = tab
        self.store = store

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // shared by every tab: settings and sign-in carry over
        config.applicationNameForUserAgent = Site.userAgentSuffix
        config.userContentController.addUserScript(WKUserScript(source: AppChrome.script(platform: platform), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        HapticsBridge.install(in: config.userContentController)
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        config.dataDetectorTypes = []
        #endif
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        #if os(iOS) || os(visionOS)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        #endif
        #if os(iOS)
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulledToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        #elseif os(macOS)
        webView.setValue(false, forKey: "drawsBackground")
        #endif
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) { webView.isInspectable = true }
        #endif
    }

    public func loadIfNeeded() {
        guard !started else { return }
        started = true
        webView.load(URLRequest(url: tab.url))
    }

    public func open(_ url: URL) {
        started = true
        webView.load(URLRequest(url: url))
    }

    public func reload() {
        if offlineCopyDate != nil || failedOffline || webView.url == nil {
            open(webView.url.flatMap { Site.isInternal($0) ? $0 : nil } ?? tab.url)
        } else {
            webView.reload()
        }
    }

    public func goBack() { webView.goBack() }

    /// Tapping the selected tab again: scroll to the top, or go back to the tab's first page.
    public func reselect() {
        #if os(iOS) || os(visionOS)
        let sv = webView.scrollView
        if sv.contentOffset.y > -sv.adjustedContentInset.top + 4 {
            sv.setContentOffset(CGPoint(x: 0, y: -sv.adjustedContentInset.top), animated: true)
            return
        }
        #endif
        if webView.url?.path != tab.url.path { open(tab.url) }
    }

    #if os(iOS)
    @objc private func pulledToRefresh(_ control: UIRefreshControl) {
        Haptics.shared.play(.tap)
        reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { control.endRefreshing() }
    }
    #endif

    private func update() {
        isLoading = webView.isLoading
        canGoBack = webView.canGoBack
    }

    private func saveOfflineCopy() {
        guard let url = webView.url, Site.isInternal(url) else { return }
        webView.createWebArchiveData { [store] result in
            if case let .success(data) = result, data.count > 1024 { store.save(data, for: url) }
        }
    }

    private func showOfflineCopy(for url: URL?) {
        let wanted = url ?? tab.url
        for candidate in [wanted, tab.url] {
            if let data = store.load(for: candidate) {
                offlineCopyDate = store.savedDate(for: candidate) ?? Date()
                failedOffline = false
                loadingCopy = true
                webView.load(data, mimeType: "application/x-webarchive", characterEncodingName: "utf-8", baseURL: candidate)
                return
            }
        }
        failedOffline = true
    }

    private static func isConnectionError(_ error: Error) -> Bool {
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return false }
        return [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
                NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed,
                NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff].contains(e.code)
    }

    private func openOutside(_ url: URL) {
        #if os(iOS) || os(visionOS)
        UIApplication.shared.open(url)
        #elseif os(macOS)
        NSWorkspace.shared.open(url)
        #endif
    }
}

extension SitePage: WKNavigationDelegate, WKUIDelegate {
    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if ["http", "https", "about", "blob", "data"].contains(url.scheme ?? "") == false {
            openOutside(url) // mailto:, tel:, other apps
            return .cancel
        }
        // Links to other websites open in the browser; site pages stay in the app.
        if action.targetFrame?.isMainFrame != false, url.scheme?.hasPrefix("http") == true, !Site.isInternal(url) {
            openOutside(url)
            return .cancel
        }
        return .allow
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { update() }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { update() }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        update()
        if loadingCopy { loadingCopy = false; return } // the saved copy itself isn't saved again
        offlineCopyDate = nil
        failedOffline = false
        saveOfflineCopy()
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        update()
        if Self.isConnectionError(error) {
            showOfflineCopy(for: (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL)
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { update() }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // target="_blank" links and window.open: site pages open in this tab, others in the browser.
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if Site.isInternal(url) { webView.load(action.request) } else { openOutside(url) }
        }
        return nil
    }
}

/// Shows a `SitePage` in SwiftUI.
public struct SiteWebView: View {
    @ObservedObject var page: SitePage

    public init(page: SitePage) { self.page = page }

    public var body: some View {
        WebViewHost(webView: page.webView)
            .onAppear { page.loadIfNeeded() }
    }
}

#if os(iOS) || os(visionOS)
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#elseif os(macOS)
struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
#endif
