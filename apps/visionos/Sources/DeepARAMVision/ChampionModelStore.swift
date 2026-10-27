#if os(visionOS)
import Foundation

/// Loads the list of 3D champions once per launch, and downloads each model the first time it's
/// opened. Both are kept in Caches, so the volumes open offline after the first time.
@MainActor
public final class ChampionModelStore: ObservableObject {
    public static let shared = ChampionModelStore()

    @Published public private(set) var models: ChampionModels?
    private var loading = false

    private let folder: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChampionModels", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    private var listFile: URL { folder.appendingPathComponent("models-usdz.json") }

    /// Shows the saved list straight away, then refreshes it from the site.
    public func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if models == nil, let saved = try? Data(contentsOf: listFile) {
            models = try? ChampionModels(json: saved)
        }
        guard let (data, response) = try? await URLSession.shared.data(from: ChampionModels.listURL),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let fresh = try? ChampionModels(json: data) else { return }
        if fresh != models {
            // A new list means new models (a patch); drop the old downloads.
            if models != nil { clearDownloads() }
            models = fresh
        }
        try? data.write(to: listFile, options: .atomic)
    }

    /// A local copy of the model, downloading it if it isn't saved yet.
    func file(for model: ChampionModels.Model) async throws -> URL {
        let local = folder.appendingPathComponent(model.id.lowercased() + ".usdz")
        if FileManager.default.fileExists(atPath: local.path) { return local }
        let (temp, response) = try await URLSession.shared.download(from: model.url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        try? FileManager.default.removeItem(at: local)
        try FileManager.default.moveItem(at: temp, to: local)
        return local
    }

    private func clearDownloads() {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.pathExtension == "usdz" { try? FileManager.default.removeItem(at: file) }
    }
}
#endif
