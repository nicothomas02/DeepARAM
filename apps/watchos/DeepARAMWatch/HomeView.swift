import DeepARAMWatchKit
import SwiftUI

/// Patch, today's Chef Special, pinned champions and the champion list.
struct HomeView: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.scenePhase) private var phase
    private let favorites = Favorites()

    var body: some View {
        NavigationStack {
            List {
                if let data = store.data {
                    if let special = data.chefsSpecial {
                        Section("Chef Special") {
                            NavigationLink(value: Route.special) {
                                SpecialRow(special: special)
                            }
                        }
                    }
                    let pinned = favorites.ids.compactMap(data.champion)
                    if !pinned.isEmpty {
                        Section("Pinned") {
                            ForEach(pinned) { c in
                                NavigationLink(value: Route.champion(c.id)) { ChampionRow(champion: c) }
                            }
                        }
                    }
                    Section {
                        NavigationLink(value: Route.champions) {
                            Label("Champions", systemImage: "magnifyingglass")
                        }
                    }
                } else if store.loading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        Text("Can't reach DeepARAM right now.")
                            .foregroundStyle(.secondary)
                        Button("Try again") { Task { await store.refresh() } }
                    }
                }
                Section {
                    NavigationLink(value: Route.about) {
                        Label("About", systemImage: "info.circle")
                    }
                }
            }
            .navigationTitle(store.data?.patch.map { "Patch \($0)" } ?? "DeepARAM")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .special:
                    if let s = store.data?.chefsSpecial { SpecialView(special: s) }
                case .champions:
                    ChampionListView()
                case .champion(let id):
                    if let c = store.data?.champion(id) { ChampionView(champion: c) }
                case .about:
                    AboutView()
                }
            }
            .refreshable { await store.refresh() }
        }
        .task { await store.refreshIfStale() }
        .onChange(of: phase) { _, now in
            if now == .active { Task { await store.refreshIfStale() } }
        }
    }
}

enum Route: Hashable {
    case special
    case champions
    case champion(String)
    case about
}

struct SpecialRow: View {
    let special: ChefsSpecial

    var body: some View {
        HStack(spacing: 8) {
            ChampionIcon(url: special.iconURL, size: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text(special.title).font(.headline).lineLimit(2)
                Text(special.name).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

struct ChampionRow: View {
    let champion: Champion

    var body: some View {
        HStack(spacing: 8) {
            ChampionIcon(url: champion.iconURL, size: 28)
            Text(champion.name).lineLimit(1)
            Spacer(minLength: 0)
            if let tier = champion.tier {
                Text(tier).font(.caption.bold()).foregroundStyle(Theme.tier(tier))
            }
        }
    }
}

struct ChampionIcon: View {
    let url: URL
    let size: CGFloat

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Color.gray.opacity(0.25)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
