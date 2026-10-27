import DeepARAMKit
import SwiftUI

/// One app window: the sections in a sidebar and the selected section's page.
struct MainWindow: View {
    @StateObject private var model = WindowModel(open: WindowRouter.shared.takePending())
    @Environment(\.openWindow) private var openWindow
    @State private var columns = NavigationSplitViewVisibility.all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List(selection: $model.selection) {
                Section {
                    ForEach(SiteTab.primary) { row($0) }
                }
                Section("More") {
                    ForEach(SiteTab.more) { row($0) }
                }
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 260)
        } detail: {
            PageView(page: model.current)
                .id(model.selection)
        }
        .navigationTitle(model.title)
        .toolbar { toolbar }
        .focusedSceneObject(model)
        // Handoff: the page on screen shows up on a nearby iPhone or iPad, in the app or in Safari.
        .userActivity(WindowModel.handoffActivity, isActive: model.shareableURL != nil) { activity in
            activity.title = model.title
            activity.webpageURL = model.shareableURL
            activity.isEligibleForHandoff = true
        }
        .onAppear { OpenWindowBridge.openMain = { [openWindow] in openWindow(id: "main") } }
        .onReceive(NotificationCenter.default.publisher(for: .deeparamOpenURL)) { note in
            // Patch alerts, links and the menu bar panel land in the window the router picked.
            guard let url = note.object as? URL, let target = note.userInfo?["window"] as? NSWindow,
                  model.current.webView.window === target else { return }
            model.open(url)
        }
    }

    private func row(_ tab: SiteTab) -> some View {
        Label(tab.title, systemImage: tab.symbol)
            .tag(tab.id)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button { model.goBack() } label: { Label("Back", systemImage: "chevron.left") }
                .disabled(!model.canGoBack)
                .help("Back")
            Button { model.goForward() } label: { Label("Forward", systemImage: "chevron.right") }
                .disabled(!model.canGoForward)
                .help("Forward")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { model.openSearch() } label: { Label("Search", systemImage: "magnifyingglass") }
                .help("Search champions, augments and items (⌘K)")
            if model.isLoading {
                Button { model.stop() } label: { Label("Stop", systemImage: "xmark") }
                    .help("Stop loading")
            } else {
                Button { model.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
                    .help("Reload")
            }
            if let url = model.shareableURL {
                ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                    .help("Share this page")
            }
        }
    }
}

/// A section's page, with the offline note or offline screen over it when needed.
private struct PageView: View {
    @ObservedObject var page: SitePage

    var body: some View {
        SiteWebView(page: page)
            .ignoresSafeArea()
            .overlay {
                if page.failedOffline {
                    ContentUnavailableView {
                        Label("You're offline", systemImage: "wifi.slash")
                    } description: {
                        Text("This page hasn't been saved for offline use yet.")
                    } actions: {
                        Button("Try Again") { page.reload() }
                    }
                    .background(.background)
                }
            }
            .overlay(alignment: .top) {
                if let saved = page.offlineCopyDate, !page.failedOffline {
                    OfflineBanner(saved: saved) { page.reload() }
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeOut(duration: 0.2), value: page.offlineCopyDate)
    }
}

private struct OfflineBanner: View {
    let saved: Date
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
            Text("You're offline. Showing the copy saved \(saved, format: .relative(presentation: .named)).")
            Button("Try again", action: retry)
                .buttonStyle(.link)
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
        .shadow(radius: 6, y: 2)
    }
}

extension Notification.Name {
    static let deeparamOpenURL = Notification.Name("deeparam.openURL")
}

/// Sends a URL to the frontmost window, or to the next window that opens when none is.
@MainActor
final class WindowRouter {
    static let shared = WindowRouter()
    private var pending: URL?

    func open(_ url: URL) {
        NSApp.activate(ignoringOtherApps: true)
        // The frontmost app window, even while the menu bar panel has focus.
        let windows = NSApp.orderedWindows.filter { $0.isVisible && $0.canBecomeMain }
        if let target = windows.first(where: \.isMainWindow) ?? windows.first {
            target.makeKeyAndOrderFront(nil)
            NotificationCenter.default.post(name: .deeparamOpenURL, object: url, userInfo: ["window": target])
        } else {
            pending = url
            OpenWindowBridge.openMain?()
        }
    }

    func takePending() -> URL? {
        defer { pending = nil }
        return pending
    }
}

/// SwiftUI only hands out `openWindow` inside views; windows leave it here for code outside them.
@MainActor
enum OpenWindowBridge {
    static var openMain: (() -> Void)?
}
