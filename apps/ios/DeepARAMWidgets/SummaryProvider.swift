import DeepARAMKit
import WidgetKit

struct SummaryEntry: TimelineEntry {
    enum State { case ready, notConnected, signedOut }
    let date: Date
    let summary: WidgetSummary?
    let state: State
}

/// One fetch serves every widget kind. Between games nothing changes fast, so it asks again every 30 minutes, and every
/// minute while a game is on (iOS decides the real pace; the Live Activity is the one that follows a game closely).
/// The app reloads the widgets when it opens. Offline, the last summary stays up, minus a live game that went stale.
struct SummaryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: .now, summary: .preview, state: .ready)
    }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        completion(current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        Task {
            let entry: SummaryEntry
            do {
                entry = SummaryEntry(date: .now, summary: try await WidgetStore.refresh(), state: .ready)
            } catch WidgetStore.Failure.notConnected {
                entry = SummaryEntry(date: .now, summary: nil, state: .notConnected)
            } catch WidgetStore.Failure.signedOut {
                entry = SummaryEntry(date: .now, summary: nil, state: .signedOut)
            } catch {
                entry = current()
            }
            // In a game, ask again in a minute (iOS still decides); between games every 30 minutes.
            let wait: TimeInterval = entry.summary?.live != nil ? 60 : 30 * 60
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(wait))))
        }
    }

    private func current() -> SummaryEntry {
        guard WidgetStore.isConnected else { return SummaryEntry(date: .now, summary: nil, state: .notConnected) }
        var cached = WidgetStore.cached
        // A cached live game from more than 2 minutes ago is over or out of date.
        if let s = cached, s.live != nil, Date().timeIntervalSince(s.updatedDate) > 120 { cached?.live = nil }
        return SummaryEntry(date: .now, summary: cached, state: .ready)
    }
}
