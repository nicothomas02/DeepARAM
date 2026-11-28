import ActivityKit
import DeepARAMKit
import SwiftUI
import WebKit

/// The owner's game companion (Nico 2026-11-27, his iPhone Duo beside the PC): the companion page his PC app serves
/// on the home network (apps/desktop/src-tauri/src/phone.rs), full screen in the app. The page is the PC app's own,
/// so the picks, the look and the layouts are the same as the window on the PC. The app adds what a browser can't:
/// the screen stays on while it's open, it comes to the front by itself in champion select and Mayhem games, and the
/// game shows as a Live Activity (Lock Screen, StandBy) while the app is open.
///
/// Nobody else sees it: the tab appears only after the PC's page sent its address here once
/// (deeparam://companion?url=…, a link the page shows when opened in Safari).
@MainActor
final class CompanionStore: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = CompanionStore()
    private static let key = "companionURL"

    /// The PC's page, e.g. http://10.0.0.17:8792/<token>/. Nil until set up.
    @Published private(set) var url: URL? = UserDefaults.standard.url(forKey: CompanionStore.key)
    /// What the page shows: "idle", "pick" (champion select), "game" or "over" (game over and the review).
    @Published private(set) var view = "idle"
    /// The page couldn't be loaded (the PC is off, the app isn't running, another Wi-Fi).
    @Published private(set) var unreachable = false
    /// On screen (over the tabs). Set by itself in champion select and games; closed with its button.
    @Published var shown = false

    private(set) lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "deeparam")
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(Theme.background)
        web.scrollView.backgroundColor = UIColor(Theme.background)
        web.navigationDelegate = self
        return web
    }()

    private var loaded = false
    private var activity: Activity<LiveGameAttributes>?
    private var lastGame: LiveGame?

    var isSetUp: Bool { url != nil }

    /// Saves the PC's page address from a deeparam://companion?url=… link. Only plain http(s) addresses are kept.
    @discardableResult
    func setUp(from link: URL) -> Bool {
        guard link.scheme == "deeparam", link.host == "companion",
              let raw = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
              let page = URL(string: raw), ["http", "https"].contains(page.scheme ?? "") else { return false }
        UserDefaults.standard.set(page, forKey: Self.key)
        url = page
        loaded = false
        loadIfNeeded()
        return true
    }

    func forget() {
        UserDefaults.standard.removeObject(forKey: Self.key)
        url = nil
        loaded = false
        view = "idle"
        endActivity()
    }

    /// Loads the page once; it then follows the PC by itself (and reloads itself when the PC app restarts).
    func loadIfNeeded() {
        guard let url, !loaded else { return }
        loaded = true
        unreachable = false
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func reload() {
        loaded = false
        loadIfNeeded()
    }

    /// Back in the app: a page that failed (PC off) tries again.
    func resume() {
        if unreachable { reload() } else { loadIfNeeded() }
    }

    // MARK: The page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        apply(CompanionState(body))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { unreachable = true }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        unreachable = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { unreachable = false }

    private func apply(_ state: CompanionState) {
        if view != state.view { view = state.view }
        if state.view == "game", let game = state.game {
            updateActivity(game)
        } else if state.view == "over" || state.view == "pick" {
            endActivity()
        }
    }

    // MARK: Live Activity (local: started and updated by the app while it's open; no push needed)

    private func updateActivity(_ game: LiveGame) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, game != lastGame else { return }
        lastGame = game
        let content = ActivityContent(state: game, staleDate: Date().addingTimeInterval(10 * 60))
        if let activity, activity.activityState == .active {
            Task { await activity.update(content) }
            return
        }
        activity = try? Activity.request(attributes: LiveGameAttributes(champion: game.champion), content: content, pushType: nil)
    }

    private func endActivity() {
        lastGame = nil
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .after(Date().addingTimeInterval(60))) }
    }
}

/// What the page reports after each update (window.companionState in apps/desktop/ui/companion.html).
struct CompanionState {
    var view: String
    var game: LiveGame?

    init(_ body: [String: Any]) {
        view = body["view"] as? String ?? "idle"
        guard view == "game", let champ = body["champ"] as? String else { return }
        let level = (body["level"] as? NSNumber)?.intValue ?? 1
        let t = (body["t"] as? NSNumber)?.doubleValue ?? 0
        let kda = (body["kda"] as? [NSNumber])?.map(\.intValue) ?? []
        game = LiveGame(
            champion: champ.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression),
            championId: champ,
            // Rounded to 10 s so the clock doesn't count as a change on every update.
            startedAt: ((Date().timeIntervalSince1970 - t) / 10).rounded() * 10_000,
            level: level,
            kills: kda.count == 3 ? kda[0] : 0,
            deaths: kda.count == 3 ? kda[1] : 0,
            assists: kda.count == 3 ? kda[2] : 0,
            nextAugment: [1, 7, 11, 15].first { $0 > level },
            augmentReady: body["pick"] as? Bool ?? false,
            nextItems: body["next"] as? [String] ?? [],
            winChance: (body["win"] as? NSNumber)?.doubleValue,
            dead: body["dead"] as? Bool ?? false
        )
    }
}

/// The companion screen: the PC's page edge to edge, the screen kept on while it shows. It closes with its button
/// (outside games only: nothing in a game needs a tap).
struct CompanionView: View {
    @ObservedObject var store: CompanionStore
    @Environment(\.scenePhase) private var scenePhase

    private var inGame: Bool { store.view == "pick" || store.view == "game" }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.background.ignoresSafeArea()
            CompanionWebHost(webView: store.webView)
                .ignoresSafeArea(.container, edges: .bottom)
            if store.unreachable {
                ContentUnavailableView {
                    Label("Can't reach your PC", systemImage: "desktopcomputer.trianglebadge.exclamationmark")
                } description: {
                    Text("DeepARAM has to be running on the PC, and this phone on the same Wi-Fi.")
                } actions: {
                    Button("Try again") { store.reload() }.buttonStyle(.borderedProminent)
                }
                .background(Theme.background)
            }
            if !inGame {
                Button { store.shown = false } label: {
                    Image(systemName: "xmark").font(.body.weight(.semibold)).padding(10)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel("Close the companion")
                .padding(.leading, 12)
                .padding(.top, 4)
            }
        }
        .statusBarHidden(store.shown && store.view == "game")
        .onChange(of: store.shown) { _, shown in keepAwake(); if shown { store.resume() } }
        .onChange(of: scenePhase) { _, phase in
            keepAwake()
            if phase == .active, store.shown { store.resume() }
        }
        .onAppear { keepAwake() }
    }

    /// The screen stays on while the companion is up and the app is in front, and only then.
    private func keepAwake() {
        UIApplication.shared.isIdleTimerDisabled = store.shown && scenePhase == .active
    }
}

private struct CompanionWebHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
