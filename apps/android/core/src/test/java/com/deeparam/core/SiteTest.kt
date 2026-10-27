package com.deeparam.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SiteTest {
    @Test fun internalHosts() {
        assertTrue(Site.isInternal("https://deeparam.com/tier-list"))
        assertTrue(Site.isInternal("https://www.deeparam.com/"))
        assertTrue(Site.isInternal("https://DeepARAM.com"))
        assertFalse(Site.isInternal("https://deeparam.com.evil.example/"))
        assertFalse(Site.isInternal("https://evil.example/?u=https://deeparam.com"))
        assertFalse(Site.isInternal("https://deeparam.com@evil.example/"))
        assertFalse(Site.isInternal("mailto:admin@deeparam.com"))
        assertFalse(Site.isInternal(null as String?))
    }

    @Test fun paths() {
        assertEquals("/", Site.pathOf("https://deeparam.com"))
        assertEquals("/", Site.pathOf("https://deeparam.com/"))
        assertEquals("/champions/Ahri", Site.pathOf("https://deeparam.com/champions/Ahri?x=1#builds"))
        assertNull(Site.pathOf("https://example.com/champions"))
        assertEquals("https://deeparam.com/pbe", Site.url("/pbe"))
        assertEquals("https://deeparam.com/pbe", Site.url("pbe"))
    }

    @Test fun tabsForLinks() {
        assertEquals(SiteTab.HOME, SiteTab.forUrl("https://deeparam.com/"))
        assertEquals(SiteTab.TIERS, SiteTab.forUrl("https://deeparam.com/tier-list?tab=augments"))
        assertEquals(SiteTab.SIMULATOR, SiteTab.forUrl("https://deeparam.com/simulator/teamfight"))
        assertEquals("patches", SiteTab.forUrl("https://deeparam.com/patches/26.21").id)
        assertEquals("champions", SiteTab.forUrl("https://deeparam.com/champions/Ahri").id)
        // A page no tab owns opens in Home, never in a look-alike prefix.
        assertEquals(SiteTab.HOME, SiteTab.forUrl("https://deeparam.com/pbe-old"))
        assertEquals(SiteTab.HOME, SiteTab.forUrl("https://deeparam.com/augments/some-augment"))
    }

    @Test fun chromeScriptIsSafeJs() {
        val js = AppChrome.script("android")
        assertTrue(js.contains("d.dataset.app=\"android\""))
        assertTrue(js.contains(".tabbar"))
        assertEquals("\"a\\\"b\"", AppChrome.jsString("a\"b"))
    }
}
