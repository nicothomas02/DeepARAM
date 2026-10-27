import SwiftUI

/// Champions pinned to the top of the home screen, kept on the watch.
struct Favorites: DynamicProperty {
    @AppStorage("deeparam.favorites") private var raw = ""

    var ids: [String] { raw.split(separator: ",").map(String.init) }

    func contains(_ id: String) -> Bool { ids.contains(id) }

    func toggle(_ id: String) {
        var list = ids
        if let i = list.firstIndex(of: id) { list.remove(at: i) } else { list.append(id) }
        raw = list.joined(separator: ",")
    }
}
