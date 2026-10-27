import DeepARAMTVKit
import SwiftUI

/// One champion's quick build: tier, win rate, skill order, items and the best augments per rarity.
struct ChampionView: View {
    let champion: TVData.Champion

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 32) {
                HStack(alignment: .center, spacing: 48) {
                    SiteImage(path: champion.icon, size: 220, corner: 32)
                    VStack(alignment: .leading, spacing: 16) {
                        Text(champion.name).font(.system(size: 76, weight: .bold))
                        HStack(spacing: 32) {
                            TierBadge(tier: champion.tier, size: 72)
                            Stat(label: "Win rate", value: Tiers.percent(champion.winRate))
                            Stat(label: "Pick rate", value: Tiers.percent(champion.pickRate))
                        }
                    }
                }
                .padding(.top, 20)

                if !champion.skills.isEmpty {
                    SectionTitle(text: "Skill order")
                    FocusBlock {
                        HStack(spacing: 24) {
                            ForEach(Array(champion.skills.enumerated()), id: \.offset) { i, s in
                                if i > 0 { Image(systemName: "chevron.right").foregroundStyle(.secondary) }
                                Text(s)
                                    .font(.title2.bold())
                                    .frame(width: 80, height: 80)
                                    .background(Theme.accent.opacity(0.25), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                        }
                    }
                }

                if !champion.items.isEmpty {
                    SectionTitle(text: "Build")
                    FocusBlock { PicturedRow(things: champion.items) }
                }

                SectionTitle(text: "Best augments")
                ForEach(Tiers.rarities, id: \.self) { r in
                    if let augs = champion.augments[r], !augs.isEmpty {
                        FocusBlock {
                            VStack(alignment: .leading, spacing: 20) {
                                Text(Theme.rarityName(r)).font(.headline).foregroundStyle(Theme.rarity(r))
                                PicturedRow(things: augs, tint: Theme.rarity(r))
                            }
                        }
                    }
                }
            }
            .padding(.bottom, 60)
        }
    }
}

struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title2.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}
