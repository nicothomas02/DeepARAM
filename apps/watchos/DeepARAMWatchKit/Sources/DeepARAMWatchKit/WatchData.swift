import Foundation

/// Everything the watch shows, in the shape of the site's /data/watch.json.
public struct WatchData: Codable, Equatable, Sendable {
    /// Live patch as players name it, like "26.21".
    public var patch: String?
    public var chefsSpecial: ChefsSpecial?
    public var champions: [Champion]

    public init(patch: String? = nil, chefsSpecial: ChefsSpecial? = nil, champions: [Champion] = []) {
        self.patch = patch
        self.chefsSpecial = chefsSpecial
        self.champions = champions
    }

    public func champion(_ id: String) -> Champion? {
        champions.first { $0.id == id }
    }

    /// Champions whose name starts with or contains the search text, best matches first.
    public func search(_ text: String) -> [Champion] {
        let q = text.trimmingCharacters(in: .whitespaces).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        guard !q.isEmpty else { return champions }
        let key = { (c: Champion) in c.name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) }
        let starts = champions.filter { key($0).hasPrefix(q) }
        let contains = champions.filter { !key($0).hasPrefix(q) && key($0).contains(q) }
        return starts + contains
    }
}

/// One champion's quick reference: what to max, what to buy, which augments to take.
public struct Champion: Codable, Equatable, Identifiable, Hashable, Sendable {
    /// The site's champion id, like "MissFortune". Also names the icon (/icons/champions/<id>.webp).
    public var id: String
    public var name: String
    /// Live-patch tier, like "S". Missing when the champion has too few games.
    public var tier: String?
    public var winRate: Double?
    /// The Tier List's 0-100 rating.
    public var deepScore: Double?
    /// Skill max order, like ["Q", "E", "W"].
    public var skills: [String]
    /// Best summoner spell pair, like ["Flash", "Mark"].
    public var spells: [String]
    /// Boots, the best core, then the best 4th, 5th and 6th item (the champion page's quick build).
    public var items: [String]
    /// Top augments by rarity, best DeepScore first.
    public var augments: Augments

    public init(id: String, name: String, tier: String? = nil, winRate: Double? = nil, deepScore: Double? = nil, skills: [String] = [], spells: [String] = [], items: [String] = [], augments: Augments = Augments()) {
        self.id = id
        self.name = name
        self.tier = tier
        self.winRate = winRate
        self.deepScore = deepScore
        self.skills = skills
        self.spells = spells
        self.items = items
        self.augments = augments
    }

    private enum CodingKeys: String, CodingKey { case id, name, tier, winRate, deepScore, skills, spells, items, augments }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        tier = try c.decodeIfPresent(String.self, forKey: .tier)
        winRate = try c.decodeIfPresent(Double.self, forKey: .winRate)
        deepScore = try c.decodeIfPresent(Double.self, forKey: .deepScore)
        skills = try c.decodeIfPresent([String].self, forKey: .skills) ?? []
        spells = try c.decodeIfPresent([String].self, forKey: .spells) ?? []
        items = try c.decodeIfPresent([String].self, forKey: .items) ?? []
        augments = try c.decodeIfPresent(Augments.self, forKey: .augments) ?? Augments()
    }

    public var iconURL: URL { WatchFeed.url("/icons/champions/\(id).webp") }
}

public struct Augments: Codable, Equatable, Hashable, Sendable {
    public var prismatic: [String]
    public var gold: [String]
    public var silver: [String]

    public init(prismatic: [String] = [], gold: [String] = [], silver: [String] = []) {
        self.prismatic = prismatic
        self.gold = gold
        self.silver = silver
    }

    public var isEmpty: Bool { prismatic.isEmpty && gold.isEmpty && silver.isEmpty }

    /// Rarity name and its augments, highest rarity first, skipping empty ones.
    public var byRarity: [(rarity: String, names: [String])] {
        [("Prismatic", prismatic), ("Gold", gold), ("Silver", silver)].filter { !$0.1.isEmpty }
    }
}

/// The Kitchen's Chef Special: one unusual build a day.
public struct ChefsSpecial: Codable, Equatable, Sendable {
    public var title: String
    /// The day it was cooked, like "2026-10-26".
    public var date: String?
    /// Champion id, like "Janna".
    public var champion: String
    public var name: String
    /// The Kitchen's verdict, like "Secretly strong".
    public var tier: String?
    /// Why it works.
    public var why: String?
    public var play: String?
    public var items: [String]
    public var augments: [Augment]

    public struct Augment: Codable, Equatable, Hashable, Sendable {
        public var name: String
        public var rarity: String

        public init(name: String, rarity: String) {
            self.name = name
            self.rarity = rarity
        }
    }

    public init(title: String, date: String? = nil, champion: String, name: String, tier: String? = nil, why: String? = nil, play: String? = nil, items: [String] = [], augments: [Augment] = []) {
        self.title = title
        self.date = date
        self.champion = champion
        self.name = name
        self.tier = tier
        self.why = why
        self.play = play
        self.items = items
        self.augments = augments
    }

    public var iconURL: URL { WatchFeed.url("/icons/champions/\(champion).webp") }
}
