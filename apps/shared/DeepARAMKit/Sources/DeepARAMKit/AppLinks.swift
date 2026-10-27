import Combine
import Foundation

/// Pages the app was asked to open from outside a web view: Home Screen quick actions, Siri and
/// Spotlight shortcuts, and deeparam:// links. The root view opens `pending` and clears it.
@MainActor
public final class AppLinks: ObservableObject {
    public static let shared = AppLinks()

    @Published public var pending: URL?

    public init() {}

    public func open(_ url: URL) { pending = Site.pageURL(forAppLink: url) }
}
