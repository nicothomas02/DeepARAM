import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Loads the watch's data from the site and keeps the last copy on the watch.
///
/// Reads /data/watch.json, which the site rebuilds on every deploy.
public struct WatchFeed: Sendable {
    public static let base = URL(string: "https://deeparam.com")!

    public static func url(_ path: String) -> URL {
        URL(string: path, relativeTo: base)!.absoluteURL
    }

    /// A saved copy and when it was fetched.
    public struct Saved: Codable, Equatable, Sendable {
        public var data: WatchData
        public var savedAt: Date
    }

    public let session: URLSession
    public let cacheFile: URL

    public init(session: URLSession = .shared, cacheFile: URL = WatchFeed.defaultCacheFile) {
        self.session = session
        self.cacheFile = cacheFile
    }

    public static var defaultCacheFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("watch-data.json")
    }

    /// Fetches fresh data and saves it.
    public func refresh() async throws -> Saved {
        let saved = Saved(data: try await fetch(), savedAt: Date())
        save(saved)
        return saved
    }

    public func fetch() async throws -> WatchData {
        let w = try JSONDecoder().decode(WatchData.self, from: try await get("/data/watch.json"))
        guard !w.champions.isEmpty else { throw URLError(.cannotParseResponse) }
        return w
    }

    public func load() -> Saved? {
        guard let data = try? Data(contentsOf: cacheFile) else { return nil }
        return try? JSONDecoder().decode(Saved.self, from: data)
    }

    public func save(_ saved: Saved) {
        try? FileManager.default.createDirectory(at: cacheFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(saved) { try? data.write(to: cacheFile, options: .atomic) }
    }

    private func get(_ path: String) async throws -> Data {
        let (data, resp) = try await session.data(from: Self.url(path))
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }
}

/// Riot's required notice. Same words as the site footer and the phone app (Legal in DeepARAMKit).
public enum Legal {
    public static let riotNotice = "DeepARAM isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."
}
