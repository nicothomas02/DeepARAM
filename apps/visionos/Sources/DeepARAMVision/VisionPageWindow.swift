#if os(visionOS)
import DeepARAMKit
import SwiftUI

/// Any site page in a window of its own, to keep a champion or the tier list beside the main window.
/// The app declares `WindowGroup(id: VisionPageWindow.id, for: URL.self) { VisionPageWindow(url: $0.wrappedValue) }`.
@MainActor
public struct VisionPageWindow: View {
    public static let id = "page"

    @StateObject private var page: SitePage
    private let title: String

    public init(url: URL?) {
        let target = url.flatMap { Site.isInternal($0) ? $0 : nil } ?? Site.base
        let path = (target.path.isEmpty ? "/" : target.path) + (target.query.map { "?" + $0 } ?? "")
        let name = PageTitle.title(for: target)
        title = name
        _page = StateObject(wrappedValue: SitePage(tab: SiteTab(id: "window", title: name, symbol: "macwindow", path: path), platform: "visionos"))
    }

    public var body: some View {
        NavigationStack {
            VisionPage(page: page, title: title)
        }
    }
}
#endif
