import AppIntents
import DeepARAMKit

/// Pages Siri, Spotlight and the Shortcuts app can open: "Open Pentakill in DeepARAM".
enum ShortcutPage: String, AppEnum, CaseIterable {
    case tierList, augments, items, weaponOfDestiny, pentakill, simulator, chefSpecial, infiniteRyze, pbe, patches

    static var typeDisplayRepresentation: TypeDisplayRepresentation { TypeDisplayRepresentation(name: "Page") }

    static var caseDisplayRepresentations: [ShortcutPage: DisplayRepresentation] {
        [
            .tierList: DisplayRepresentation(title: "Tier List", image: .init(systemName: "chart.bar.fill")),
            .augments: DisplayRepresentation(title: "Augments", image: .init(systemName: "sparkles")),
            .items: DisplayRepresentation(title: "Items", image: .init(systemName: "shield.lefthalf.filled")),
            .weaponOfDestiny: DisplayRepresentation(title: "Weapon of Destiny", image: .init(systemName: "wand.and.stars")),
            .pentakill: DisplayRepresentation(title: "Pentakill", image: .init(systemName: "hand.raised.fingers.spread.fill")),
            .simulator: DisplayRepresentation(title: "Simulator", image: .init(systemName: "bolt.fill")),
            .chefSpecial: DisplayRepresentation(title: "Chef Special", image: .init(systemName: "frying.pan.fill")),
            .infiniteRyze: DisplayRepresentation(title: "Infinite Ryze", image: .init(systemName: "infinity")),
            .pbe: DisplayRepresentation(title: "PBE", image: .init(systemName: "flask.fill")),
            .patches: DisplayRepresentation(title: "Patch Recaps", image: .init(systemName: "doc.text.fill")),
        ]
    }

    var path: String {
        switch self {
        case .tierList: "/tier-list?tab=champions"
        case .augments: "/tier-list?tab=augments"
        case .items: "/tier-list?tab=items"
        case .weaponOfDestiny: "/tier-list?tab=weapon-of-destiny"
        case .pentakill: "/tier-list?tab=pentakill"
        case .simulator: "/simulator"
        case .chefSpecial: "/kitchen"
        case .infiniteRyze: "/kitchen?tab=infinite-ryze"
        case .pbe: "/pbe"
        case .patches: "/patches"
        }
    }
}

struct OpenPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Open DeepARAM Page"
    static var description = IntentDescription("Opens a DeepARAM page, such as the tier list or today's Chef Special.")
    static var openAppWhenRun = true

    @Parameter(title: "Page")
    var page: ShortcutPage

    init() {}

    init(page: ShortcutPage) {
        self.page = page
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppLinks.shared.open(Site.url(page.path))
        return .result()
    }
}

struct DeepARAMShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenPageIntent(),
            phrases: [
                "Open \(\.$page) in \(.applicationName)",
                "Show \(\.$page) on \(.applicationName)",
            ],
            shortTitle: "Open Page",
            systemImageName: "chart.bar.fill"
        )
    }
}
