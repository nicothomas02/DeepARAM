import DeepARAMKit
import SwiftUI

struct SettingsView: View {
    @AppStorage(AppSettings.Key.notifyLive) private var notifyLive = true
    @AppStorage(AppSettings.Key.notifyPbe) private var notifyPbe = true
    @AppStorage(AppSettings.Key.saveOffline) private var saveOffline = true
    @AppStorage(AppSettings.Key.reopenLastPage) private var reopenLastPage = true
    @AppStorage(AppSettings.Key.showMenuBar) private var showMenuBar = true
    @State private var status = ""

    var body: some View {
        Form {
            Section("Notifications") {
                Toggle("Tell me when a new patch goes live", isOn: $notifyLive)
                Toggle("Tell me when the PBE gets a new patch", isOn: $notifyPbe)
                HStack {
                    Button("Check now") {
                        PatchNotifier.shared.check()
                        status = "Checked. You'll get a notification if there's a new patch."
                    }
                    if let live = UserDefaults.standard.string(forKey: PatchWatcher.patchKey) {
                        Text("Live patch \(live)").foregroundStyle(.secondary)
                    }
                }
            }
            Section("Offline") {
                Toggle("Save the main sections for offline use", isOn: $saveOffline)
                HStack {
                    Button("Save now") {
                        OfflineSaver.shared.save()
                        status = "Saving the main sections in the background."
                    }
                    .disabled(!saveOffline)
                    Button("Clear saved pages") {
                        OfflineSaver.shared.clear()
                        status = "Saved pages cleared."
                    }
                }
            }
            Section("Windows") {
                Toggle("Reopen the last section on launch", isOn: $reopenLastPage)
                Toggle("Show champion lookup in the menu bar", isOn: $showMenuBar)
            }
            if !status.isEmpty {
                Text(status).font(.callout).foregroundStyle(.secondary)
            }
            Text(Legal.riotNotice)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .formStyle(.grouped)
        .frame(width: 480)
        .onChange(of: notifyLive) { _, on in if on { Task { _ = await PatchNotifier.shared.requestPermission() } } }
        .onChange(of: notifyPbe) { _, on in if on { Task { _ = await PatchNotifier.shared.requestPermission() } } }
    }
}
