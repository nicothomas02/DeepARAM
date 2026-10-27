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
    public static let tiers = SiteTab(id: "tiers", title: "Tier List", symbol: "chart.bar.fill", path: "/tier-list")
    public static let simulator = SiteTab(id: "simulator", title: "Simulator", symbol: "bolt.fill", path: "/simulator")
    public static let kitchen = SiteTab(id: "kitchen", title: "The Kitchen", symbol: "frying.pan.fill", path: "/kitchen")
    public static let pbe = SiteTab(id: "pbe", title: "PBE", symbol: "flask.fill", path: "/pbe")

    /// The four main tabs, as on the site's phone tab bar; everything else lives under More.
    public static let primary: [SiteTab] = [.home, .tiers, .simulator, .kitchen]

    /// The More menu: the rest of the site's header, then the pages it opens from elsewhere
    /// (champions from the tier lists, My Stats behind the account button).
    public static let more: [SiteTab] = [
        .pbe,
        SiteTab(id: "patches", title: "Patch Recaps", symbol: "doc.text.fill", path: "/patches"),
        SiteTab(id: "info", title: "Info", symbol: "book.fill", path: "/info"),
        SiteTab(id: "champions", title: "Champions", symbol: "person.2.fill", path: "/champions"),
        SiteTab(id: "account", title: "Account & My Stats", symbol: "person.crop.circle", path: "/account"),
    ]

    public static let legal: [SiteTab] = [
        SiteTab(id: "privacy", title: "Privacy", symbol: "hand.raised.fill", path: "/privacy"),
        SiteTab(id: "terms", title: "Terms", symbol: "doc.plaintext", path: "/terms"),
    ]

    /// The tab's own subtabs on the site, for jumping straight to one.
    public var sections: [SiteLink] { SiteLink.sections[id] ?? [] }

    /// The main or More tab a site link belongs to, matched on its path; nil for other sites.
    public static func tab(for url: URL) -> SiteTab? {
        guard Site.isInternal(url) else { return nil }
        let path = url.path.isEmpty ? "/" : url.path
        // My Stats moved onto the account page.
        if path == "/stats" { return more.first { $0.id == "account" } }
        return (primary + more).first { $0.path != "/" && (path == $0.path || path.hasPrefix($0.path + "/")) } ?? (path == "/" ? .home : nil)
    }
}

/// A subtab of a site tab, such as the Weapon of Destiny list on the Tier List.
public struct SiteLink: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let symbol: String
    /// Path with its query, e.g. "/tier-list?tab=pentakill".
    public let path: String

    public var url: URL { Site.url(path) }

    public init(id: String, title: String, symbol: String, path: String) {
        self.id = id
        self.title = title
        self.symbol = symbol
        self.path = path
    }

    /// Subtabs by tab id, in the site's order.
    public static let sections: [String: [SiteLink]] = [
        "tiers": [
            SiteLink(id: "champions", title: "Champions", symbol: "person.2.fill", path: "/tier-list?tab=champions"),
            SiteLink(id: "duos", title: "Duos", symbol: "person.2.circle", path: "/tier-list?tab=champions&cview=duos"),
            SiteLink(id: "augments", title: "Augments", symbol: "sparkles", path: "/tier-list?tab=augments"),
            SiteLink(id: "items", title: "Items", symbol: "shield.lefthalf.filled", path: "/tier-list?tab=items"),
            SiteLink(id: "weapon-of-destiny", title: "Weapon of Destiny", symbol: "wand.and.stars", path: "/tier-list?tab=weapon-of-destiny"),
            SiteLink(id: "pentakill", title: "Pentakill", symbol: "hand.raised.fingers.spread.fill", path: "/tier-list?tab=pentakill"),
        ],
        "simulator": [
            SiteLink(id: "1v1", title: "1v1", symbol: "person.fill", path: "/simulator?tab=replays"),
            SiteLink(id: "2v2", title: "2v2", symbol: "person.2.fill", path: "/simulator?tab=2v2"),
            SiteLink(id: "teamfight", title: "Teamfight", symbol: "person.3.fill", path: "/simulator?tab=teamfight"),
            SiteLink(id: "builds", title: "Simulated builds", symbol: "hammer.fill", path: "/simulator?tab=builds"),
        ],
        "kitchen": [
            SiteLink(id: "chef-specials", title: "Chef Specials", symbol: "frying.pan.fill", path: "/kitchen?tab=chef-specials"),
            SiteLink(id: "infinite-ryze", title: "Infinite Ryze", symbol: "infinity", path: "/kitchen?tab=infinite-ryze"),
        ],
    ]
}
