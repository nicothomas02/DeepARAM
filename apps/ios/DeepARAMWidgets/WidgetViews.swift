import DeepARAMKit
import SwiftUI
import WidgetKit

/// The site's dark theme, kept quiet so the widgets read at a glance on a stand.
enum Palette {
    static let background = Color(red: 0x09 / 255, green: 0x0b / 255, blue: 0x0f / 255)
    static let accent = Color(red: 0x5c / 255, green: 0xc0 / 255, blue: 0xff / 255)
    static let good = Color(red: 0x4a / 255, green: 0xd9 / 255, blue: 0x8c / 255)
    static let worse = Color(red: 0xff / 255, green: 0x9f / 255, blue: 0x43 / 255)
}

extension View {
    /// StandBy and tinted Home Screens drop this background on their own.
    func widgetBackground() -> some View {
        containerBackground(Palette.background, for: .widget)
    }
}

private let myStats = URL(string: "deeparam://account#my-stats")!

/// The arrow follows the number; the colour says whether that's good (fewer deaths is good).
private func symbol(_ i: WidgetSummary.Indicator) -> String {
    guard i.better != nil, let usual = i.usual else { return "minus" }
    return i.week >= usual ? "arrow.up.right" : "arrow.down.right"
}

private func color(_ i: WidgetSummary.Indicator) -> Color {
    switch i.better {
    case .some(true): Palette.good
    case .some(false): Palette.worse
    case .none: .secondary
    }
}

private func value(_ v: Double, _ i: WidgetSummary.Indicator) -> String {
    let n = i.key == "damage" ? v.formatted(.number.precision(.fractionLength(0))) : v.formatted(.number.precision(.fractionLength(0...1)))
    return n + i.unit
}

private func shortLabel(_ i: WidgetSummary.Indicator) -> String {
    switch i.key {
    case "deaths": "Deaths/10m"
    case "damage": "Dmg/min"
    case "kp": "Kill share"
    default: i.label
    }
}

/// Shown until the app has connected the widgets, or after the site stopped accepting the token.
struct ConnectView: View {
    let state: SummaryEntry.State
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "link").font(.title3).foregroundStyle(Palette.accent)
            Text(state == .signedOut ? "Reconnect widgets" : "Connect widgets").font(.headline)
            Text("DeepARAM app › More › iPhone widgets").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: This week

struct WeeklyView: View {
    let entry: SummaryEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let live = entry.summary?.live {
            LiveGameCard(game: live, large: family == .systemLarge)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(URL(string: "deeparam://champions/\(live.championId)"))
        } else if let s = entry.summary {
            switch family {
            case .systemSmall: small(s)
            case .systemMedium: medium(s)
            default: large(s)
            }
        } else {
            ConnectView(state: entry.state)
        }
    }

    private func record(_ s: WidgetSummary, size: Font) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("This week").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
            Text("\(s.week.wins)–\(s.week.losses)").font(size.weight(.bold)).monospacedDigit().widgetAccentable()
            Text(s.week.games == 1 ? "1 game" : "\(s.week.games) games").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func winBar(_ s: WidgetSummary) -> some View {
        GeometryReader { g in
            let total = max(1, s.week.wins + s.week.losses)
            HStack(spacing: 2) {
                Capsule().fill(Palette.good).frame(width: max(0, g.size.width * CGFloat(s.week.wins) / CGFloat(total) - 1))
                Capsule().fill(Color.secondary.opacity(0.35))
            }
        }
        .frame(height: 6)
    }

    private func row(_ i: WidgetSummary.Indicator, compact: Bool) -> some View {
        HStack(spacing: 6) {
            Text(compact ? shortLabel(i) : i.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 4)
            Text(value(i.week, i)).font(.caption.weight(.semibold)).monospacedDigit()
            if !compact, let u = i.usual {
                Text("usual \(value(u, i))").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
            Image(systemName: symbol(i)).font(.caption2.weight(.bold)).foregroundStyle(color(i))
        }
    }

    private func small(_ s: WidgetSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            record(s, size: .title)
            Spacer(minLength: 0)
            ForEach(s.week.indicators) { row($0, compact: true) }
        }
        .widgetURL(myStats)
    }

    private func medium(_ s: WidgetSummary) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                record(s, size: .largeTitle)
                winBar(s)
            }
            .frame(width: 96)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(s.week.indicators) { row($0, compact: false) }
            }
        }
        .widgetURL(myStats)
    }

    private func large(_ s: WidgetSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom) {
                record(s, size: .system(size: 44))
                Spacer()
                if let live = s.patch.live {
                    Text("Patch \(live)").font(.caption).foregroundStyle(.secondary)
                }
            }
            winBar(s)
            VStack(alignment: .leading, spacing: 9) {
                ForEach(s.week.indicators) { row($0, compact: false) }
            }
            Divider().overlay(Color.secondary.opacity(0.3))
            VStack(alignment: .leading, spacing: 4) {
                Label(s.tip.title, systemImage: "scope").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.accent)
                Text(s.tip.body).font(.callout).foregroundStyle(.secondary).lineLimit(3)
            }
            Spacer(minLength: 0)
            Text("Compared with your previous 60 days").font(.caption2).foregroundStyle(.tertiary)
        }
        .widgetURL(myStats)
    }
}

