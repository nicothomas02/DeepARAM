// swift-tools-version:5.9
import PackageDescription

// The Apple Watch app's data: the live patch, today's Chef's Special and a quick reference per
// champion, read from the site and kept on the watch for when it is offline. No UI here, so the
// tests also run on a Mac.
let package = Package(
    name: "DeepARAMWatchKit",
    platforms: [.watchOS(.v10), .macOS(.v14)],
    products: [.library(name: "DeepARAMWatchKit", targets: ["DeepARAMWatchKit"])],
    targets: [
        .target(name: "DeepARAMWatchKit"),
        .testTarget(name: "DeepARAMWatchKitTests", dependencies: ["DeepARAMWatchKit"]),
    ]
)
