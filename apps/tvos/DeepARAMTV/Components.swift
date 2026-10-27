import DeepARAMTVKit
import SwiftUI

/// The site's dark theme colours.
enum Theme {
    static let background = Color(red: 0x09 / 255, green: 0x0b / 255, blue: 0x0f / 255)
    static let card = Color.white.opacity(0.06)
    static let accent = Color(red: 0x5c / 255, green: 0xc0 / 255, blue: 0xff / 255)

    static func tier(_ tier: String?) -> Color {
        switch tier {
        case "S+", "S": Color(red: 1.0, green: 0.42, blue: 0.42)
        case "A": Color(red: 1.0, green: 0.66, blue: 0.30)
        case "B": Color(red: 1.0, green: 0.86, blue: 0.36)
        case "C": Color(red: 0.45, green: 0.85, blue: 0.55)
        case "D": Color(red: 0.42, green: 0.70, blue: 1.0)
        default: .gray
        }
    }

    static func rarity(_ rarity: String?) -> Color {
        switch rarity {
        case "prismatic": Color(red: 0.85, green: 0.55, blue: 1.0)
        case "gold": Color(red: 1.0, green: 0.78, blue: 0.30)
        case "silver": Color(red: 0.78, green: 0.82, blue: 0.88)
        default: .gray
        }
    }

    static func rarityName(_ rarity: String?) -> String {
        (rarity ?? "").prefix(1).uppercased() + (rarity ?? "").dropFirst()
    }
}

/// A picture from the site, with a soft placeholder while it loads.
struct SiteImage: View {
    let path: String?
    var size: CGFloat = 96
    var corner: CGFloat = 16

    var body: some View {
        AsyncImage(url: TVStore.url(path)) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Theme.card
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    }
}

struct TierBadge: View {
    let tier: String?
    var size: CGFloat = 56

    var body: some View {
        Text(tier ?? "–")
            .font(.system(size: size * 0.5, weight: .heavy, design: .rounded))
            .foregroundStyle(.black)
            .frame(width: size, height: size)
            .background(Theme.tier(tier), in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
    }
}

/// A block of text the remote can land on, so long pages scroll a piece at a time.
struct FocusBlock<Content: View>: View {
    @ViewBuilder var content: Content
    @FocusState private var focused: Bool

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(28)
            .background(focused ? Color.white.opacity(0.14) : Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .scaleEffect(focused ? 1.01 : 1)
            .animation(.easeOut(duration: 0.15), value: focused)
            .focusable()
            .focused($focused)
    }
}

struct SectionTitle: View {
    let text: String
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(text).font(.title3.bold())
            if let count { Text("\(count)").font(.title3).foregroundStyle(.secondary) }
        }
        .padding(.top, 24)
    }
}

/// A row of pictured names: items or augments.
struct PicturedRow: View {
    let things: [TVData.Pictured]
    var size: CGFloat = 88
    var tint: Color?

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            ForEach(Array(things.enumerated()), id: \.offset) { _, t in
                VStack(spacing: 10) {
                    SiteImage(path: t.icon, size: size, corner: 14)
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(tint ?? .clear, lineWidth: 3))
                    Text(t.name)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(width: size + 60)
                }
            }
        }
    }
}
