// swift-tools-version:5.9
import PackageDescription

// The Apple Vision Pro layout of the DeepARAM app: tabs in the window's side ornament, a page
// toolbar, and any page in a window of its own. The DeepARAM app in apps/ios shows it on visionOS.
let package = Package(
    name: "DeepARAMVision",
    platforms: [.visionOS(.v1), .macOS(.v14)],
    products: [.library(name: "DeepARAMVision", targets: ["DeepARAMVision"])],
    dependencies: [.package(path: "../shared/DeepARAMKit")],
    targets: [
        .target(name: "DeepARAMVision", dependencies: ["DeepARAMKit"]),
        .testTarget(name: "DeepARAMVisionTests", dependencies: ["DeepARAMVision"]),
    ]
)