// MARK: Next game

struct TipView: View {
    let entry: SummaryEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let live = entry.summary?.live {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(live.champion) · \(live.kda)").font(.headline).widgetAccentable()
                    Text(live.headline).font(.caption).lineLimit(2)
                }
            } else {
                LiveGameCard(game: live, large: false)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        } else if let s = entry.summary {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 1) {
                    Text(s.tip.title).font(.headline).widgetAccentable()
                    Text(s.tip.body).font(.caption).lineLimit(2)
                }
                .widgetURL(myStats)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Next game", systemImage: "scope").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                    Text(s.tip.title).font(family == .systemSmall ? .headline : .title3.weight(.semibold)).lineLimit(2).widgetAccentable()
                    Text(s.tip.body).font(.caption).foregroundStyle(.secondary).lineLimit(family == .systemSmall ? 4 : 3)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(myStats)
            }
        } else if family == .accessoryRectangular {
            Text("Connect in the DeepARAM app").font(.caption)
        } else {
            ConnectView(state: entry.state)
        }
    }
}

// MARK: Your champions

struct PatchView: View {
    let entry: SummaryEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.summary {
            VStack(alignment: .leading, spacing: 6) {
                Text(s.patch.live.map { "Patch \($0)" } ?? "Live patch").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                if s.patch.champions.isEmpty {
                    Text("Play a few games to see your champions here.").font(.caption).foregroundStyle(.secondary)
                } else if family == .systemSmall {
                    ForEach(s.patch.champions) { champ($0, compact: true) }
                } else {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(s.patch.champions) { c in
                            Link(destination: URL(string: "deeparam://champions/\(c.id)")!) { column(c) }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(URL(string: "deeparam://patches/\(s.patch.live ?? "")"))
        } else {
            ConnectView(state: entry.state)
        }
    }

    private func move(_ c: WidgetSummary.Champion) -> some View {
        Group {
            if let d = c.change, d != 0 {
                Text(d > 0 ? "+\(d)" : "\(d)").foregroundStyle(d > 0 ? Palette.good : Palette.worse)
            } else if c.change == nil {
                Text("new").foregroundStyle(.secondary)
            } else {
                Text("±0").foregroundStyle(.secondary)
            }
        }
        .font(.caption2.weight(.semibold))
        .monospacedDigit()
    }

    private func champ(_ c: WidgetSummary.Champion, compact: Bool) -> some View {
        HStack(spacing: 6) {
            Text(c.tier).font(.caption.weight(.heavy)).frame(width: 18).foregroundStyle(Palette.accent).widgetAccentable()
            Text(c.name).font(.caption.weight(.semibold)).lineLimit(1)
            Spacer(minLength: 2)
            Text("\(c.deepScore)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
            move(c)
            if !c.notes.isEmpty { Image(systemName: "wrench.adjustable.fill").font(.caption2).foregroundStyle(Palette.worse) }
        }
    }

    private func column(_ c: WidgetSummary.Champion) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(c.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            HStack(spacing: 4) {
                Text(c.tier).font(.title2.weight(.heavy)).foregroundStyle(Palette.accent).widgetAccentable()
                Text("\(c.deepScore)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            HStack(spacing: 3) {
                move(c)
                if let before = c.tierBefore, before != c.tier { Text("was \(before)").font(.caption2).foregroundStyle(.secondary) }
            }
            if let note = c.notes.first {
                Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
