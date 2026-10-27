import Foundation

/// Everything the Apple TV app shows, as served at /data/tv.json (web/src/lib/tv.ts builds it).
public struct TVData: Codable, Equatable, Sendable {
    public var patch: String
    public var champions: [Champion]
    public var augments: [Augment]
    public var chefsSpecial: ChefsSpecial?
    public var pbe: PBE?

    /// An item, augment or champion name with its picture on the site (a path like /icons/...).
    public struct Pictured: Codable, Equatable, Hashable, Sendable {
        public var name: String
        public var icon: String?
    }

    public struct Champion: Codable, Equatable, Identifiable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var icon: String
        public var tier: String?
        public var winRate: Double?
        public var pickRate: Double?
        /// Which ability to max first, second and third.
        public var skills: [String]
        /// Boots first, then the full build.
        public var items: [Pictured]
        /// Best picks per rarity: "prismatic", "gold" and "silver".
        public var augments: [String: [Pictured]]
    }

    public struct Augment: Codable, Equatable, Identifiable, Hashable, Sendable {
        public var name: String
        public var icon: String?
        public var rarity: String
        public var tier: String
        public var winRate: Double
        public var pickRate: Double
        public var id: String { rarity + ":" + name }
    }

    public struct ChefsSpecial: Codable, Equatable, Sendable {
        public var title: String
        public var date: String?
        public var champion: String
        public var name: String
        public var icon: String
        public var why: String
        public var play: String?
        public var items: [Pictured]
        public var augments: [SpecialAugment]

        public struct SpecialAugment: Codable, Equatable, Hashable, Sendable {
            public var name: String
            public var rarity: String
            public var core: Bool
            public var icon: String?
        }
    }

    public struct PBE: Codable, Equatable, Sendable {
        public var label: String
        public var dataAsOf: String
        public var caveat: String
        public var augmentPool: Pool
        public var augments: AugmentChanges
        public var championChanges: [ChampionChange]
        public var itemChanges: [ItemChange]
        public var modeChanges: [String]

        public struct Pool: Codable, Equatable, Sendable {
            public var live: Int
            public var pbe: Int
        }

        public struct AugmentChanges: Codable, Equatable, Sendable {
            public var added: [Added]
            public var removed: [Removed]
            public var changed: [Changed]
        }

        public struct Added: Codable, Equatable, Hashable, Sendable {
            public var name: String
            public var rarity: String
            public var description: String?
            public var icon: String?
        }

        public struct Removed: Codable, Equatable, Hashable, Sendable {
            public var name: String
            public var rarity: String
            public var icon: String?
        }

        public struct Changed: Codable, Equatable, Hashable, Sendable {
            public var name: String
            public var rarity: String?
            /// "buff", "nerf", "mixed", "none" or "unclear".
            public var direction: String?
            public var changes: [Stat]
            public var icon: String?
        }

        public struct Stat: Codable, Equatable, Hashable, Sendable {
            public var stat: String
            public var live: String
            public var pbe: String
        }

        public struct ChampionChange: Codable, Equatable, Hashable, Sendable {
            public var champion: String
            public var changes: [String]
        }

        public struct ItemChange: Codable, Equatable, Hashable, Sendable {
            public var item: String
            public var changes: [String]
        }
    }
}

public enum Tiers {
    /// The tier letters from best to worst, as the site's Tier List shows them.
    public static let order = ["S+", "S", "A", "B", "C", "D", "E", "F"]
    public static let rarities = ["prismatic", "gold", "silver"]

    /// Groups rows by tier, best tier first; each tier keeps the order it was given.
    public static func grouped<T>(_ rows: [T], tier: (T) -> String?) -> [(tier: String, rows: [T])] {
        var groups: [String: [T]] = [:]
        for r in rows { if let t = tier(r), !t.isEmpty { groups[t, default: []].append(r) } }
        let rank = { (t: String) in order.firstIndex(of: t) ?? order.count }
        return groups.keys.sorted { rank($0) == rank($1) ? $0 < $1 : rank($0) < rank($1) }.map { ($0, groups[$0]!) }
    }

    /// Champions by tier, each tier sorted by win rate.
    public static func champions(_ list: [TVData.Champion]) -> [(tier: String, rows: [TVData.Champion])] {
        grouped(list.sorted { ($0.winRate ?? 0) > ($1.winRate ?? 0) }, tier: \.tier)
    }

    /// One rarity's augments by tier, each tier sorted by win rate.
    public static func augments(_ list: [TVData.Augment], rarity: String) -> [(tier: String, rows: [TVData.Augment])] {
        grouped(list.filter { $0.rarity == rarity }.sorted { $0.winRate > $1.winRate }, tier: { $0.tier })
    }

    public static func percent(_ rate: Double?) -> String {
        guard let rate else { return "–" }
        return String(format: "%.1f%%", rate * 100)
    }
}
