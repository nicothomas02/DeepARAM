package com.deeparam.wear.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Loads the watch's data from the site and keeps the last copy on the watch for when it is offline. */
class WatchFeed(
    private val cacheFile: File,
    private val get: (String) -> String = ::download,
) {
    /** A saved copy and when it was fetched (milliseconds since 1970). */
    @Serializable
    data class Saved(val data: WatchData, val savedAt: Long)

    /** Fetches fresh data and saves it. */
    fun refresh(now: Long = System.currentTimeMillis()): Saved {
        val data = json.decodeFromString(WatchData.serializer(), get(url("/data/watch.json")))
        if (data.champions.isEmpty()) throw IOException("No champions in the feed")
        return Saved(data, now).also(::save)
    }

    fun load(): Saved? = runCatching {
        json.decodeFromString(Saved.serializer(), cacheFile.readText())
    }.getOrNull()

    fun save(saved: Saved) {
        runCatching {
            cacheFile.parentFile?.mkdirs()
            val tmp = File(cacheFile.path + ".tmp")
            tmp.writeText(json.encodeToString(Saved.serializer(), saved))
            tmp.renameTo(cacheFile)
        }
    }

    companion object {
        const val BASE = "https://deeparam.com"

        fun url(path: String): String = BASE + path

        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

        private fun download(address: String): String {
            val conn = URL(address).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", "DeepARAMApp/1 (Wear OS)")
            try {
                if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
                return conn.inputStream.bufferedReader().use { it.readText() }
            } finally {
                conn.disconnect()
            }
        }
    }
}

/** Riot's required notice. Same words as the site footer and the phone app. */
object Legal {
    const val RIOT_NOTICE =
        "DeepARAM isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone " +
            "officially involved in producing or managing Riot Games properties. Riot Games, and all associated " +
            "properties are trademarks or registered trademarks of Riot Games, Inc."
}
