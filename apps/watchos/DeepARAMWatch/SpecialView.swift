import DeepARAMWatchKit
import SwiftUI

/// Today's Chef Special from The Kitchen.
struct SpecialView: View {
    let special: ChefsSpecial

    var body: some View {
        List {
            Section {
                HStack(spacing: 10) {
                    ChampionIcon(url: special.iconURL, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(special.title).font(.headline)
                        Text(special.name).font(.caption2).foregroundStyle(.secondary)
                        if let tier = special.tier, !tier.isEmpty {
                            Text(tier).font(.caption2.bold()).foregroundStyle(Theme.accent)
                        }
                        if let day = special.day {
                            Text(day, format: .dateTime.month(.abbreviated).day())
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
            if let why = special.why, !why.isEmpty {
                Section("Why it works") { Text(why).font(.footnote) }
            }
            if let play = special.play, !play.isEmpty {
                Section("How to play") { Text(play).font(.footnote) }
            }
            if !special.augments.isEmpty {
                Section("Augments") {
                    ForEach(special.augments, id: \.self) { a in
                        HStack(spacing: 6) {
                            Circle().fill(Theme.rarity(a.rarity)).frame(width: 6, height: 6)
                            Text(a.name).font(.footnote)
                        }
                    }
                }
            }
            if !special.items.isEmpty {
                Section("Build") {
                    ForEach(Array(special.items.enumerated()), id: \.offset) { i, item in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(i + 1)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            Text(item).font(.footnote)
                        }
                    }
                }
            }
        }
        .navigationTitle("Chef Special")
    }
}

extension ChefsSpecial {
    /// The cook date as a calendar day, read in the watch's own time zone so it shows as that same day.
    var day: Date? {
        guard let date else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: date)
    }
}
