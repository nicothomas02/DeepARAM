import DeepARAMKit
import SwiftUI

/// The More tab: the site's other pages, patch alerts, and the legal pages and notice.
struct MoreView: View {
    @ObservedObject var pages: PageStore
    @AppStorage(PatchAlerts.enabledKey) private var alertsOn = false
    @ObservedObject private var haptics = Haptics.shared
    @State private var path = NavigationPath()
    @State private var alertsDenied = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    ForEach(SiteTab.more) { tab in
                        NavigationLink(value: tab) { Label(tab.title, systemImage: tab.symbol) }
                    }
                }
                Section {
                    Toggle(isOn: Binding(get: { haptics.enabled }, set: { haptics.setEnabled($0, pages: pages.webViews) })) {
                        Label("Haptics", systemImage: "hand.tap.fill")
                    }
                } footer: {
                    Text("Light taps when you switch tabs, pull to refresh, star a champion, draft augments and more. Same switch as Vibration in the site's settings.")
                }
                Section {
                    Toggle(isOn: $alertsOn) { Label("New patch alerts", systemImage: "bell.badge.fill") }
                        .onChange(of: alertsOn) { _, on in
                            Haptics.shared.play(.tick)
                            guard on else { return }
                            Task {
                                let ok = await PatchAlerts.shared.requestPermission()
                                if !ok { alertsOn = false; alertsDenied = true }
                            }
                        }
                } footer: {
                    Text(alertsDenied ? "Notifications are off for DeepARAM. Turn them on in Settings to get patch alerts." : "Get a notification when a new live patch or PBE update is on DeepARAM.")
                }
                Section {
                    ForEach(SiteTab.legal) { tab in
                        NavigationLink(value: tab) { Label(tab.title, systemImage: tab.symbol) }
                    }
                    Link(destination: URL(string: "mailto:admin@deeparam.com")!) { Label("Contact", systemImage: "envelope.fill") }
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Legal.riotNotice)
                        Text("DeepARAM \(Bundle.main.version)")
                    }
                    .padding(.top, 8)
                }
            }
            .navigationTitle("More")
            .onChange(of: path.count) { old, new in if new > old { Haptics.shared.play(.tap) } }
            .navigationDestination(for: SiteTab.self) { tab in
                WebTab(page: pages.page(for: tab))
                    .navigationTitle(tab.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbarBackground(Theme.background, for: .navigationBar)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
        }
    }
}

private extension Bundle {
    var version: String { (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0" }
}
