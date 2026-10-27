#if os(visionOS)
import DeepARAMKit
import RealityKit
import Spatial
import SwiftUI

/// A champion's 3D model in a volume of its own, playing its idle animation. Drag to turn it.
/// Base models only, the same ones the site's champion pages show.
/// The app declares `WindowGroup(id: ChampionVolume.id, for: String.self) { ChampionVolume(championID: $0.wrappedValue) }`
/// with `.windowStyle(.volumetric)` and `.defaultSize(ChampionVolume.size, in: .meters)`.
@MainActor
public struct ChampionVolume: View {
    public static let id = "champion-3d"
    /// Width, height and depth of the volume in meters.
    public static let size = Size3D(width: 0.6, height: 0.8, depth: 0.6)

    @ObservedObject private var store = ChampionModelStore.shared
    @Environment(\.openWindow) private var openWindow
    @State private var pivot = Entity()
    @State private var state = LoadState.loading
    @State private var animation: AnimationPlaybackController?
    @State private var paused = false
    @State private var yaw = 0.0
    @State private var dragStartYaw = 0.0
    private let championID: String?

    enum LoadState { case loading, shown, missing, failed }

    public init(championID: String?) {
        self.championID = championID
    }

    private var model: ChampionModels.Model? {
        championID.flatMap { store.models?.model(for: $0) }
    }

    public var body: some View {
        RealityView { content in
            // The whole volume takes the drag, so it turns even when you miss the model.
            let s = Self.size
            pivot.components.set(InputTargetComponent())
            pivot.components.set(CollisionComponent(shapes: [.generateBox(size: [Float(s.width), Float(s.height), Float(s.depth)])]))
            content.add(pivot)
        } update: { _ in
            pivot.orientation = simd_quatf(angle: Float(yaw), axis: [0, 1, 0])
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .targetedToAnyEntity()
                .onChanged { value in yaw = dragStartYaw + Double(value.translation.width) * .pi / 300 }
                .onEnded { _ in dragStartYaw = yaw }
        )
        .overlay {
            switch state {
            case .loading: ProgressView().controlSize(.large)
            case .missing: message("No 3D model yet", "This champion's model isn't ready yet.", symbol: "cube.transparent")
            case .failed: message("Couldn't load the model", "Check your connection and try again.", symbol: "wifi.slash")
            case .shown: EmptyView()
            }
        }
        .ornament(attachmentAnchor: .scene(.bottomFront)) {
            if let model {
                HStack(spacing: 14) {
                    Text(model.name).font(.title3.weight(.semibold))
                    if animation != nil {
                        Button(paused ? "Play" : "Pause", systemImage: paused ? "play.fill" : "pause.fill") { togglePause() }
                            .labelStyle(.iconOnly)
                    }
                    Button("Champion page", systemImage: "doc.text") {
                        openWindow(id: VisionPageWindow.id, value: Site.url("/champions/" + model.id))
                    }
                    .labelStyle(.iconOnly)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .glassBackgroundEffect()
            }
        }
        .task(id: championID) { await load() }
    }

    private func message(_ title: String, _ detail: String, symbol: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(detail)
        } actions: {
            if state == .failed { Button("Try again") { Task { await load() } } }
        }
        .padding(30)
        .glassBackgroundEffect()
    }

    private func load() async {
        state = .loading
        if store.models == nil { await store.load() }
        guard let model else {
            state = store.models == nil ? .failed : .missing
            return
        }
        do {
            let entity = try await Entity(contentsOf: try await store.file(for: model))
            pivot.children.removeAll()
            Self.fit(entity, in: Self.size)
            pivot.addChild(entity)
            animation = Self.playIdle(in: entity)
            paused = false
            state = .shown
        } catch {
            state = .failed
        }
    }

    private func togglePause() {
        guard let animation else { return }
        if paused { animation.resume() } else { animation.pause() }
        paused.toggle()
    }

    /// Scales the model to fill most of the volume and stands it on the volume's floor, centered.
    static func fit(_ entity: Entity, in size: Size3D) {
        let bounds = entity.visualBounds(relativeTo: nil)
        let extents = bounds.extents
        guard extents.y > 0 else { return }
        let scale = min(Float(size.height) * 0.85 / extents.y,
                        Float(size.width) * 0.9 / max(extents.x, extents.z, 0.001))
        entity.scale *= SIMD3(repeating: scale)
        let fitted = entity.visualBounds(relativeTo: nil)
        let floor = -Float(size.height) / 2 + 0.02
        entity.position += SIMD3(-fitted.center.x, floor - fitted.min.y, -fitted.center.z)
    }

    /// Loops the model's animation (the converted models keep only the idle one).
    static func playIdle(in entity: Entity) -> AnimationPlaybackController? {
        var queue = [entity]
        while !queue.isEmpty {
            let e = queue.removeFirst()
            if let clip = e.availableAnimations.first {
                return e.playAnimation(clip.repeat())
            }
            queue.append(contentsOf: e.children)
        }
        return nil
    }
}
#endif
