import DeepARAMTVKit
import SwiftUI

/// Champions by tier: one row per tier, scroll across with the remote, click for the champion's build.
struct ChampionTiersView: View {
    let data: TVData

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 40) {
                Header(title: "ARAM Mayhem Tier List", subtitle: "Patch \(data.patch) · ranked by DeepScore")
                ForEach(Tiers.champions(data.champions), id: \.tier) { group in
                    TierRow(tier: group.tier, count: group.rows.count) {
                        ForEach(group.rows) { c in
                            NavigationLink(value: c) { ChampionCard(champion: c) }
                                .buttonStyle(.card)
                        }
                    }
                }
            }
            .padding(.bottom, 60)
        }
        .navigationDestination(for: TVData.Champion.self) { ChampionView(champion: $0) }
    }
}

/// Augments by tier for one rarity at a time.
struct AugmentTiersView: View {
    let data: TVData
    @State private var rarity = "prismatic"

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 40) {
                Header(title: "Augment Tier List", subtitle: "Patch \(data.patch)")
                Picker("Rarity", selection: $rarity) {
                    ForEach(Tiers.rarities, id: \.self) { Text(Theme.rarityName($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 900)
                ForEach(Tiers.augments(data.augments, rarity: rarity), id: \.tier) { group in
                    TierRow(tier: group.tier, count: group.rows.count) {
                        ForEach(group.rows) { a in
                            Button {} label: { AugmentCard(augment: a) }
                                .buttonStyle(.card)
                        }
                    }
                }
            }
            .padding(.bottom, 60)
        }
    }
}

struct Header: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.largeTitle.bold())
            Text(subtitle).font(.headline).foregroundStyle(.secondary)
        }
        .padding(.top, 20)
    }
}

struct TierRow<Cards: View>: View {
    let tier: String
    let count: Int
    @ViewBuilder var cards: Cards

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 20) {
                TierBadge(tier: tier)
                Text("\(count)").font(.headline).foregroundStyle(.secondary)
            }
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) { cards }
                    .padding(.vertical, 24)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

struct ChampionCard: View {
    let champion: TVData.Champion

    var body: some View {
        VStack(spacing: 12) {
            SiteImage(path: champion.icon, size: 160, corner: 0)
            Text(champion.name).font(.callout.bold()).lineLimit(1)
            Text(Tiers.percent(champion.winRate) + " win").font(.caption).foregroundStyle(.secondary)
        }
        .frame(width: 200)
        .padding(.bottom, 16)
    }
}

struct AugmentCard: View {
    let augment: TVData.Augment

    var body: some View {
        VStack(spacing: 12) {
            SiteImage(path: augment.icon, size: 120, corner: 18)
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.rarity(augment.rarity), lineWidth: 3))
                .padding(.top, 20)
            Text(augment.name).font(.callout.bold()).multilineTextAlignment(.center).lineLimit(2)
            Text(Tiers.percent(augment.winRate) + " win").font(.caption).foregroundStyle(.secondary)
        }
        .frame(width: 240, height: 290, alignment: .top)
    }
}

/// Find a champion by typing on the remote, the phone keyboard or by voice.
struct SearchView: View {
    let data: TVData
    @State private var query = ""

    private var results: [TVData.Champion] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let all = data.champions.sorted { $0.name < $1.name }
        guard !q.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        ScrollView(.vertical) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(220), spacing: 40), count: 7), spacing: 48) {
                ForEach(results) { c in
                    NavigationLink(value: c) { ChampionCard(champion: c) }
                        .buttonStyle(.card)
                }
            }
            .padding(.vertical, 40)
        }
        .searchable(text: $query, prompt: "Champion")
        .navigationDestination(for: TVData.Champion.self) { ChampionView(champion: $0) }
    }
}
