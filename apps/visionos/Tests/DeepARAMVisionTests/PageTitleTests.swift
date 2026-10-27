import XCTest
import DeepARAMKit
@testable import DeepARAMVision

final class PageTitleTests: XCTestCase {
    func testTabPagesUseTheTabName() {
        XCTAssertEqual(PageTitle.title(for: Site.url("/")), "Home")
        XCTAssertEqual(PageTitle.title(for: Site.url("/pbe")), "PBE")
        XCTAssertEqual(PageTitle.title(for: Site.url("/simulator?tab=survival")), "Simulator")
    }

    func testDeeperPagesUseTheirOwnName() {
        XCTAssertEqual(PageTitle.title(for: Site.url("/champions/miss-fortune")), "Miss Fortune")
        XCTAssertEqual(PageTitle.title(for: Site.url("/patches/16.20")), "16.20")
    }

    func testDeeperPagesBelongToTheirTab() {
        XCTAssertEqual(PageTitle.tab(for: Site.url("/patches/16.20"))?.id, "patches")
        XCTAssertEqual(PageTitle.tab(for: Site.url("/pbe/changes"))?.id, "pbe")
        XCTAssertEqual(PageTitle.tab(for: Site.url("/champions/ahri"))?.id, nil)
    }
}
