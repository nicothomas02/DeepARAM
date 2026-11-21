import ActivityKit
import DeepARAMKit
import Foundation

/// Live game on the Lock Screen, Dynamic Island and StandBy. The owner's PC app sends the pushes; this only tells the
/// site where to send them: the phone's push-to-start token (so a game can start the Live Activity with the app
/// closed) and each running activity's update token. Runs when widgets are connected.
@MainActor
final class LiveActivities {
    static let shared = LiveActivities()
    private var started = false

    func start() {
        guard !started, WidgetStore.isConnected, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        started = true
        if #available(iOS 17.2, *) {
            Task {
                for await token in Activity<LiveGameAttributes>.pushToStartTokenUpdates {
                    await WidgetStore.registerPush(kind: "start", token: token)
                }
            }
        }
        // Activities already running (the app was closed when the game started) and any that start later.
        for activity in Activity<LiveGameAttributes>.activities { follow(activity) }
        Task {
            for await activity in Activity<LiveGameAttributes>.activityUpdates { follow(activity) }
        }
    }

    private func follow(_ activity: Activity<LiveGameAttributes>) {
        Task {
            for await token in activity.pushTokenUpdates {
                await WidgetStore.registerPush(kind: "activity", token: token)
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                await WidgetStore.registerPush(kind: "activity", token: nil)
            }
        }
    }
}
