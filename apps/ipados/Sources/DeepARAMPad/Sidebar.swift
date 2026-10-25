import DeepARAMKit
import SwiftUI

/// Sections, plus search across champions, augments, items and pages.
struct Sidebar: View {
    @ObservedObject var model: PadModel
    @ObservedObject private var search: SearchIndex
    @State private var showAbout = false

    init(model: PadModel) {
        self.model = model
        self.search = model.search
    }

    var body: some View {
        List(selection: $model.section) {
            if model.searchText.isEmpty {
                Section {
                    ForEach(SiteTab.padSections) { section in
                        NavigationLink(value: section) {
                            Label {
                                HStack {
                                    Text(section.title)
                                    if section.isBeta {
                                        Text("Beta")
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(.tint.opacity(0.15), in: Capsule())
                                    }
                                }
                            } icon: {
                                Image(systemName: section.symbol)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            } else {
                results
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("DeepARAM")
        .searchable(text: $model.searchText, isPresented: $model.searchPresented,
                    placement: .sidebar, prompt: "Champions, augments, pages")
        .onSubmit(of: .search) {
            if let first = search.search(model.searchText, limit: 1).first { model.open(first.url) }
        }
        .safeAreaInset(edge: .bottom) { footer }
        .sheet(isPresented: $showAbout) { AboutView(webViews: model.webViews) }
    }

    @ViewBuilder private var results: some View {
        let hits = search.search(model.searchText)
        if hits.isEmpty {
            ContentUnavailableView.search(text: model.searchText)
        } else {
            let groups = Dictionary(grouping: hits, by: \.group)
            ForEach(["Champions", "Pages"] + groups.keys.filter { $0 != "Champions" && $0 != "Pages" }.sorted(), id: \.self) { group in
                if let items = groups[group] {
                    Section(group) {
                        ForEach(items) { item in
                            Button { model.open(item.url) } label: { SearchRow(item: item) }
                                .buttonStyle(.plain)
                                .hoverEffect()
                        }
                    }
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            if let patch = model.status?.livePatch {
                Label("Patch \(patch)", systemImage: "circle.fill")
                    .labelStyle(PatchLabelStyle())
            }
            Spacer()
            Button { showAbout = true } label: { Label("About", systemImage: "info.circle") }
                .labelStyle(.iconOnly)
                .hoverEffect()
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
    }
}

private struct PatchLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 7)).foregroundStyle(.green)
            configuration.title
        }
    }
}

struct SearchRow: View {
    let item: SearchItem

    var body: some View {
        HStack(spacing: 12) {
            ItemIcon(url: item.iconURL, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                if let hint = item.hint {
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .draggable(item.url)
    }
}

/// A champion, augment or item icon, with a neutral square while it loads.
struct ItemIcon: View {
    let url: URL?
    var size: CGFloat

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Color.secondary.opacity(0.15)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
    }
}
