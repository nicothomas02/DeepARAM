package com.deeparam.tv

import com.deeparam.tv.ui.championsByTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvParserTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test
    fun readsTvJson() {
        val data = TvParser.parseTv(fixture("tv.json"))
        assertEquals("26.21", data.patch)
        val ahri = data.champions.first { it.id == "Ahri" }
        assertEquals("A", ahri.tier)
        assertEquals(0.5179, ahri.winRate!!, 1e-9)
        assertEquals("/icons/champions/Ahri.webp", ahri.icon)
        assertEquals(listOf("Q", "E", "W"), ahri.skills)
        assertEquals(Named("Rabadon's Deathcap", "/icons/items/3089.webp"), ahri.items[1])
        assertEquals(listOf("prismatic", "gold"), ahri.augments.map { it.first })
        assertEquals(2, data.augments.size)
        assertEquals("prismatic", data.augments[0].rarity)
        val chef = data.chefsSpecial!!
        assertEquals("RekSai", chef.champion)
        assertTrue(chef.augments.first { it.name == "Multishot" }.core)
        val pbe = data.pbe!!
        assertEquals("PBE 26.22", pbe.label)
        assertEquals(listOf("New augments", "Changed augments", "Champions", "Mode"), pbe.sections.map { it.title })
        assertEquals("Augment pool: 210 on live, 214 on PBE", pbe.augmentPool)
        val jinx = pbe.sections.first { it.title == "Champions" }.entries.single()
        assertEquals("Jinx", jinx.name)
        assertEquals(listOf("Q bonus range 100 → 125"), jinx.lines)
        val eureka = pbe.sections.first { it.title == "Changed augments" }.entries.single()
        assertEquals(listOf("Ability haste: 30 → 25"), eureka.lines)
        assertEquals("prismatic", eureka.rarity)
        val added = pbe.sections.first().entries.single()
        assertEquals("/icons/augments/9001.webp", added.icon)
    }

    @Test
    fun readsWatchJsonWithNumericIcons() {
        val data = TvParser.parseWatch(fixture("watch.json"), fixture("champion-tiers.json"))
        assertEquals("26.21", data.patch)
        val ahri = data.champions.first { it.id == "Ahri" }
        assertEquals("/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/103.png", ahri.icon)
        assertEquals("Sorcerer's Shoes", ahri.items.first().name)
        assertNull(ahri.items.first().icon)
        assertTrue(data.augments.isEmpty())
        assertNull(data.pbe)
        assertEquals("Mole Artillery", data.chefsSpecial!!.title)
    }

    @Test
    fun missingFieldsDoNotThrow() {
        val data = TvParser.parseTv("""{"champions":[{"id":"Zed"},{"name":"no id"}],"pbe":{}}""")
        assertEquals(1, data.champions.size)
        assertEquals("Zed", data.champions[0].name)
        assertNull(data.champions[0].tier)
        assertTrue(data.pbe!!.sections.isEmpty())
    }

    @Test
    fun publicPatchMatchesTheSite() {
        assertEquals("26.20", publicPatch("16.20"))
        assertEquals("25.24", publicPatch("15.24"))
        assertEquals("26.1", publicPatch("26.01"))
        assertEquals("", publicPatch(""))
    }

    @Test
    fun tiersSortBestFirst() {
        val data = TvParser.parseTv(fixture("tv.json"))
        val groups = championsByTier(data.champions)
        assertEquals(listOf("S", "A", ""), groups.map { it.first })
        assertEquals(listOf("Ahri", "Akali"), groups[1].second.map { it.id })
    }

    @Test
    fun siteUrls() {
        assertEquals("https://deeparam.com/icons/a.webp", siteUrl("/icons/a.webp"))
        assertEquals("https://deeparam.com/icons/a.webp", siteUrl("icons/a.webp"))
        assertNull(siteUrl(null))
        assertEquals("51.8%", percent(0.5179))
    }
}
