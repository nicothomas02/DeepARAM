import DeepARAMKit
import DeepARAMPad
import SwiftUI

@main
struct DeepARAMApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                // iPads get the sidebar layout from apps/ipados; iPhones the tab bar.
                if UIDevice.current.userInterfaceIdiom == .pad { PadRootView() } else { RootView() }
            }
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
        }
        .commands { PadCommands() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { PatchAlerts.shared.scheduleRefresh() }
            if phase == .active { Task { await PatchAlerts.shared.checkNow() } }
        }

        // iPad: a champion page in a window of its own (Stage Manager, or Split View beside another app).
        WindowGroup("Champion", id: PadChampionWindow.id, for: String.self) { $alias in
            PadChampionWindow(alias: alias)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PatchAlerts.shared.register()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Home Screen quick actions (press and hold the app icon). Each one's type is the page's path,
/// set in Info.plist; the root view opens it in the tab it belongs to.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let item = connectionOptions.shortcutItem { Self.open(item) }
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(Self.open(shortcutItem))
    }

    @discardableResult
    private static func open(_ item: UIApplicationShortcutItem) -> Bool {
        guard item.type.hasPrefix("/") else { return false }
        let url = Site.url(item.type)
        Task { @MainActor in AppLinks.shared.open(url) }
        return true
    }
}
