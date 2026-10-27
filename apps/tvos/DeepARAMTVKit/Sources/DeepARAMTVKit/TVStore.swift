import Combine
import DeepARAMKit
import Foundation

/// Loads /data/tv.json, keeps the last good copy on disk and shows it while offline or loading.
@MainActor
public final class TVStore: ObservableObject {
    public enum State: Equatable {
        case loading
        case ready
        /// Nothing saved and the site can't be reached.
        case failed
    }

    @Published public private(set) var data: TVData?
    @Published public private(set) var state: State = .loading
    /// Set while the data on screen is the saved copy; holds when it was saved.
    @Published public private(set) var savedCopyDate: Date?

    public nonisolated static let path = "/data/tv.json"
    private let session: URLSession
    private let file: URL
    private var lastLoad: Date?

    public init(session: URLSession = .shared, folder: URL? = nil) {
        self.session = session
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        file = (folder ?? caches).appendingPathComponent("tv.json")
        if let saved = try? Data(contentsOf: file), let d = try? Self.decode(saved) {
            data = d
            savedCopyDate = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date
            state = .ready
        }
    }

    public nonisolated static func decode(_ bytes: Data) throws -> TVData {
        try JSONDecoder().decode(TVData.self, from: bytes)
    }

    /// The full address of a picture path from the data.
    public nonisolated static func url(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return Site.url(path)
    }

    /// Fetches fresh data. `force` skips the ten-minute pause between loads.
    public func refresh(force: Bool = false) async {
        if !force, let lastLoad, Date().timeIntervalSince(lastLoad) < 600 { return }
        do {
            var req = URLRequest(url: Site.url(Self.path))
            req.cachePolicy = .reloadRevalidatingCacheData
            let (bytes, resp) = try await session.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let d = try Self.decode(bytes)
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? bytes.write(to: file, options: .atomic)
            data = d
            savedCopyDate = nil
            lastLoad = Date()
            state = .ready
        } catch {
            if data == nil { state = .failed }
        }
    }
}
