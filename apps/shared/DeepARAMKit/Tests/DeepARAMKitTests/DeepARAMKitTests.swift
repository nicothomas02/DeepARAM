import XCTest
@testable import DeepARAMKit

final class DeepARAMKitTests: XCTestCase {
    func testPatchOrderIsNumeric() {
        XCTAssertEqual(PatchWatcher.compare("16.10", "16.9"), 1)
        XCTAssertEqual(PatchWatcher.compare("16.9", "16.9"), 0)
        XCTAssertEqual(PatchWatcher.compare("15.24", "16.1"), -1)
    }

    func testPatchesFromSitemap() {
        let xml = "<loc>https://deeparam.com/patches</loc><loc>https://deeparam.com/patches/16.9</loc><loc>https://deeparam.com/patches/16.20</loc>"
        XCTAssertEqual(PatchWatcher.patches(inSitemap: xml), ["16.20", "16.9"])
    }

    func testInternalLinks() {
        XCTAssertTrue(Site.isInternal(URL(string: "https://deeparam.com/pbe")!))
        XCTAssertTrue(Site.isInternal(URL(string: "https://www.deeparam.com/")!))
        XCTAssertFalse(Site.isInternal(URL(string: "https://ko-fi.com/x")!))
    }

    func testOfflineFileNamesDiffer() {
        let s = OfflineStore(folder: URL(fileURLWithPath: "/tmp"))
        XCTAssertNotEqual(s.fileURL(for: Site.url("/")), s.fileURL(for: Site.url("/pbe")))
    }

    func testPatchNamesFollowTheSite() {
        XCTAssertEqual(Site.patchName("16.21"), "26.21")
        XCTAssertEqual(Site.patchName("15.24"), "25.24")
        XCTAssertEqual(Site.patchName("26.01"), "26.1")
    }

    func testAppLinksOpenSitePages() {
        XCTAssertEqual(Site.pageURL(forAppLink: URL(string: "deeparam://champions/Ahri")!)?.absoluteString,
                       "https://deeparam.com/champions/Ahri")
        XCTAssertEqual(Site.pageURL(forAppLink: URL(string: "deeparam://tier-list?tab=augments")!)?.absoluteString,
                       "https://deeparam.com/tier-list?tab=augments")
        XCTAssertEqual(Site.pageURL(forAppLink: URL(string: "deeparam://")!)?.absoluteString, "https://deeparam.com/")
        XCTAssertEqual(Site.pageURL(forAppLink: URL(string: "https://deeparam.com/pbe")!)?.absoluteString,
                       "https://deeparam.com/pbe")
        XCTAssertNil(Site.pageURL(forAppLink: URL(string: "https://example.com/")!))
    }

    func testQuickBuildsDecodeAndSearch() throws {
        let json = """
        {"patch":"16.21","chefsSpecial":{"title":"Mole Artillery","champion":"RekSai","name":"Rek'Sai","tier":null,
         "play":"Burrow early.","items":["Horizon Focus"],"augments":[{"name":"Multishot","rarity":"prismatic"}]},
         "champions":[
          {"id":"Kaisa","name":"Kai'Sa","tier":"A","winRate":0.52,"skills":["Q","E","W"],"items":["Kraken Slayer"],
           "augments":{"prismatic":["Final Form"],"gold":[],"silver":[]}},
          {"id":"Nunu","name":"Nunu & Willump","tier":null,"winRate":null,"skills":["Q","W","E"],"items":[],
           "augments":{"prismatic":[],"gold":[],"silver":[]}},
          {"id":"Akali","name":"Akali","tier":"B","winRate":0.5,"skills":["Q","E","W"],"items":[],
           "augments":{"prismatic":[],"gold":[],"silver":[]}}]}
        """
        let builds = try JSONDecoder().decode(QuickBuilds.self, from: Data(json.utf8))
        XCTAssertEqual(builds.patchName, "26.21")
        XCTAssertEqual(builds.chefsSpecial?.name, "Rek'Sai")
        XCTAssertEqual(builds.search("kaisa").map(\.id), ["Kaisa"])
        XCTAssertEqual(builds.search("nunu willump").map(\.id), ["Nunu"])
        // Names starting with the query come before names that only contain it.
        XCTAssertEqual(builds.search("ka").map(\.id), ["Kaisa", "Akali"])
        XCTAssertEqual(builds.search("  ").count, 0)
        XCTAssertEqual(builds.champions[0].skillOrder, "Q > E > W")
        XCTAssertEqual(builds.champions[0].url.absoluteString, "https://deeparam.com/champions/Kaisa")
    }

    func testTabForLink() {
        XCTAssertEqual(SiteTab.tab(for: Site.url("/"))?.id, "home")
        XCTAssertEqual(SiteTab.tab(for: Site.url("/tier-list?tab=pentakill"))?.id, "tiers")
        XCTAssertEqual(SiteTab.tab(for: Site.url("/kitchen/2026-10-26"))?.id, "kitchen")
        XCTAssertEqual(SiteTab.tab(for: Site.url("/pbe"))?.id, "pbe")
        XCTAssertEqual(SiteTab.tab(for: Site.url("/stats"))?.id, "account")
        XCTAssertNil(SiteTab.tab(for: URL(string: "https://ko-fi.com/x")!))
    }

    func testTabsMatchTheSite() {
        XCTAssertEqual(SiteTab.primary.map(\.path), ["/", "/tier-list", "/simulator", "/kitchen"])
        XCTAssertEqual(Set((SiteTab.primary + SiteTab.more).map(\.id)).count, SiteTab.primary.count + SiteTab.more.count)
        XCTAssertTrue(SiteTab.tiers.sections.contains { $0.path == "/tier-list?tab=weapon-of-destiny" })
        for tab in SiteTab.primary + SiteTab.more {
            for link in tab.sections { XCTAssertEqual(SiteTab.tab(for: link.url), tab) }
        }
    }
}
