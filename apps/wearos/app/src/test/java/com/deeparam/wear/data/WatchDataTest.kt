package com.deeparam.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class WatchDataTest {
    @get:Rule val tmp = TemporaryFolder()

    private val sample = """
        {"patch":"16.21",
         "chefsSpecial":{"title":"Mole Artillery","champion":"RekSai","name":"Rek'Sai","tier":null,
           "play":"Burrow early.","items":["Horizon Focus"],"augments":[{"name":"Multishot","rarity":"prismatic"}]},
         "champions":[{"id":"Aatrox","name":"Aatrox","tier":"C","winRate":0.4694,"skills":["Q","E","W"],
           "items":["Boots of Swiftness","Hubris"],"augments":{"prismatic":["Goliath"],"gold":[],"silver":["Blunt Force"]},
           "newField":1}]}
    """.trimIndent()

    @Test
    fun readsWatchJson() {
        val d = WatchFeed.json.decodeFromString(WatchData.serializer(), sample)
        assertEquals("16.21", d.patch)
        assertEquals("Rek'Sai", d.chefsSpecial?.name)
        assertEquals("https://deeparam.com/icons/champions/RekSai.webp", d.chefsSpecial?.iconUrl)
        assertEquals("C", d.champion("Aatrox")?.tier)
        assertEquals(listOf("Prismatic", "Silver"), d.champion("Aatrox")?.augments?.byRarity?.map { it.first })
    }

    @Test
    fun missingChefsSpecialAndTier() {
        val json = """{"patch":null,"chefsSpecial":null,"champions":[{"id":"Ahri","name":"Ahri","skills":[],"items":[],"augments":{"prismatic":[],"gold":[],"silver":[]}}]}"""
        val d = WatchFeed.json.decodeFromString(WatchData.serializer(), json)
        assertNull(d.chefsSpecial)
        assertNull(d.champions[0].tier)
        assertTrue(d.champions[0].augments.isEmpty)
    }

    @Test
    fun search() {
        val d = WatchData(champions = listOf(Champion("Annie", "Annie"), Champion("Leona", "Leona"), Champion("Nunu", "Nunu & Willump")))
        assertEquals(listOf("Nunu", "Annie", "Leona"), d.search("N").map { it.id })
        assertEquals(listOf("Nunu"), d.search("willump").map { it.id })
        assertEquals(3, d.search("  ").size)
        assertEquals(listOf("Annie"), d.search("ÁNN").map { it.id })
    }

    @Test
    fun refreshSavesAndLoads() {
        val file = tmp.root.resolve("nested/watch.json")
        var asked = ""
        val feed = WatchFeed(file) { asked = it; sample }
        assertNull(feed.load())
        val saved = feed.refresh(now = 1_000)
        assertEquals("https://deeparam.com/data/watch.json", asked)
        assertEquals(saved, feed.load())
        assertEquals(1_000L, feed.load()?.savedAt)
    }

    @Test
    fun emptyFeedKeepsTheSavedCopy() {
        val file = tmp.root.resolve("watch.json")
        WatchFeed(file) { sample }.refresh(now = 1)
        val broken = WatchFeed(file) { """{"champions":[]}""" }
        try {
            broken.refresh()
            fail("expected an error")
        } catch (_: IOException) {
        }
        assertEquals(1L, broken.load()?.savedAt)
    }
}
