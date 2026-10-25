#if os(visionOS)
import DeepARAMKit
import SwiftUI

/// The More tab: the site's other pages, the app's settings, and the legal pages and notice.
struct VisionMoreView<Settings: View>: View {
    @ObservedObject var pages: VisionPageStore
    let settings: Settings

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(SiteTab.more) { tab in
                        NavigationLink(value: tab) { Label(tab.title, systemImage: tab.symbol) }
                    }
                }
                settings
                Section {
                    ForEach(SiteTab.legal) { tab in
                        NavigationLink(value: tab) { Label(tab.title, systemImage: tab.symbol) }
                    }
                    Link(destination: URL(string: "mailto:admin@deeparam.com")!) { Label("Contact", systemImage: "envelope.fill") }
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Legal.riotNotice)
                        Text("DeepARAM \(Bundle.main.shortVersion)")
                    }
                    .padding(.top, 8)
                }
            }
            .navigationTitle("More")
            .navigationDestination(for: SiteTab.self) { tab in
                VisionPage(page: pages.page(for: tab), title: tab.title)
            }
        }
    }
}

private extension Bundle {
    var shortVersion: String { (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0" }
}
#endif
