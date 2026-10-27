#if os(visionOS)
import DeepARAMKit
import SwiftUI

/// Every champion with a 3D model, in a searchable grid. Choosing one opens it in a volume.
struct ChampionGallery: View {
    @ObservedObject private var store = ChampionModelStore.shared
    @Environment(\.openWindow) private var openWindow
    @State private var search = ""

    var body: some View {
        Group {
            if let models = store.models {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 16)], spacing: 16) {
                        ForEach(models.all.filter(matches)) { model in
                            Button { openWindow(id: ChampionVolume.id, value: model.id) } label: {
                                VStack(spacing: 8) {
                                    AsyncImage(url: Site.url("/icons/champions/\(model.id).webp")) { image in
                                        image.resizable().scaledToFill()
                                    } placeholder: {
                                        Image(systemName: "cube").font(.title)
                                    }
                                    .frame(width: 72, height: 72)
                                    .clipShape(.rect(cornerRadius: 16))
                                    Text(model.name).font(.callout).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                            }
                            .buttonStyle(.borderless)
                            .buttonBorderShape(.roundedRectangle(radius: 20))
                        }
                    }
                    .padding(24)
                }
                .searchable(text: $search, prompt: "Champion")
            } else {
                ProgressView()
            }
        }
        .navigationTitle("3D Champions")
        .task { await store.load() }
    }

    private func matches(_ model: ChampionModels.Model) -> Bool {
        search.isEmpty || model.name.localizedCaseInsensitiveContains(search)
    }
}
#endif
