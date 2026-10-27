import Foundation

/// Preferences stored in UserDefaults and edited in the Settings window.
enum AppSettings {
    enum Key {
        static let notifyLive = "notifyLivePatch"
        static let notifyPbe = "notifyPbePatch"
        static let saveOffline = "saveSectionsOffline"
        static let reopenLastPage = "reopenLastPage"
        static let pageZoom = "pageZoom"
        static let showMenuBar = "showMenuBarLookup"
    }

    static func register() {
        UserDefaults.standard.register(defaults: [
            Key.notifyLive: true,
            Key.notifyPbe: true,
            Key.saveOffline: true,
            Key.reopenLastPage: true,
            Key.pageZoom: 1.0,
            Key.showMenuBar: true,
        ])
    }

    static var notifyLive: Bool { UserDefaults.standard.bool(forKey: Key.notifyLive) }
    static var notifyPbe: Bool { UserDefaults.standard.bool(forKey: Key.notifyPbe) }
    static var saveOffline: Bool { UserDefaults.standard.bool(forKey: Key.saveOffline) }
    static var reopenLastPage: Bool { UserDefaults.standard.bool(forKey: Key.reopenLastPage) }
    static var pageZoom: CGFloat {
        get {
            let z = UserDefaults.standard.double(forKey: Key.pageZoom)
            return z > 0 ? CGFloat(z) : 1
        }
        set { UserDefaults.standard.set(Double(newValue), forKey: Key.pageZoom) }
    }
}
