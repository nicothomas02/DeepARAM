// swift-tools-version:5.9
import PackageDescription

// Shared by the DeepARAM apps (iPhone, iPad, Vision Pro, Mac): which site pages each tab shows,
// the web view that shows them, offline copies and the new-patch check.
let package = Package(
    name: "DeepARAMKit",
    platforms: [.iOS(.v17), .macOS(.v14), .visionOS(.v1)],
    products: [.library(name: "DeepARAMKit", targets: ["DeepARAMKit"])],
    targets: [
        .target(name: "DeepARAMKit"),
        .testTarget(name: "DeepARAMKitTests", dependencies: ["DeepARAMKit"]),
    ]
)
