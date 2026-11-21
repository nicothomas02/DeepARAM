import Foundation
import Security

/// What the iPhone widgets show: the owner's week, a tip for the next game, and their champions on the live patch.
/// Served privately by https://deeparam.com/api/widget (web/src/lib/widget-summary.ts) to a widget token.
public struct WidgetSummary: Codable, Equatable, Sendable {
    public struct Indicator: Codable, Equatable, Sendable, Identifiable {
        public let key: String
        public let label: String
        public let unit: String
        public let week: Double
        public let usual: Double?
        /// True when the week is at or better than usual; nil with nothing to compare.
        public let better: Bool?
        public var id: String { key }
    }

    public struct Week: Codable, Equatable, Sendable {
        public let from: Double
        public let games: Int
        public let wins: Int
        public let losses: Int
        public let indicators: [Indicator]
    }

    public struct Tip: Codable, Equatable, Sendable {
        public let title: String
        public let body: String
        public let key: String?
    }

    public struct Champion: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let tier: String
        public let deepScore: Int
        public let games: Int
        public let change: Int?
        public let tierBefore: String?
        public let notes: [String]
    }

    public struct Patch: Codable, Equatable, Sendable {
        public let live: String?
        public let champions: [Champion]
    }

    public let updated: Double
    public let week: Week
    public let tip: Tip
    public let patch: Patch
    /// The live game while the owner's PC app is sending one.
    public var live: LiveGame? = nil

    public var updatedDate: Date { Date(timeIntervalSince1970: updated / 1000) }

    public static func decode(_ data: Data) throws -> WidgetSummary {
        try JSONDecoder().decode(WidgetSummary.self, from: data)
    }

    /// Shown in widget previews and the gallery: made-up numbers, never real games.
    public static let preview = WidgetSummary(
        updated: Date().timeIntervalSince1970 * 1000,
        week: Week(from: 0, games: 14, wins: 9, losses: 5, indicators: [
            Indicator(key: "deaths", label: "Deaths per 10 min", unit: "", week: 2.6, usual: 2.2, better: false),
            Indicator(key: "damage", label: "Damage per min", unit: "", week: 2140, usual: 1980, better: true),
            Indicator(key: "kp", label: "Kill share", unit: "%", week: 58, usual: 55, better: true),
        ]),
        tip: Tip(title: "Stay alive longer", body: "2.6 deaths per 10 min lately, 2.2 usual. Every death is time out of fights.", key: "deaths"),
        patch: Patch(live: "26.23", champions: [
            Champion(id: "Ahri", name: "Ahri", tier: "A", deepScore: 64, games: 9, change: 3, tierBefore: "A", notes: []),
            Champion(id: "Brand", name: "Brand", tier: "S", deepScore: 77, games: 6, change: -2, tierBefore: "S", notes: ["W damage lowered"]),
            Champion(id: "Jayce", name: "Jayce", tier: "B", deepScore: 51, games: 4, change: nil, tierBefore: nil, notes: []),
        ])
    )
}

/// Where the app and its widgets share the widget token (keychain) and the last summary (App Group container),
/// and the calls to /api/widget. The token only reads this summary; nothing else about the account.
public enum WidgetStore {
    /// Shared by the app and the widget extension (both targets' entitlements).
    public static let appGroup = "group.com.deeparam.app"
    public static let endpoint = Site.url("/api/widget")
    /// The widget extension's kinds, so the app can reload them.
    public static let kinds = ["weekly", "tip", "patch"]

    public enum Failure: Error, Equatable {
        case notConnected
        case signedOut
        case server(String)
    }

    // MARK: Token (keychain, shared through the App Group)

    private static let service = "com.deeparam.app.widgets"

    private static func query() -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "token"]
        #if !targetEnvironment(simulator)
        q[kSecAttrAccessGroup as String] = appGroup
        #endif
        return q
    }

    public static var token: String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func setToken(_ token: String?) {
        SecItemDelete(query() as CFDictionary)
        guard let token else {
            defaults.removeObject(forKey: cacheKey)
            return
        }
        var q = query()
        q[kSecValueData as String] = Data(token.utf8)
        // Widgets refresh while the phone is locked on a stand, so the token must be readable after first unlock.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    public static var isConnected: Bool { token != nil }

    // MARK: Last summary (so widgets still show something offline)

    private static let cacheKey = "widgetSummary"
    private static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    public static var cached: WidgetSummary? {
        defaults.data(forKey: cacheKey).flatMap { try? WidgetSummary.decode($0) }
    }

    // MARK: Network

    /// Trades the app's sign-in cookies (from its web view) for a widget token and keeps it.
    public static func connect(cookies: [HTTPCookie], device: String) async throws {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpShouldHandleCookies = false
        HTTPCookie.requestHeaderFields(with: cookies.filter { $0.domain.lowercased().hasSuffix(Site.host) })
            .forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        req.httpBody = try JSONSerialization.data(withJSONObject: ["device": device])
        let (data, resp) = try await URLSession.shared.data(for: req)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (resp as? HTTPURLResponse)?.statusCode == 200, let token = obj?["token"] as? String else {
            throw Failure.server(obj?["error"] as? String ?? "Couldn't connect the widgets. Try again.")
        }
        setToken(token)
        _ = try? await refresh()
    }

    /// Forgets the token here and on the site.
    public static func disconnect() async {
        if let token {
            var req = URLRequest(url: endpoint)
            req.httpMethod = "DELETE"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: req)
        }
        setToken(nil)
    }

    /// Tells the site where Apple should push the live game: kind "start" (push-to-start) or "activity" (the running
    /// Live Activity). nil forgets it. The owner's PC app reads these back and sends the pushes.
    public static func registerPush(kind: String, token: Data?) async {
        guard let auth = self.token else { return }
        var req = URLRequest(url: Site.url("/api/widget/push"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        #if DEBUG
        let sandbox = true // Xcode builds get development pushes; TestFlight and the App Store production ones
        #else
        let sandbox = false
        #endif
        var hex: Any = NSNull()
        if let token { hex = token.map { String(format: "%02x", $0) }.joined() }
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["kind": kind, "token": hex, "sandbox": sandbox])
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Fetches the latest summary and caches it. Throws .notConnected without a token and .signedOut when the site refuses it.
    @discardableResult
    public static func refresh() async throws -> WidgetSummary {
        guard let token else { throw Failure.notConnected }
        var req = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw Failure.signedOut }
        guard status == 200 else { throw Failure.server("DeepARAM didn't answer (\(status)).") }
        let summary = try WidgetSummary.decode(data)
        defaults.set(data, forKey: cacheKey)
        return summary
    }
}
