import DeepARAMWatchKit
import Foundation
import Observation

/// Holds what the watch shows. Opens with the saved copy, then refreshes from the site.
@MainActor @Observable
final class WatchStore {
    private(set) var data: WatchData?
    private(set) var savedAt: Date?
    private(set) var loading = false
    private(set) var failed = false

    private let feed = WatchFeed()

    init() {
        if let saved = feed.load() {
            data = saved.data
            savedAt = saved.savedAt
        }
    }

    /// Refreshes when there is nothing yet or the copy is older than an hour.
    func refreshIfStale() async {
        if let savedAt, Date().timeIntervalSince(savedAt) < 3600 { return }
        await refresh()
    }

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let saved = try await feed.refresh()
            data = saved.data
            savedAt = saved.savedAt
            failed = false
        } catch {
            failed = true
        }
    }
}
