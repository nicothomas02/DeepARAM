import Foundation

/// The site the apps show, and the tabs they offer. These match the site's phone tab bar.
public enum Site {
    public static let host = "deeparam.com"
    public static let base = URL(string: "https://deeparam.com")!

    /// Added to the browser user agent so the site can tell it is inside the app if it ever needs to.
    public static let userAgentSuffix = "DeepARAMApp/1"

    public static func url(_ path: String) -> URL {
        URL(string: path, relativeTo: base)!.absoluteURL
    }

    /// True for pages that belong in the app; anything else opens in the browser.
    public static func isInternal(_ url: URL) -> Bool {
        guard let h = url.host?.lowercased() else { return url.scheme == "about" }
        return h == host || h == "www." + host
    }
}

public struct SiteTab: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    /// SF Symbol name for the tab bar and sidebar.
    public let symbol: String
    public let path: String

    public var url: URL { Site.url(path) }

    public init(id: String, title: String, symbol: String, path: String) {
        self.id = id
        self.title = title
        self.symbol = symbol
        self.path = path
    }

    public static let home = SiteTab(id: "home", title: "Home", symbol: "house.fill", path: "/")
    public static let tiers = SiteTab(id: "tiers", title: "Tiers", symbol: "chart.bar.fill", path: "/tier-list")
    public static let simulator = SiteTab(id: "simulator", title: "Simulator", symbol: "bolt.fill", path: "/simulator")
    public static let pbe = SiteTab(id: "pbe", title: "PBE", symbol: "flask.fill", path: "/pbe")

    /// The four main tabs; everything else lives under More.
    public static let primary: [SiteTab] = [.home, .tiers, .simulator, .pbe]

    /// The More menu: the rest of the site's header, then the pages it opens from elsewhere
    /// (champions from the tier lists, My Stats behind the account button).
    public static let more: [SiteTab] = [
        SiteTab(id: "kitchen", title: "The Kitchen", symbol: "frying.pan.fill", path: "/kitchen"),
        SiteTab(id: "patches", title: "Patch Recaps", symbol: "doc.text.fill", path: "/patches"),
        SiteTab(id: "champions", title: "Champions", symbol: "person.2.fill", path: "/champions"),
        SiteTab(id: "info", title: "Info", symbol: "book.fill", path: "/info"),
        SiteTab(id: "account", title: "Account", symbol: "person.crop.circle", path: "/account"),
    ]

    public static let legal: [SiteTab] = [
        SiteTab(id: "privacy", title: "Privacy", symbol: "hand.raised.fill", path: "/privacy"),
        SiteTab(id: "terms", title: "Terms", symbol: "doc.plaintext", path: "/terms"),
    ]
}
