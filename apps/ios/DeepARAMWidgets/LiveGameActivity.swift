import ActivityKit
import DeepARAMKit
import SwiftUI
import WidgetKit

/// The live game on the Lock Screen, in the Dynamic Island and full screen in StandBy. The owner's PC app starts,
/// updates and ends it with pushes; nothing here polls. The clock ticks on the phone from the game's start time.
struct LiveGameActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveGameAttributes.self) { context in
            LiveGameCard(game: context.state, large: false)
                .padding(14)
                .activityBackgroundTint(Palette.background)
                .activitySystemActionForegroundColor(Palette.accent)
                .widgetURL(URL(string: "deeparam://champions/\(context.state.championId)"))
        } dynamicIsland: { context in
            let g = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(g.champion).font(.headline).lineLimit(1)
                        Text("Lv \(g.level) · \(g.kda)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(g.startDate, style: .timer).font(.headline).monospacedDigit().multilineTextAlignment(.trailing)
                        if let win = g.winPercent { Text("Win \(win)").font(.caption).foregroundStyle(Palette.accent) }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(g.headline).font(.subheadline.weight(.semibold))
                        .foregroundStyle(g.augmentReady ? Palette.accent : .primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: g.augmentReady ? "sparkles" : "gamecontroller.fill").foregroundStyle(Palette.accent)
            } compactTrailing: {
                Text(g.startDate, style: .timer).monospacedDigit().frame(maxWidth: 48)
            } minimal: {
                Image(systemName: g.augmentReady ? "sparkles" : "gamecontroller.fill").foregroundStyle(Palette.accent)
            }
            .widgetURL(URL(string: "deeparam://champions/\(g.championId)"))
        }
    }
}

/// One live game panel, shared by the Live Activity and the widgets while a game is on.
struct LiveGameCard: View {
    let game: LiveGame
    var large: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: large ? 10 : 6) {
            HStack(alignment: .firstTextBaseline) {
                Label("In game", systemImage: "gamecontroller.fill").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                Spacer()
                Text(game.startDate, style: .timer).font(.caption.weight(.semibold)).monospacedDigit().multilineTextAlignment(.trailing)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(game.champion).font(large ? .title2.weight(.bold) : .headline).lineLimit(1).widgetAccentable()
                Text("Lv \(game.level)").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(game.kda).font(large ? .title3.weight(.semibold) : .subheadline.weight(.semibold)).monospacedDigit()
            }
            Text(game.headline).font(large ? .headline : .subheadline.weight(.semibold))
                .foregroundStyle(game.augmentReady ? Palette.accent : game.dead ? Palette.worse : .primary)
                .lineLimit(2)
            if large {
                if game.nextItems.count > 1 {
                    Text("Then \(game.nextItems[1])").font(.caption).foregroundStyle(.secondary)
                }
                if let next = game.nextAugment, !game.augmentReady {
                    Text("Next augment at level \(next)").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let win = game.winChance {
                HStack(spacing: 6) {
                    Text("Win \(game.winPercent ?? "")").font(.caption2.weight(.semibold)).monospacedDigit()
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.secondary.opacity(0.3))
                            Capsule().fill(win >= 0.5 ? Palette.good : Palette.worse).frame(width: g.size.width * win)
                        }
                    }
                    .frame(height: 5)
                }
                Text("Predicted").font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }
}
