import DeepARAMKit
import Foundation

/// The champions that have a 3D model for Apple Vision Pro: the site's base models (no skins) as
/// USDZ files, listed in /assets/models/models-usdz.json (built by apps/visionos/tools/build_usdz.py).
public struct ChampionModels: Equatable, Sendable {
    public struct Model: Equatable, Sendable, Identifiable {
        /// The champion's id, as in its page's address ("MonkeyKing" for /champions/MonkeyKing).
        public let id: String
        public let name: String
        /// Where the USDZ file is on the site.
        public let url: URL
    }

    public static let listURL = Site.url("/assets/models/models-usdz.json")

    /// Sorted by display name.
    public let all: [Model]
    private let byKey: [String: Model]

    public init(json: Data) throws {
        struct Entry: Decodable { let file: String; let name: String? }
        let entries = try JSONDecoder().decode([String: Entry].self, from: json)
        let base = Site.url("/assets/models/")
        all = entries.compactMap { id, entry in
            guard let url = URL(string: entry.file, relativeTo: base)?.absoluteURL else { return nil }
            return Model(id: id, name: entry.name ?? id, url: url)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        byKey = Dictionary(all.map { (Self.key($0.id), $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// The model for a champion id, ignoring case.
    public func model(for id: String) -> Model? { byKey[Self.key(id)] }

    /// The model for a champion page ("/champions/ahri", also with a #section or ?query).
    public func model(forPage url: URL) -> Model? {
        Self.championID(for: url).flatMap(model(for:))
    }

    /// The champion id in a champion page's address, or nil for any other page.
    public static func championID(for url: URL) -> String? {
        guard Site.isInternal(url) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "champions", !parts[1].isEmpty else { return nil }
        return parts[1]
    }

    private static func key(_ id: String) -> String {
        id.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}
