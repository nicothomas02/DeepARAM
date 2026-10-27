package com.deeparam.tv

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** Where the data on screen came from: fresh from the site, or the copy saved on the last good load. */
data class Loaded(val data: TvData, val savedAt: Long?)

class Repository(context: Context) {
    private val cacheDir = context.filesDir
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun load(): Loaded = withContext(Dispatchers.IO) {
        try {
            Loaded(fetchFresh(), savedAt = null)
        } catch (e: Exception) {
            loadSaved() ?: throw e
        }
    }

    private fun fetchFresh(): TvData {
        fetch("/data/tv.json")?.let { text ->
            val data = TvParser.parseTv(text)
            if (data.champions.isNotEmpty()) {
                save("tv.json", text)
                return data
            }
        }
        val watch = fetch("/data/watch.json") ?: error("No data")
        val tiers = runCatching { fetch("/data/champion-tiers.json") }.getOrNull()
        val data = TvParser.parseWatch(watch, tiers)
        save("watch.json", watch)
        tiers?.let { save("champion-tiers.json", it) }
        File(cacheDir, "tv.json").delete()
        return data
    }

    private fun loadSaved(): Loaded? {
        File(cacheDir, "tv.json").takeIf { it.exists() }?.let {
            return Loaded(TvParser.parseTv(it.readText()), it.lastModified())
        }
        val watch = File(cacheDir, "watch.json").takeIf { it.exists() } ?: return null
        val tiers = File(cacheDir, "champion-tiers.json").takeIf { it.exists() }?.readText()
        return Loaded(TvParser.parseWatch(watch.readText(), tiers), watch.lastModified())
    }

    /** The body for a JSON route, or null when the route doesn't exist (yet). Network errors throw. */
    private fun fetch(path: String): String? {
        val request = Request.Builder()
            .url(SITE + path)
            .header("User-Agent", "DeepARAMApp/1 (Android TV)")
            .build()
        client.newCall(request).execute().use { response ->
            if (response.code == 404) return null
            if (!response.isSuccessful) error("HTTP ${response.code}")
            val type = response.header("Content-Type").orEmpty()
            if (!type.contains("json")) return null
            return response.body?.string()
        }
    }

    private fun save(name: String, text: String) {
        runCatching { File(cacheDir, name).writeText(text) }
    }
}
