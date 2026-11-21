import DeepARAMKit
import SwiftUI
import WidgetKit

/// Home Screen, Lock Screen and StandBy widgets for between games. Built for the StandBy Modular face on a stand:
/// "This week" as the large one, with "Next game" and "Your champions" as the two small ones beside it.
/// The data is the owner's own, read privately from /api/widget with the token the app saved (More > iPhone widgets).
@main
struct DeepARAMWidgets: WidgetBundle {
    var body: some Widget {
        WeeklyWidget()
        TipWidget()
        PatchWidget()
    }
}

struct WeeklyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "weekly", provider: SummaryProvider()) { entry in
            WeeklyView(entry: entry).widgetBackground()
        }
        .configurationDisplayName("This week")
        .description("Your record and how deaths, damage and fights joined compare with your usual.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TipWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "tip", provider: SummaryProvider()) { entry in
            TipView(entry: entry).widgetBackground()
        }
        .configurationDisplayName("Next game")
        .description("One thing to work on, from where your recent games fell below your usual.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct PatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "patch", provider: SummaryProvider()) { entry in
            PatchView(entry: entry).widgetBackground()
        }
        .configurationDisplayName("Your champions")
        .description("The champions you play most on the live patch: DeepScore tier and how it moved.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
