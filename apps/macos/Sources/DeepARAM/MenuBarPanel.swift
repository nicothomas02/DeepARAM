import DeepARAMKit
import SwiftUI

/// The menu bar panel: look up any champion's tier, skill order, items and augments for the live patch
/// without opening a window, with today's Chef Special when the search is empty.
@MainActor
final class QuickBuildsModel: ObservableObject {
    static let shared = QuickBuildsModel()

    @Published private(set) var builds: QuickBuilds? = QuickBuilds.cached()
    @Published private(set) var failed = false
    private var lastFetch: Date?

    /// Refreshes at most every half hour; the panel calls this each time it opens.
    func refresh(force: Bool = false) {
        if !force, let lastFetch, Date().timeIntervalSince(lastFetch) < 30 * 60 { return }
        lastFetch = Date()
        Task {
            do {
                builds = try await QuickBuilds.fetch()
                failed = false
            } catch {
                failed = builds == nil
                lastFetch = nil
            }
        }
    }
}

struct MenuBarPanel: View {
    @ObservedObject private var model = QuickBuildsModel.shared
    @State private var query = ""
    @State private var picked: QuickBuilds.Champion?
    @FocusState private var searchFocused: Bool

    private var matches: [QuickBuilds.Champion] { model.builds?.search(query) ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            TextField("Search champions", text: $query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onSubmit { if let first = matches.first { picked = first } }
                .onChange(of: query) { _, _ in picked = nil }

            ScrollView {
                VStack(alignment: .leading, spacing: 8) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 300)

            Divider()
            footer
        }
        .padding(12)
        .frame(width: 340)
        .onAppear {
            model.refresh()
            searchFocused = true
        }
    }

    private var header: some View {
        HStack {
            Text("DeepARAM").font(.headline)
            Spacer()
            if let patch = model.builds?.patchName {
                Text("Patch \(patch)").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let picked {
            ChampionCard(champion: picked) { self.picked = nil }
        } else if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            if matches.isEmpty {
                Text("No champion matches “\(query)”.").foregroundStyle(.secondary)
            }
            ForEach(matches.prefix(12)) { c in
                Button { picked = c } label: {
                    HStack {
                        Text(c.name)
                        Spacer()
                        if let tier = c.tier { TierBadge(tier: tier) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } else if let special = model.builds?.chefsSpecial {
            ChefSpecialCard(special: special) {
                picked = model.builds?.champions.first { $0.id == special.champion }
            }
        } else if model.failed {
            Label("You're offline. Champion builds load once you're back online.", systemImage: "wifi.slash")
                .foregroundStyle(.secondary)
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    private var footer: some View {
        HStack {
            Button("Open DeepARAM") { WindowRouter.shared.open(SiteTab.home.url) }
            Spacer()
            SettingsLink { Image(systemName: "gearshape") }
                .help("Settings")
            Button { NSApp.terminate(nil) } label: { Image(systemName: "power") }
                .help("Quit DeepARAM")
        }
        .buttonStyle(.borderless)
    }
}

private struct ChampionCard: View {
    let champion: QuickBuilds.Champion
    let back: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button(action: back) { Image(systemName: "chevron.left") }
                    .buttonStyle(.borderless)
                    .help("Back to results")
                Text(champion.name).font(.title3.bold())
                Spacer()
                if let tier = champion.tier { TierBadge(tier: tier) }
            }
            HStack(spacing: 16) {
                if let wr = champion.winRate {
                    Stat(label: "Win rate", value: wr.formatted(.percent.precision(.fractionLength(1))))
                }
                if !champion.skills.isEmpty { Stat(label: "Skill order", value: champion.skillOrder) }
            }
            if !champion.items.isEmpty { NameList(title: "Items", names: champion.items) }
            NameList(title: "Prismatic augments", names: champion.augments.prismatic)
            NameList(title: "Gold augments", names: champion.augments.gold)
            NameList(title: "Silver augments", names: champion.augments.silver)
            Button("Open champion page") { WindowRouter.shared.open(champion.url) }
                .padding(.top, 4)
        }
    }
}

private struct ChefSpecialCard: View {
    let special: QuickBuilds.ChefSpecial
    let showChampion: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY'S CHEF SPECIAL").font(.caption.bold()).foregroundStyle(.secondary)
            Text("\(special.title) · \(special.name)").font(.title3.bold())
            if let play = special.play { Text(play).font(.callout).fixedSize(horizontal: false, vertical: true) }
            NameList(title: "Augments", names: special.augments.map(\.name))
            NameList(title: "Items", names: special.items)
            HStack {
                Button("See it in The Kitchen") { WindowRouter.shared.open(Site.url("/kitchen")) }
                Button("\(special.name)'s build", action: showChampion)
            }
            .padding(.top, 4)
            Text("Type a champion's name to see their build.")
                .font(.caption).foregroundStyle(.secondary)
                .padding(.top, 6)
        }
    }
}

private struct NameList: View {
    let title: String
    let names: [String]

    var body: some View {
        if !names.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.bold()).foregroundStyle(.secondary)
                Text(names.joined(separator: " · ")).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.monospacedDigit().bold())
        }
    }
}

private struct TierBadge: View {
    let tier: String

    var body: some View {
        Text(tier)
            .font(.caption.bold())
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.tint.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
    }
}
