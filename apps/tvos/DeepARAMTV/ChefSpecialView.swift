import DeepARAMTVKit
import SwiftUI

/// The Kitchen's build of the day.
struct ChefSpecialView: View {
    let special: TVData.ChefsSpecial
    let data: TVData

    private var champion: TVData.Champion? { data.champions.first { $0.id == special.champion } }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 32) {
                HStack(alignment: .center, spacing: 48) {
                    SiteImage(path: special.icon, size: 220, corner: 32)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Chef's Special" + (special.date.map { " · \($0)" } ?? ""))
                            .font(.headline).foregroundStyle(Theme.accent)
                        Text(special.title).font(.system(size: 76, weight: .bold))
                        Text(special.name).font(.title2).foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 20)

                SectionTitle(text: "Augments")
                FocusBlock {
                    HStack(alignment: .top, spacing: 28) {
                        ForEach(special.augments, id: \.self) { a in
                            VStack(spacing: 10) {
                                SiteImage(path: a.icon, size: 96, corner: 16)
                                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.rarity(a.rarity), lineWidth: 3))
                                Text(a.name).font(.caption.bold()).multilineTextAlignment(.center).lineLimit(2)
                                if a.core { Text("Core").font(.caption2).foregroundStyle(Theme.accent) }
                            }
                            .frame(width: 180)
                        }
                    }
                }

                if !special.items.isEmpty {
                    SectionTitle(text: "Items")
                    FocusBlock { PicturedRow(things: special.items) }
                }

                SectionTitle(text: "Why it works")
                FocusBlock { Text(special.why).font(.body) }

                if let play = special.play, !play.isEmpty {
                    SectionTitle(text: "How to play it")
                    FocusBlock { Text(play).font(.body) }
                }

                if let champion {
                    NavigationLink(value: champion) {
                        Label("\(champion.name)'s usual build", systemImage: "chart.bar.fill")
                    }
                    .padding(.top, 16)
                }
            }
            .padding(.bottom, 60)
        }
        .navigationDestination(for: TVData.Champion.self) { ChampionView(champion: $0) }
    }
}
