import DeepARAMKit
import WidgetKit

struct SummaryEntry: TimelineEntry {
    enum State { case ready, notConnected, signedOut }
    let date: Date
    let summary: WidgetSummary?
    let state: State
}

/// One fetch serves every widget kind. Between games nothing changes fast, so it asks again every 30 minutes
/// (iOS decides the real pace) and the app reloads the widgets when it opens. Offline, the last summary stays up.
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
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
        }
    }

    private func current() -> SummaryEntry {
        guard WidgetStore.isConnected else { return SummaryEntry(date: .now, summary: nil, state: .notConnected) }
        return SummaryEntry(date: .now, summary: WidgetStore.cached, state: .ready)
    }
}
