import XCTest
@testable import DeepARAMWatchKit

final class DeepARAMWatchKitTests: XCTestCase {
    func testReadsWatchJSON() throws {
        let json = """
        {"patch":"26.21",
         "chefsSpecial":{"title":"The Eye of the Storm","date":"2026-10-26","champion":"Janna","name":"Janna","tier":"Secretly strong",
           "why":"Tornadoes stack.","play":"Walk in first.","items":["Heartsteel"],"augments":[{"name":"Goliath","rarity":"prismatic"}]},
         "champions":[{"id":"Aatrox","name":"Aatrox","tier":"A","winRate":0.51,"deepScore":62,"skills":["Q","E","W"],
           "spells":["Flash","Mark"],"items":["Plated Steelcaps","Sundered Sky"],
           "augments":{"prismatic":["Goliath"],"gold":[],"silver":["Tank Engine"]}}]}
        """
        let d = try JSONDecoder().decode(WatchData.self, from: Data(json.utf8))
        XCTAssertEqual(d.patch, "26.21")
        XCTAssertEqual(d.chefsSpecial?.name, "Janna")
        XCTAssertEqual(d.chefsSpecial?.date, "2026-10-26")
        XCTAssertEqual(d.chefsSpecial?.why, "Tornadoes stack.")
        XCTAssertEqual(d.champion("Aatrox")?.tier, "A")
        XCTAssertEqual(d.champion("Aatrox")?.deepScore, 62)
        XCTAssertEqual(d.champion("Aatrox")?.spells, ["Flash", "Mark"])
        XCTAssertEqual(d.champion("Aatrox")?.augments.byRarity.map(\.rarity), ["Prismatic", "Silver"])
    }

    func testMissingChefsSpecialAndTier() throws {
        let json = #"{"patch":null,"chefsSpecial":null,"champions":[{"id":"Ahri","name":"Ahri","skills":[],"items":[],"augments":{"prismatic":[],"gold":[],"silver":[]}}]}"#
        let d = try JSONDecoder().decode(WatchData.self, from: Data(json.utf8))
        XCTAssertNil(d.chefsSpecial)
        XCTAssertNil(d.champions[0].tier)
        XCTAssertTrue(d.champions[0].augments.isEmpty)
    }

    func testOlderShapeStillDecodes() throws {
        // A copy saved before spells and DeepScore existed (or a champion without them) still loads.
        let json = #"{"patch":"26.20","champions":[{"id":"Ahri","name":"Ahri","tier":"A","skills":["Q","W","E"],"items":["Luden's Echo"],"augments":{"prismatic":[],"gold":["BEES!!!"],"silver":[]}}]}"#
        let c = try XCTUnwrap(JSONDecoder().decode(WatchData.self, from: Data(json.utf8)).champions.first)
        XCTAssertEqual(c.spells, [])
        XCTAssertNil(c.deepScore)
        XCTAssertEqual(c.augments.byRarity.map(\.rarity), ["Gold"])
    }

    func testSearch() {
        let d = WatchData(champions: [
            Champion(id: "Annie", name: "Annie"),
            Champion(id: "Leona", name: "Leona"),
            Champion(id: "Nunu", name: "Nunu & Willump"),
        ])
        XCTAssertEqual(d.search("N").map(\.id), ["Nunu", "Annie", "Leona"])
        XCTAssertEqual(d.search("willump").map(\.id), ["Nunu"])
        XCTAssertEqual(d.search("  ").count, 3)
    }

    func testEncodesWhatItDecodes() throws {
        let c = Champion(id: "Aatrox", name: "Aatrox", tier: "S", winRate: 0.55, deepScore: 80, skills: ["Q", "E", "W"], spells: ["Flash", "Mark"], items: ["Hubris"])
        let back = try JSONDecoder().decode(Champion.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(back, c)
    }

    func testSavesAndLoads() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("w.json")
        let feed = WatchFeed(cacheFile: file)
        XCTAssertNil(feed.load())
        let saved = WatchFeed.Saved(data: WatchData(patch: "26.21"), savedAt: Date(timeIntervalSince1970: 1_000))
        feed.save(saved)
        XCTAssertEqual(feed.load(), saved)
    }
}
