import DeepARAMKit
import Foundation

/// Names a window from the page it shows: the tab it belongs to, or the last part of its path
/// ("/champions/miss-fortune" is "Miss Fortune").
public enum PageTitle {
    static let tabs = SiteTab.primary + SiteTab.more + SiteTab.legal

    public static func tab(for url: URL) -> SiteTab? {
        let path = url.path.isEmpty ? "/" : url.path
        return tabs.filter { path == $0.path || ($0.path != "/" && path.hasPrefix($0.path + "/")) }
            .max { $0.path.count < $1.path.count }
    }

    public static func title(for url: URL) -> String {
        if let tab = tab(for: url), tab.path == url.path || tab.path == "/" { return tab.title }
        let last = url.lastPathComponent
        guard !last.isEmpty, last != "/" else { return "DeepARAM" }
        return last.replacingOccurrences(of: "-", with: " ").capitalized
    }
}
