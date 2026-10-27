import XCTest
import DeepARAMKit
@testable import DeepARAMVision

final class ChampionModelsTests: XCTestCase {
    private let json = Data("""
    {
     "Ahri": {"file": "ahri/103000/model.usdz", "name": "Ahri"},
     "MonkeyKing": {"file": "monkeyking/62000/model.usdz", "name": "Wukong"},
     "Aatrox": {"file": "aatrox/266000/model.usdz"}
    }
    """.utf8)

    func testListIsSortedByNameAndPointsAtTheSite() throws {
        let models = try ChampionModels(json: json)
        XCTAssertEqual(models.all.map(\.name), ["Aatrox", "Ahri", "Wukong"])
        XCTAssertEqual(models.model(for: "Ahri")?.url.absoluteString, "https://deeparam.com/assets/models/ahri/103000/model.usdz")
    }

    func testChampionPagesFindTheirModelIgnoringCase() throws {
        let models = try ChampionModels(json: json)
        XCTAssertEqual(models.model(forPage: Site.url("/champions/MonkeyKing"))?.name, "Wukong")
        XCTAssertEqual(models.model(forPage: Site.url("/champions/monkeyking#builds"))?.id, "MonkeyKing")
        XCTAssertEqual(models.model(forPage: Site.url("/champions/ahri?patch=26.20"))?.id, "Ahri")
    }

    func testOtherPagesHaveNoModel() throws {
        let models = try ChampionModels(json: json)
        XCTAssertNil(models.model(forPage: Site.url("/champions")))
        XCTAssertNil(models.model(forPage: Site.url("/champions/Jinx")))
        XCTAssertNil(models.model(forPage: Site.url("/tier-list")))
        XCTAssertNil(models.model(forPage: URL(string: "https://example.com/champions/Ahri")!))
    }
}
