import DeepARAMKit
import Foundation

/// A sidebar group: the main tabs, then the site's More menu, then the account.
struct PadGroup: Identifiable {
    let title: String?
    let sections: [SiteTab]
    var id: String { title ?? "main" }
}

/// A sub-tab of a section page, opened with ?tab=<id> (the site's sub-tab bar reads it).
struct PadSubtab: Identifiable, Hashable {
    let id: String
    let title: String
}

extension SiteTab {
    // The sidebar follows the site's header: Tier List, Simulator, The Kitchen, then More.
    // Ids match DeepARAMKit's where it has the same page, so saved windows restore.
    static let padHome = SiteTab(id: "home", title: "Home", symbol: "house.fill", path: "/")
    static let padTierList = SiteTab(id: "tiers", title: "Tier List", symbol: "chart.bar.fill", path: "/tier-list")
    static let padSimulator = SiteTab(id: "simulator", title: "Simulator", symbol: "bolt.fill", path: "/simulator")
    static let padKitchen = SiteTab(id: "kitchen", title: "The Kitchen", symbol: "fork.knife", path: "/kitchen")
    static let padPBE = SiteTab(id: "pbe", title: "PBE", symbol: "flask.fill", path: "/pbe")
    static let padPatches = SiteTab(id: "patches", title: "Patches", symbol: "doc.text.fill", path: "/patches")
    static let padInfo = SiteTab(id: "info", title: "Info", symbol: "book.fill", path: "/info")
    static let padChampions = SiteTab(id: "champions", title: "Champions", symbol: "square.grid.3x3.fill", path: "/champions")
    static let padAccount = SiteTab(id: "account", title: "Account", symbol: "person.crop.circle", path: "/account")

    static let padGroups: [PadGroup] = [
        PadGroup(title: nil, sections: [.padHome, .padTierList, .padSimulator, .padKitchen]),
        PadGroup(title: "More", sections: [.padPBE, .padPatches, .padInfo, .padChampions]),
        PadGroup(title: "You", sections: [.padAccount]),
    ]

    /// Every section, in the order the sidebar lists them.
    static let padSections: [SiteTab] = padGroups.flatMap(\.sections)

    /// Sections from older versions of the app that moved on the site.
    private static let renamed = ["lab": "kitchen", "stats": "account"]

    static func padSection(id: String?) -> SiteTab? {
        guard let id else { return nil }
        let current = renamed[id] ?? id
        return padSections.first { $0.id == current }
    }

    /// The sidebar section a site link belongs to, matched on its path.
    static func padSection(for url: URL) -> SiteTab? {
        guard Site.isInternal(url) else { return nil }
        let path = url.path.isEmpty ? "/" : url.path
        return padSections.last { $0.path == "/" ? path == "/" : (path == $0.path || path.hasPrefix($0.path + "/")) }
    }

    /// The page's own sub-tabs, listed under the section while it is selected.
    var padSubtabs: [PadSubtab] {
        switch id {
        case Self.padTierList.id:
            return [.init(id: "champions", title: "Champions"), .init(id: "augments", title: "Augments"),
                    .init(id: "items", title: "Items"), .init(id: "weapon-of-destiny", title: "Weapon of Destiny"),
                    .init(id: "pentakill", title: "Pentakill")]
        case Self.padSimulator.id:
            return [.init(id: "replays", title: "1v1"), .init(id: "2v2", title: "2v2"),
                    .init(id: "teamfight", title: "Teamfight"), .init(id: "builds", title: "Simulated builds")]
        case Self.padKitchen.id:
            return [.init(id: "chef-specials", title: "Chef Specials"), .init(id: "infinite-ryze", title: "Infinite Ryze")]
        default:
            return []
        }
    }

    func url(subtab: PadSubtab) -> URL {
        // The first sub-tab is the page's default, so it gets the plain address.
        subtab == padSubtabs.first ? url : Site.url(path + "?tab=" + subtab.id)
    }

    /// The sub-tab `url` shows: its ?tab=, or the first one.
    func subtab(in url: URL?) -> PadSubtab? {
        guard let url, url.path == path || (path == "/" && url.path.isEmpty) else { return nil }
        let want = URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems?.first { $0.name == "tab" }?.value
        return padSubtabs.first { $0.id == want } ?? padSubtabs.first
    }

    /// A page that isn't a section, such as one champion.
    static func page(_ path: String, title: String) -> SiteTab {
        SiteTab(id: "page:" + path, title: title, symbol: "doc", path: path)
    }
}

enum Champion {
    static func path(_ alias: String) -> String { "/champions/\(alias)" }
    static func url(_ alias: String) -> URL { Site.url(path(alias)) }

    /// The alias in a /champions/<alias> link, if it is one.
    static func alias(in url: URL) -> String? {
        guard Site.isInternal(url) else { return nil }
        let parts = url.path.split(separator: "/")
        guard parts.count == 2, parts[0] == "champions" else { return nil }
        return String(parts[1])
    }
}
