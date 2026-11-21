import DeepARAMKit
import SwiftUI
import WebKit
import WidgetKit

/// More > iPhone widgets: connects the Home Screen and StandBy widgets to the signed-in account. The widgets run
/// outside the app, so the app trades its sign-in (the web view's cookies) for a widget token once and keeps it in
/// the keychain. Only the site owner's account can connect, since the widgets show the owner's own games.
struct WidgetsSection: View {
    @State private var connected = WidgetStore.isConnected
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Section {
            if connected {
                Button(role: .destructive) { Task { await disconnect() } } label: {
                    Label("Disconnect widgets", systemImage: "xmark.circle")
                }
            } else {
                Button { Task { await connect() } } label: {
                    HStack {
                        Label("Connect widgets", systemImage: "rectangle.3.group.fill")
                        if busy { Spacer(); ProgressView() }
                    }
                }
                .disabled(busy)
            }
        } header: {
            Text("iPhone widgets")
        } footer: {
            Text(message ?? (connected
                ? "Connected. Add This week, Next game and Your champions from the widget gallery. On a stand in StandBy, pick the Modular face: This week large, the other two small. During a game, with the DeepARAM PC app open, they show the game and a Live Activity follows it."
                : "Shows your week, a tip for your next game and your champions on the live patch. Sign in to your account (More > Account & My Stats) first."))
        }
    }

    private func connect() async {
        busy = true
        defer { busy = false }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        do {
            try await WidgetStore.connect(cookies: cookies, device: UIDevice.current.name)
            connected = true
            message = nil
            Haptics.shared.play(.done)
            WidgetCenter.shared.reloadAllTimelines()
            LiveActivities.shared.start()
        } catch WidgetStore.Failure.server(let text) {
            message = text
        } catch {
            message = "Couldn't reach DeepARAM. Check the connection and try again."
        }
    }

    private func disconnect() async {
        await WidgetStore.disconnect()
        connected = false
        message = nil
        WidgetCenter.shared.reloadAllTimelines()
    }
}
