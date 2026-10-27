import DeepARAMTVKit
import SwiftUI

/// The tabs along the top of the screen.
struct RootView: View {
    @EnvironmentObject private var store: TVStore
    @State private var tab = Tab.tiers

    enum Tab: Hashable { case tiers, augments, special, pbe, search, about }

    var body: some View {
        Group {
            if let data = store.data {
                TabView(selection: $tab) {
                    NavigationStack { ChampionTiersView(data: data) }
                        .tabItem { Label("Champions", systemImage: "chart.bar.fill") }
                        .tag(Tab.tiers)
                    NavigationStack { AugmentTiersView(data: data) }
                        .tabItem { Label("Augments", systemImage: "sparkles") }
                        .tag(Tab.augments)
                    if let special = data.chefsSpecial {
                        NavigationStack { ChefSpecialView(special: special, data: data) }
                            .tabItem { Label("Chef's Special", systemImage: "frying.pan.fill") }
                            .tag(Tab.special)
                    }
                    if let pbe = data.pbe {
                        NavigationStack { PBEView(pbe: pbe) }
                            .tabItem { Label("PBE", systemImage: "flask.fill") }
                            .tag(Tab.pbe)
                    }
                    NavigationStack { SearchView(data: data) }
                        .tabItem { Label("Search", systemImage: "magnifyingglass") }
                        .tag(Tab.search)
                    NavigationStack { AboutView(data: data) }
                        .tabItem { Label("About", systemImage: "info.circle") }
                        .tag(Tab.about)
                }
            } else if store.state == .failed {
                VStack(spacing: 32) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 96))
                    Text("Can't reach DeepARAM").font(.title2.bold())
                    Text("Check the Apple TV's internet connection and try again.").foregroundStyle(.secondary)
                    Button("Try again") { Task { await store.refresh(force: true) } }
                }
            } else {
                ProgressView("Loading the tier list…")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}
