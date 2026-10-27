import DeepARAMWatchKit
import SwiftUI

/// When the data was last updated, and Riot's notice.
struct AboutView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("DeepARAM").font(.headline)
                Text("ARAM Mayhem builds, augments and tiers. More at deeparam.com.")
                    .font(.footnote)
                if let savedAt = store.savedAt {
                    Text("Updated \(savedAt, style: .relative) ago")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if store.failed {
                    Text("Offline. Showing the last saved copy.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Button("Refresh") { Task { await store.refresh() } }
                    .disabled(store.loading)
                Text(Legal.riotNotice)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("About")
    }
}
