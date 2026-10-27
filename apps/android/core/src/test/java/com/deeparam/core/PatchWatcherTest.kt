package com.deeparam.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PatchWatcherTest {
    private class Memory : SeenStore {
        override var lastPatch: String? = null
        override var lastPBE: String? = null
    }

    @Test fun comparesNumbersNotText() {
        assertTrue(PatchWatcher.compare("26.10", "26.9") > 0)
        assertTrue(PatchWatcher.compare("27.1", "26.24") > 0)
        assertEquals(0, PatchWatcher.compare("26.1", "26.1"))
    }

    @Test fun publicPatchNumbers() {
        assertEquals("26.21", PatchWatcher.publicPatch("16.21"))
        assertEquals("26.21", PatchWatcher.publicPatch("26.21"))
        assertEquals("25.24", PatchWatcher.publicPatch("15.24"))
    }

    @Test fun sitemapNewestFirst() {
        val xml = "<url><loc>https://deeparam.com/patches/26.9</loc></url><url><loc>https://deeparam.com/patches/26.21</loc></url>" +
            "<url><loc>https://deeparam.com/patches/26.20</loc></url><url><loc>https://deeparam.com/patches/26.21</loc></url>"
        assertEquals(listOf("26.21", "26.20", "26.9"), PatchWatcher.patchesInSitemap(xml))
    }

    @Test fun parsesFeeds() {
        assertEquals("26.21", PatchWatcher.parseWatch("""{"patch":"16.21","champions":[]}"""))
        assertEquals(SiteStatus("26.21", "abc"), PatchWatcher.parseAppStatus("""{"livePatch":"26.21","pbeBuild":"abc"}"""))
    }

    @Test fun firstCheckOnlyRecords() {
        val seen = Memory()
        val w = PatchWatcher(seen)
        assertEquals(emptyList<SiteNews>(), w.news(SiteStatus("26.20", "a")))
        assertEquals("26.20", seen.lastPatch)
        assertEquals(listOf(SiteNews.NewPatch("26.21"), SiteNews.NewPBE("b")), w.news(SiteStatus("26.21", "b")))
        assertEquals(emptyList<SiteNews>(), w.news(SiteStatus("26.21", "b")))
        // An older patch from a stale cache never moves the record back.
        assertEquals(emptyList<SiteNews>(), w.news(SiteStatus("26.19")))
        assertEquals("26.21", seen.lastPatch)
    }

    @Test fun fallsBackToWatchThenSitemap() = runBlocking {
        val feeds = mapOf(
            Site.url("/data/watch.json") to """{"patch":"16.21"}""",
            Site.url("/sitemap.xml") to "<loc>https://deeparam.com/patches/26.20</loc>",
        )
        assertEquals(SiteStatus("26.21"), PatchWatcher(Memory()) { feeds[it] }.status())
        assertEquals(SiteStatus("26.20"), PatchWatcher(Memory()) { if (it.endsWith("sitemap.xml")) feeds[it] else null }.status())
    }
}
