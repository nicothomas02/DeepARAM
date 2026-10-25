import DeepARAMKit
#if os(visionOS)
import DeepARAMVision
#else
import DeepARAMPad
#endif
import SwiftUI

@main
struct DeepARAMApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        #if os(visionOS)
        // Apple Vision Pro: the layout from apps/visionos, and any page can open in its own window.
        WindowGroup {
            VisionRootView(openNotification: PatchAlerts.openPage) { PatchAlertsSection() }
                .tint(Theme.accent)
        }
        .defaultSize(width: 1280, height: 860)
        .onChange(of: scenePhase) { _, phase in phaseChanged(phase) }

        WindowGroup("Page", id: VisionPageWindow.id, for: URL.self) { $url in
            VisionPageWindow(url: url)
                .tint(Theme.accent)
        }
        .defaultSize(width: 1000, height: 800)
        #else
        WindowGroup {
            Group {
                // iPads get the sidebar layout from apps/ipados; iPhones the tab bar.
                if UIDevice.current.userInterfaceIdiom == .pad { PadRootView() } else { RootView() }
            }
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
        }
        .commands { PadCommands() }
        .onChange(of: scenePhase) { _, phase in phaseChanged(phase) }

        // iPad: a champion page in a window of its own (Stage Manager, or Split View beside another app).
        WindowGroup("Champion", id: PadChampionWindow.id, for: String.self) { $alias in
            PadChampionWindow(alias: alias)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        #endif
    }

    private func phaseChanged(_ phase: ScenePhase) {
        if phase == .background { PatchAlerts.shared.scheduleRefresh() }
        if phase == .active { Task { await PatchAlerts.shared.checkNow() } }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PatchAlerts.shared.register()
        return true
    }
}
