import XCTest
@testable import DeepARAMTVKit

final class DeepARAMTVKitTests: XCTestCase {
    /// A trimmed copy of the site's /data/tv.json.
    private func sample() throws -> TVData {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "tv-sample", withExtension: "json"))
        return try TVStore.decode(Data(contentsOf: url))
    }

    func testDecodesTheSiteData() throws {
        let d = try sample()
        XCTAssertEqual(d.patch, "26.21")
        XCTAssertEqual(d.champions.first?.name, "Aatrox")
        XCTAssertEqual(d.champions.first?.icon, "/icons/champions/Aatrox.webp")
        XCTAssertFalse(d.champions[1].items.isEmpty)
        XCTAssertEqual(Set(d.champions[1].augments.keys), ["prismatic", "gold", "silver"])
        XCTAssertNotNil(d.chefsSpecial)
        XCTAssertFalse(try XCTUnwrap(d.pbe).augments.changed.isEmpty)
    }

    func testChampionsGroupBestTierFirst() throws {
        let groups = Tiers.champions(try sample().champions)
        XCTAssertEqual(groups.map(\.tier), ["A", "C", "D"])
        // Within a tier, the higher win rate comes first.
        XCTAssertEqual(groups.last?.rows.map(\.name), ["Akshan", "Akali"])
    }

    func testAugmentsFilterByRarity() throws {
        let groups = Tiers.augments(try sample().augments, rarity: "gold")
        XCTAssertEqual(groups.flatMap(\.rows).count, 3)
        XCTAssertTrue(groups.flatMap(\.rows).allSatisfy { $0.rarity == "gold" })
    }

    func testTierOrder() {
        let rows = ["B", "S", "D", "S+", "A"]
        XCTAssertEqual(Tiers.grouped(rows, tier: { $0 }).map(\.tier), ["S+", "S", "A", "B", "D"])
    }

    func testPercent() {
        XCTAssertEqual(Tiers.percent(0.5179), "51.8%")
        XCTAssertEqual(Tiers.percent(nil), "–")
    }

    func testPictureAddresses() {
        XCTAssertEqual(TVStore.url("/icons/champions/Ahri.webp")?.absoluteString, "https://deeparam.com/icons/champions/Ahri.webp")
        XCTAssertNil(TVStore.url(nil))
    }
}
