package com.deeparam.tv

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

// Everything the TV app shows, decoded from /data/tv.json (or, before that route exists,
// /data/watch.json joined with /data/champion-tiers.json for numeric champion ids).

const val SITE = "https://deeparam.com"

data class Named(val name: String, val icon: String? = null)

data class Champion(
    val id: String,
    val name: String,
    val tier: String?,
    val winRate: Double?,
    val pickRate: Double?,
    val icon: String?,
    val skills: List<String>,
    val items: List<Named>,
    /** "prismatic", "gold", "silver" in that order. */
    val augments: List<Pair<String, List<Named>>>,
)

data class AugmentTier(
    val name: String,
    val rarity: String,
    val tier: String?,
    val winRate: Double?,
    val pickRate: Double?,
    val icon: String?,
)

data class ChefAugment(val name: String, val rarity: String, val core: Boolean, val icon: String? = null)

data class ChefSpecial(
    val title: String,
    val champion: String,
    val name: String,
    val icon: String?,
    val date: String?,
    val why: String?,
    val play: String?,
    val items: List<Named>,
    val augments: List<ChefAugment>,
)

data class PbeEntry(val name: String, val lines: List<String>, val icon: String? = null, val rarity: String? = null)

data class PbeSection(val title: String, val entries: List<PbeEntry>)

data class Pbe(
    val label: String?,
    val dataAsOf: String?,
    val caveat: String?,
    val augmentPool: String?,
    val sections: List<PbeSection>,
)

data class TvData(
    val patch: String,
    val champions: List<Champion>,
    val augments: List<AugmentTier>,
    val chefsSpecial: ChefSpecial?,
    val pbe: Pbe?,
)

val TIERS = listOf("S", "A", "B", "C", "D")
val RARITIES = listOf("prismatic", "gold", "silver")

/** Full URL for a site path such as "/icons/champions/Ahri.webp". */
fun siteUrl(path: String?): String? = when {
    path.isNullOrBlank() -> null
    path.startsWith("http") -> path
    else -> SITE + (if (path.startsWith("/")) path else "/$path")
}

/** The patch number players know: "16.21" -> "26.21", "26.01" -> "26.1". Same rule as the site. */
fun publicPatch(patch: String): String {
    val m = Regex("""^(\d+)\.(\d+)""").find(patch) ?: return patch
    val major = m.groupValues[1].toInt()
    val minor = m.groupValues[2].toInt()
    return "${if (major in 10..19) major + 10 else major}.$minor"
}

/** "0.5179" -> "51.8%". */
fun percent(value: Double?): String? = value?.let { String.format(java.util.Locale.US, "%.1f%%", it * 100) }

object TvParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parseTv(text: String): TvData {
        val root = json.parseToJsonElement(text).obj()
        return TvData(
            patch = publicPatch(root.str("patch") ?: ""),
            champions = root.arr("champions").mapNotNull { champion(it.obj()) },
            augments = root.arr("augments").mapNotNull { augmentTier(it.obj()) },
            chefsSpecial = root["chefsSpecial"]?.objOrNull()?.let { chef(it) },
            pbe = root["pbe"]?.objOrNull()?.let { pbe(it) },
        )
    }

    /** Older route: names only, no augment tier list or PBE; icons come from the numeric champion ids. */
    fun parseWatch(watchText: String, championTiersText: String?): TvData {
        val root = json.parseToJsonElement(watchText).obj()
        val numericIds = HashMap<String, String>()
        championTiersText?.let { text ->
            for ((key, value) in json.parseToJsonElement(text).obj()) {
                value.objOrNull()?.str("id")?.let { numericIds[it] = key }
            }
        }
        val champions = root.arr("champions").mapNotNull { element ->
            val c = element.obj()
            val id = c.str("id") ?: return@mapNotNull null
            val icon = numericIds[id]?.let {
                "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/$it.png"
            }
            champion(c)?.copy(icon = icon)
        }
        return TvData(
            patch = publicPatch(root.str("patch") ?: ""),
            champions = champions,
            augments = emptyList(),
            chefsSpecial = root["chefsSpecial"]?.objOrNull()?.let { chef(it) },
            pbe = null,
        )
    }

    private fun champion(c: JsonObject): Champion? {
        val id = c.str("id") ?: return null
        val augs = c["augments"]?.objOrNull()
        return Champion(
            id = id,
            name = c.str("name") ?: id,
            tier = c.str("tier"),
            winRate = c.num("winRate"),
            pickRate = c.num("pickRate"),
            icon = c.str("icon"),
            skills = c.arr("skills").mapNotNull { it.strOrNull() },
            items = c.arr("items").mapNotNull { named(it) },
            augments = RARITIES.mapNotNull { r ->
                val list = augs?.arr(r)?.mapNotNull { named(it) }.orEmpty()
                if (list.isEmpty()) null else r to list
            },
        )
    }

    private fun augmentTier(a: JsonObject): AugmentTier? {
        val name = a.str("name") ?: return null
        return AugmentTier(
            name = name,
            rarity = a.str("rarity") ?: "silver",
            tier = a.str("tier"),
            winRate = a.num("winRate"),
            pickRate = a.num("pickRate"),
            icon = a.str("icon"),
        )
    }

    private fun chef(c: JsonObject): ChefSpecial? {
        val champion = c.str("champion") ?: return null
        return ChefSpecial(
            title = c.str("title") ?: "",
            champion = champion,
            name = c.str("name") ?: champion,
            icon = c.str("icon"),
            date = c.str("date"),
            why = c.str("why"),
            play = c.str("play"),
            items = c.arr("items").mapNotNull { named(it) },
            augments = c.arr("augments").mapNotNull { element ->
                when (element) {
                    is JsonPrimitive -> element.strOrNull()?.let { ChefAugment(it, "silver", false) }
                    is JsonObject -> element.str("name")?.let {
                        ChefAugment(it, element.str("rarity") ?: "silver", (element["core"] as? JsonPrimitive)?.booleanOrNull ?: false, element.str("icon"))
                    }
                    else -> null
                }
            },
        )
    }

    private fun pbe(p: JsonObject): Pbe {
        val augs = p["augments"]?.objOrNull()
        fun augEntries(key: String, line: (JsonObject) -> List<String>) = augs?.arr(key)?.mapNotNull { e ->
            val a = e.objOrNull() ?: return@mapNotNull null
            val name = a.str("name") ?: return@mapNotNull null
            PbeEntry(name, line(a), a.str("icon"), a.str("rarity"))
        }.orEmpty()
        fun listEntries(key: String, nameKey: String) = p.arr(key).mapNotNull { e ->
            val c = e.objOrNull() ?: return@mapNotNull null
            val name = c.str(nameKey) ?: return@mapNotNull null
            PbeEntry(name, c.arr("changes").mapNotNull { it.strOrNull() })
        }
        val sections = listOf(
            PbeSection("New augments", augEntries("added") { listOfNotNull(it.str("description")) }),
            PbeSection("Changed augments", augEntries("changed") { a ->
                a.arr("changes").mapNotNull { c ->
                    val ch = c.objOrNull() ?: return@mapNotNull c.strOrNull()
                    val stat = ch.str("stat") ?: return@mapNotNull null
                    "$stat: ${ch.text("live") ?: "–"} → ${ch.text("pbe") ?: "–"}"
                }
            }),
            PbeSection("Removed augments", augEntries("removed") { emptyList() }),
            PbeSection("Champions", listEntries("championChanges", "champion")),
            PbeSection("Items", listEntries("itemChanges", "item")),
            PbeSection("Mode", p.arr("modeChanges").mapNotNull { it.strOrNull()?.let { m -> PbeEntry(m, emptyList()) } }),
        ).filter { it.entries.isNotEmpty() }
        val pool = p["augmentPool"]?.objOrNull()
        val poolLine = pool?.let {
            val live = it.text("live"); val pbe = it.text("pbe")
            if (live != null && pbe != null) "Augment pool: $live on live, $pbe on PBE" else null
        }
        return Pbe(
            label = p.str("label"),
            dataAsOf = p.str("dataAsOf"),
            caveat = p.str("caveat"),
            augmentPool = poolLine,
            sections = sections,
        )
    }

    private fun named(e: JsonElement): Named? = when (e) {
        is JsonPrimitive -> e.strOrNull()?.let { Named(it) }
        is JsonObject -> e.str("name")?.let { Named(it, e.str("icon")) }
        else -> null
    }

    private fun JsonElement.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonElement.objOrNull(): JsonObject? = this as? JsonObject
    private fun JsonElement.strOrNull(): String? =
        (this as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
    private fun JsonObject.str(key: String): String? = this[key]?.strOrNull()
    /** A string or number field as text ("12", "0.5", "30%"). */
    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.takeIf { it.isNotBlank() }
    private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
    private fun JsonObject.arr(key: String): JsonArray = this[key] as? JsonArray ?: JsonArray(emptyList())
}
