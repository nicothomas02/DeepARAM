import DeepARAMKit
import SwiftUI

/// Menu commands for the iPad layout. Add with `.commands { PadCommands() }`; on iPad, holding ⌘ shows them with their shortcuts.
public struct PadCommands: Commands {
    @FocusedObject private var model: PadModel?

    public init() {}

    private static let keys: [KeyEquivalent] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]

    public var body: some Commands {
        CommandMenu("Go") {
            ForEach(Array(SiteTab.padSections.enumerated()), id: \.element) { index, section in
                Button(section.title) { model?.section = section }
                    .keyboardShortcut(index < Self.keys.count ? KeyboardShortcut(Self.keys[index], modifiers: .command) : nil)
            }
            Divider()
            Button("Next Tab") { model?.stepSubtab(1) }
                .keyboardShortcut(.tab, modifiers: .control)
                .disabled(model?.section?.padSubtabs.isEmpty != false)
            Button("Previous Tab") { model?.stepSubtab(-1) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
                .disabled(model?.section?.padSubtabs.isEmpty != false)
            Divider()
            Button("Back") { model?.active?.page.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(model?.active?.page.canGoBack != true)
            Button("Forward") { model?.active?.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(model?.active?.canGoForward != true)
            Button("Scroll to Top") { model?.active?.scrollToTop() }
                .keyboardShortcut(.upArrow, modifiers: .command)
        }
        CommandGroup(after: .textEditing) {
            Button("Find Champion or Page") { model?.searchPresented = true }
                .keyboardShortcut("f", modifiers: .command)
            Button("Search This Page") { model?.current?.focusPageSearch() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
        }
        CommandGroup(after: .sidebar) {
            Button("Reload Page") { model?.active?.page.reload() }
                .keyboardShortcut("r", modifiers: .command)
            Button(model?.showChampionPane == true ? "Hide Champion Pane" : "Show Champion Pane") {
                model?.toggleChampionPane()
            }
            .keyboardShortcut("c", modifiers: [.command, .option])
            .disabled(model?.isRegularWidth != true)
            Button("All Champions") { model?.showChampionGrid() }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(model?.isRegularWidth != true)
        }
    }
}
