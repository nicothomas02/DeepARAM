import DeepARAMTVKit
import SwiftUI

/// What's changing for ARAM Mayhem on the test server.
struct PBEView: View {
    let pbe: TVData.PBE

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 28) {
                Header(title: "PBE: \(pbe.label)", subtitle: "\(pbe.caveat) Updated \(pbe.dataAsOf).")
                FocusBlock {
                    HStack(spacing: 64) {
                        Stat(label: "New augments", value: "\(pbe.augments.added.count)")
                        Stat(label: "Changed", value: "\(pbe.augments.changed.count)")
                        Stat(label: "Removed", value: "\(pbe.augments.removed.count)")
                        Stat(label: "Augment pool", value: "\(pbe.augmentPool.live) → \(pbe.augmentPool.pbe)")
                    }
                }

                if !pbe.augments.changed.isEmpty {
                    SectionTitle(text: "Changed augments", count: pbe.augments.changed.count)
                    ForEach(pbe.augments.changed, id: \.self) { a in
                        FocusBlock {
                            HStack(alignment: .top, spacing: 28) {
                                AugmentIcon(icon: a.icon, rarity: a.rarity)
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(spacing: 16) {
                                        Text(a.name).font(.headline)
                                        if let d = a.direction, let label = Self.direction[d] {
                                            Text(label)
                                                .font(.caption.bold())
                                                .padding(.horizontal, 14).padding(.vertical, 4)
                                                .background(Self.directionColor(d).opacity(0.3), in: Capsule())
                                        }
                                    }
                                    ForEach(a.changes, id: \.self) { c in
                                        Text("\(c.stat): \(c.live) → \(c.pbe)").font(.callout).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }

                if !pbe.augments.added.isEmpty {
                    SectionTitle(text: "New augments", count: pbe.augments.added.count)
                    ForEach(pbe.augments.added, id: \.self) { a in
                        FocusBlock {
                            HStack(alignment: .top, spacing: 28) {
                                AugmentIcon(icon: a.icon, rarity: a.rarity)
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(a.name).font(.headline)
                                    if let d = a.description { Text(d).font(.callout).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }

                if !pbe.augments.removed.isEmpty {
                    SectionTitle(text: "Leaving the pool", count: pbe.augments.removed.count)
                    FocusBlock {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3), alignment: .leading, spacing: 24) {
                            ForEach(pbe.augments.removed, id: \.self) { a in
                                HStack(spacing: 20) {
                                    AugmentIcon(icon: a.icon, rarity: a.rarity, size: 64)
                                    Text(a.name).font(.callout)
                                }
                            }
                        }
                    }
                }

                if !pbe.championChanges.isEmpty {
                    SectionTitle(text: "Champion changes", count: pbe.championChanges.count)
                    ForEach(pbe.championChanges, id: \.self) { c in
                        ChangeList(title: c.champion, changes: c.changes)
                    }
                }

                if !pbe.itemChanges.isEmpty {
                    SectionTitle(text: "Item changes", count: pbe.itemChanges.count)
                    ForEach(pbe.itemChanges, id: \.self) { i in
                        ChangeList(title: i.item, changes: i.changes)
                    }
                }

                if !pbe.modeChanges.isEmpty {
                    SectionTitle(text: "Mode changes", count: pbe.modeChanges.count)
                    ChangeList(title: nil, changes: pbe.modeChanges)
                }
            }
            .padding(.bottom, 60)
        }
    }

    static let direction = ["buff": "Likely buff", "nerf": "Likely nerf", "mixed": "Mixed", "none": "No power change", "unclear": "Unclear"]

    static func directionColor(_ d: String) -> Color {
        switch d {
        case "buff": .green
        case "nerf": .red
        default: .gray
        }
    }
}

private struct AugmentIcon: View {
    let icon: String?
    let rarity: String?
    var size: CGFloat = 96

    var body: some View {
        SiteImage(path: icon, size: size, corner: size / 6)
            .overlay(RoundedRectangle(cornerRadius: size / 6, style: .continuous).stroke(Theme.rarity(rarity), lineWidth: 3))
    }
}

private struct ChangeList: View {
    let title: String?
    let changes: [String]

    var body: some View {
        FocusBlock {
            VStack(alignment: .leading, spacing: 10) {
                if let title { Text(title).font(.headline) }
                ForEach(Array(changes.enumerated()), id: \.offset) { _, c in
                    Text("•  " + c).font(.callout).foregroundStyle(title == nil ? .primary : .secondary)
                }
            }
        }
    }
}
