import DeepARAMWatchKit
import SwiftUI

/// One champion at a glance: the champion page's quick build (skill order, spells, items, augments by rarity).
struct ChampionView: View {
    let champion: Champion
    private let favorites = Favorites()
    @State private var pinned = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 10) {
                    ChampionIcon(url: champion.iconURL, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(champion.name).font(.headline)
                        if let tier = champion.tier {
                            Text("\(tier) tier").font(.caption2.bold()).foregroundStyle(Theme.tier(tier))
                        }
                        if let score = champion.deepScore {
                            Text("DeepScore \(Int(score.rounded()))").font(.caption2).foregroundStyle(.secondary)
                        }
                        if let wr = champion.winRate {
                            Text("\(wr.formatted(.percent.precision(.fractionLength(1)))) win rate")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
            if !champion.skills.isEmpty {
                Section("Skill max order") {
                    SkillOrder(skills: champion.skills)
                }
            }
            if !champion.spells.isEmpty {
                Section("Summoner spells") {
                    Text(champion.spells.joined(separator: " + ")).font(.footnote)
                }
            }
            if !champion.items.isEmpty {
                Section("Build") {
                    ForEach(Array(champion.items.enumerated()), id: \.offset) { i, item in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(i + 1)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            Text(item).font(.footnote)
                        }
                    }
                }
            }
            ForEach(champion.augments.byRarity, id: \.rarity) { group in
                Section {
                    ForEach(group.names, id: \.self) { Text($0).font(.footnote) }
                } header: {
                    Text(group.rarity).foregroundStyle(Theme.rarity(group.rarity))
                }
            }
            Section {
                Button {
                    favorites.toggle(champion.id)
                    pinned.toggle()
                } label: {
                    Label(pinned ? "Unpin" : "Pin to home", systemImage: pinned ? "pin.slash" : "pin")
                }
            }
        }
        .navigationTitle(champion.name)
        .onAppear { pinned = favorites.contains(champion.id) }
    }
}

struct SkillOrder: View {
    let skills: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(skills.enumerated()), id: \.offset) { i, s in
                if i > 0 { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary) }
                Text(s)
                    .font(.headline.monospaced())
                    .frame(minWidth: 28, minHeight: 28)
                    .background(Theme.accent.opacity(i == 0 ? 0.35 : 0.15), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Max " + skills.joined(separator: ", then "))
    }
}
