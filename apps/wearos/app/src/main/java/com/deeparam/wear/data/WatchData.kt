package com.deeparam.wear.data

import kotlinx.serialization.Serializable
import java.text.Normalizer

/** Everything the watch shows, in the shape of the site's /data/watch.json. */
@Serializable
data class WatchData(
    /** Live patch, like "16.21". */
    val patch: String? = null,
    val chefsSpecial: ChefsSpecial? = null,
    val champions: List<Champion> = emptyList(),
) {
    fun champion(id: String): Champion? = champions.firstOrNull { it.id == id }

    /** Champions whose name starts with or contains the search text, best matches first. */
    fun search(text: String): List<Champion> {
        val q = fold(text.trim())
        if (q.isEmpty()) return champions
        val starts = champions.filter { fold(it.name).startsWith(q) }
        val contains = champions.filter { !fold(it.name).startsWith(q) && fold(it.name).contains(q) }
        return starts + contains
    }

    private fun fold(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
}

/** One champion's quick reference: what to max, what to buy, which augments to take. */
@Serializable
data class Champion(
    /** The site's champion id, like "MissFortune". Also names the icon. */
    val id: String,
    val name: String,
    /** Live-patch tier, like "S". Missing when the champion has too few games. */
    val tier: String? = null,
    val winRate: Double? = null,
    /** Skill max order, like ["Q", "E", "W"]. */
    val skills: List<String> = emptyList(),
    /** Boots first, then the build that wins most. */
    val items: List<String> = emptyList(),
    /** Top augments by rarity, best first. */
    val augments: Augments = Augments(),
) {
    val iconUrl: String get() = WatchFeed.url("/icons/champions/$id.webp")
}

@Serializable
data class Augments(
    val prismatic: List<String> = emptyList(),
    val gold: List<String> = emptyList(),
    val silver: List<String> = emptyList(),
) {
    val isEmpty: Boolean get() = prismatic.isEmpty() && gold.isEmpty() && silver.isEmpty()

    /** Rarity name and its augments, highest rarity first, skipping empty ones. */
    val byRarity: List<Pair<String, List<String>>>
        get() = listOf("Prismatic" to prismatic, "Gold" to gold, "Silver" to silver).filter { it.second.isNotEmpty() }
}

/** The Kitchen's one unusual build of the day. */
@Serializable
data class ChefsSpecial(
    val title: String,
    /** Champion id, like "RekSai". */
    val champion: String,
    /** Display name, like "Rek'Sai". */
    val name: String,
    val tier: String? = null,
    val play: String? = null,
    val items: List<String> = emptyList(),
    val augments: List<Augment> = emptyList(),
) {
    @Serializable
    data class Augment(val name: String, val rarity: String)

    val iconUrl: String get() = WatchFeed.url("/icons/champions/$champion.webp")
}
