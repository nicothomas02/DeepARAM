import Foundation

/// The live patch's quick reference for every champion (tier, win rate, skill order, items, augments)
/// plus today's Chef Special, from /data/watch.json. Small enough to keep whole and search on device.
public struct QuickBuilds: Codable, Equatable, Sendable {
    public var patch: String
    public var chefsSpecial: ChefSpecial?
    public var champions: [Champion]

    public struct Champion: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var name: String
        public var tier: String?
        public var winRate: Double?
        public var skills: [String]
        public var items: [String]
        public var augments: Augments

        public var url: URL { Site.url("/champions/\(id)") }
        /// "Q > E > W"
        public var skillOrder: String { skills.joined(separator: " > ") }
    }

    public struct Augments: Codable, Equatable, Sendable {
        public var prismatic: [String]
        public var gold: [String]
        public var silver: [String]
    }

    public struct ChefSpecial: Codable, Equatable, Sendable {
        public var title: String
        public var champion: String
        public var name: String
        public var tier: String?
        public var play: String?
        public var items: [String]
        public var augments: [Augment]

        public struct Augment: Codable, Equatable, Sendable {
            public var name: String
            public var rarity: String
        }
    }

    /// The patch as the site shows it ("16.21" -> "26.21").
    public var patchName: String { Site.patchName(patch) }

    /// Champions whose name starts with the query come first, then any name containing it.
    /// Accents, spaces and punctuation are ignored, so "kaisa" finds Kai'Sa and "jarvan" finds Jarvan IV.
    public func search(_ query: String) -> [Champion] {
        let q = Self.fold(query)
        guard !q.isEmpty else { return [] }
        let named = champions.map { ($0, Self.fold($0.name)) }
        let starts = named.filter { $0.1.hasPrefix(q) }.map(\.0)
        let contains = named.filter { !$0.1.hasPrefix(q) && $0.1.contains(q) }.map(\.0)
        return starts + contains
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .filter { $0.isLetter || $0.isNumber }
    }

    public static let url = Site.url("/data/watch.json")

    /// Downloads the latest copy and keeps it, so the last one still works offline.
    public static func fetch(session: URLSession = .shared, cache: URL? = defaultCache) async throws -> QuickBuilds {
        let (data, resp) = try await session.data(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let builds = try JSONDecoder().decode(QuickBuilds.self, from: data)
        if let cache {
            try? FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: cache, options: .atomic)
        }
        return builds
    }

    public static func cached(at cache: URL? = defaultCache) -> QuickBuilds? {
        guard let cache, let data = try? Data(contentsOf: cache) else { return nil }
        return try? JSONDecoder().decode(QuickBuilds.self, from: data)
    }

    public static var defaultCache: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("QuickBuilds.json")
    }
}

extension Site {
    /// The site names patches by year: client version "16.21" is patch "26.21". Public numbers pass through.
    public static func patchName(_ version: String) -> String {
        let parts = version.split(separator: ".").compactMap { Int($0) }
        guard parts.count >= 2 else { return version }
        let major = parts[0] >= 10 && parts[0] < 20 ? parts[0] + 10 : parts[0]
        return "\(major).\(parts[1])"
    }

    /// Turns an app link into the site page it names: deeparam://champions/Ahri -> https://deeparam.com/champions/Ahri.
    /// Site links pass through; anything else is nil.
    public static func pageURL(forAppLink link: URL) -> URL? {
        if isInternal(link), link.scheme?.hasPrefix("http") == true { return link }
        guard link.scheme?.lowercased() == "deeparam" else { return nil }
        // deeparam://champions/Ahri parses "champions" as the host; deeparam:///champions/Ahri doesn't.
        let path = ([link.host].compactMap { $0 } + [link.path]).joined(separator: "/")
            .split(separator: "/").joined(separator: "/")
        var parts = URLComponents()
        parts.path = "/" + path
        parts.query = URLComponents(url: link, resolvingAgainstBaseURL: false)?.query
        parts.fragment = link.fragment
        return parts.url(relativeTo: base)?.absoluteURL
    }
}
