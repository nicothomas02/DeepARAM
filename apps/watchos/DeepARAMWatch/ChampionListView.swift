import DeepARAMWatchKit
import SwiftUI

/// Every champion, searchable by name (dictation or scribble).
struct ChampionListView: View {
    @Environment(WatchStore.self) private var store
    @State private var query = ""

    var body: some View {
        List(store.data?.search(query) ?? []) { c in
            NavigationLink(value: Route.champion(c.id)) { ChampionRow(champion: c) }
        }
        .searchable(text: $query, prompt: "Champion")
        .navigationTitle("Champions")
    }
}
