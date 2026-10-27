// swift-tools-version:5.9
import PackageDescription

// The Apple TV app's data: what /data/tv.json holds, loading it with an offline copy, and the grouping
// the screens use. No views here, so `swift test` runs on a Mac without a TV simulator.
let package = Package(
    name: "DeepARAMTVKit",
    platforms: [.tvOS(.v17), .macOS(.v14)],
    products: [.library(name: "DeepARAMTVKit", targets: ["DeepARAMTVKit"])],
    dependencies: [.package(path: "../../shared/DeepARAMKit")],
    targets: [
        .target(name: "DeepARAMTVKit", dependencies: ["DeepARAMKit"]),
        .testTarget(name: "DeepARAMTVKitTests", dependencies: ["DeepARAMTVKit"], resources: [.copy("tv-sample.json")]),
    ]
)
