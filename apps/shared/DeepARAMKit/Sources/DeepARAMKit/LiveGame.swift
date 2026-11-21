import Foundation
#if os(iOS) && canImport(ActivityKit)
import ActivityKit
#endif

/// The owner's live Mayhem game, as the owner's PC app reports it (web/src/lib/widget-live.ts). The widgets get it in
/// the /api/widget summary; the Live Activity gets it from the pushes the PC app sends through Apple.
public struct LiveGame: Codable, Hashable, Sendable {
    public var champion: String
    public var championId: String
    /// When the game clock read 0:00, ms since 1970.
    public var startedAt: Double
    public var level: Int
    public var kills: Int
    public var deaths: Int
    public var assists: Int
    /// The next augment level (1, 7, 11, 15), nil after the last.
    public var nextAugment: Int?
    public var augmentReady: Bool
    public var nextItems: [String]
    /// The owner's own predicted chance to win, 0-1.
    public var winChance: Double?
    public var dead: Bool

    public init(champion: String, championId: String, startedAt: Double, level: Int, kills: Int, deaths: Int, assists: Int,
                nextAugment: Int?, augmentReady: Bool, nextItems: [String], winChance: Double?, dead: Bool) {
        self.champion = champion
        self.championId = championId
        self.startedAt = startedAt
        self.level = level
        self.kills = kills
        self.deaths = deaths
        self.assists = assists
        self.nextAugment = nextAugment
        self.augmentReady = augmentReady
        self.nextItems = nextItems
        self.winChance = winChance
        self.dead = dead
    }

    public var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
    public var kda: String { "\(kills)/\(deaths)/\(assists)" }
    public var winPercent: String? { winChance.map { "\(Int(($0 * 100).rounded()))%" } }

    /// The one line that matters most right now.
    public var headline: String {
        if augmentReady { return "Augment pick ready" }
        if dead, let item = nextItems.first { return "Dead: buy \(item)" }
        if let item = nextItems.first { return "Next: \(item)" }
        if let next = nextAugment { return "Next augment at level \(next)" }
        return "Level \(level)"
    }

    public static let preview = LiveGame(champion: "Wukong", championId: "MonkeyKing", startedAt: (Date().timeIntervalSince1970 - 612) * 1000,
                                         level: 11, kills: 6, deaths: 3, assists: 14, nextAugment: 11, augmentReady: true,
                                         nextItems: ["Sterak's Gage", "Death's Dance"], winChance: 0.61, dead: false)
}

#if os(iOS) && canImport(ActivityKit)
/// The Live Activity for a game: Lock Screen, Dynamic Island and StandBy. Started and updated by pushes from the
/// owner's PC app; the push names this type ("attributes-type": "LiveGameAttributes").
public struct LiveGameAttributes: ActivityAttributes {
    public typealias ContentState = LiveGame
    public var champion: String
    public init(champion: String) { self.champion = champion }
}
#endif
