#if os(visionOS)
import DeepARAMKit
import SwiftUI

/// A site page with its toolbar, a loading bar, and a note when it's showing a saved copy.
/// Goes inside a NavigationStack.
struct VisionPage: View {
    @ObservedObject var page: SitePage
    let title: String
    @ObservedObject private var models = ChampionModelStore.shared
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ZStack(alignment: .top) {
            SiteWebView(page: page)
            if page.isLoading {
                ProgressView().progressViewStyle(.linear).frame(height: 2)
            }
            if page.failedOffline {
                ContentUnavailableView {
                    Label("You're offline", systemImage: "wifi.slash")
                } description: {
                    Text("This page hasn't been saved yet. It will open offline after you've viewed it once with a connection.")
                } actions: {
                    Button("Try again") { page.reload() }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .glassBackgroundEffect()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let date = page.offlineCopyDate {
                HStack(spacing: 10) {
                    Image(systemName: "wifi.slash")
                    Text("Offline. Saved \(date, format: .relative(presentation: .named)).").lineLimit(1)
                    Spacer()
                    Button("Retry") { page.reload() }
                }
                .font(.callout)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(.regularMaterial)
            }
        }
        .navigationTitle(title)
        .toolbar {
            if page.canGoBack {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.backward") { page.goBack() }
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let url = shareableURL, let model = models.models?.model(forPage: url) {
                    Button("View in 3D", systemImage: "cube") {
                        openWindow(id: ChampionVolume.id, value: model.id)
                    }
                }
                Button("Reload", systemImage: "arrow.clockwise") { page.reload() }
                if let url = shareableURL {
                    ShareLink(item: url)
                    Button("Open in New Window", systemImage: "macwindow.badge.plus") {
                        openWindow(id: VisionPageWindow.id, value: url)
                    }
                }
            }
        }
    }

    private var shareableURL: URL? {
        guard let url = page.currentURL ?? page.webView.url, Site.isInternal(url) else { return nil }
        return url
    }
}
#endif
