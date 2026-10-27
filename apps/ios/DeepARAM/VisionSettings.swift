#if os(visionOS)
import SwiftUI

/// The patch alert switch for the Vision Pro More tab (the iPhone has the same one in MoreView).
struct PatchAlertsSection: View {
    @AppStorage(PatchAlerts.enabledKey) private var alertsOn = false
    @State private var alertsDenied = false

    var body: some View {
        Section {
            Toggle(isOn: $alertsOn) { Label("New patch alerts", systemImage: "bell.badge.fill") }
                .onChange(of: alertsOn) { _, on in
                    guard on else { return }
                    Task {
                        let ok = await PatchAlerts.shared.requestPermission()
                        if !ok { alertsOn = false; alertsDenied = true }
                    }
                }
        } footer: {
            Text(alertsDenied ? "Notifications are off for DeepARAM. Turn them on in Settings to get patch alerts." : "Get a notification when a new live patch or PBE update is on DeepARAM.")
        }
    }
}
#endif
