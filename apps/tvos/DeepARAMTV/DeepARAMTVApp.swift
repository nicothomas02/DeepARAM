import DeepARAMTVKit
import SwiftUI

@main
struct DeepARAMTVApp: App {
    @StateObject private var store = TVStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .task { await store.refresh(force: true) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refresh() } }
        }
    }
}
