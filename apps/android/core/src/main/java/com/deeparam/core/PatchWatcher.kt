package com.deeparam.core

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** What the site says is current: the live patch (as players know it, "26.21") and the PBE build. */
data class SiteStatus(val livePatch: String? = null, val pbeBuild: String? = null)

/** Something new since the last check, worth a notification. */
sealed class SiteNews {
    data class NewPatch(val patch: String) : SiteNews()
    data class NewPBE(val build: String) : SiteNews()
}

/** Where the last seen patch and PBE build are kept. */
interface SeenStore {
    var lastPatch: String?
    var lastPBE: String?
}

class PrefsSeenStore(context: Context) : SeenStore {
    private val prefs = context.getSharedPreferences("deeparam.patches", Context.MODE_PRIVATE)
    override var lastPatch: String?
        get() = prefs.getString("lastSeenPatch", null)
        set(v) = prefs.edit().putString("lastSeenPatch", v).apply()
    override var lastPBE: String?
        get() = prefs.getString("lastSeenPBE", null)
        set(v) = prefs.edit().putString("lastSeenPBE", v).apply()
}

/**
 * Checks the site for a new live patch or PBE build and remembers what the person was last told
 * about. The very first check only records the current state, so nobody gets a notification on install.
 */
class PatchWatcher(private val seen: SeenStore, private val fetch: (String) -> String? = ::httpGet) {

    /** Reads /data/app-status.json, then the patch in /data/watch.json, then the newest recap in the sitemap. */
    suspend fun status(): SiteStatus = withContext(Dispatchers.IO) {
        fetch(Site.url("/data/app-status.json"))?.let { parseAppStatus(it) }?.takeIf { it.livePatch != null }?.let { return@withContext it }
        fetch(Site.url("/data/watch.json"))?.let { parseWatch(it) }?.let { return@withContext SiteStatus(livePatch = it) }
        SiteStatus(livePatch = fetch(Site.url("/sitemap.xml"))?.let { patchesInSitemap(it).firstOrNull() })
    }

    suspend fun check(): List<SiteNews> = news(status())

    /** Compares [s] with what was seen last and records it. */
    fun news(s: SiteStatus): List<SiteNews> {
        val out = mutableListOf<SiteNews>()
        s.livePatch?.let { patch ->
            val last = seen.lastPatch
            if (last != null && compare(patch, last) > 0) out += SiteNews.NewPatch(patch)
            if (last == null || compare(patch, last) >= 0) seen.lastPatch = patch
        }
        s.pbeBuild?.let { build ->
            val last = seen.lastPBE
            if (last != null && last != build) out += SiteNews.NewPBE(build)
            seen.lastPBE = build
        }
        return out
    }

    companion object {
        fun parseAppStatus(json: String): SiteStatus? = runCatching {
            val o = JSONObject(json)
            SiteStatus(
                livePatch = o.optString("livePatch").takeIf { it.isNotEmpty() }?.let(::publicPatch),
                pbeBuild = o.optString("pbeBuild").takeIf { it.isNotEmpty() },
            )
        }.getOrNull()

        fun parseWatch(json: String): String? = runCatching {
            JSONObject(json).optString("patch").takeIf { it.isNotEmpty() }?.let(::publicPatch)
        }.getOrNull()

        /** "26.20" style patch names found in /patches/<patch> links, newest first. */
        fun patchesInSitemap(xml: String): List<String> =
            Regex("""/patches/(\d+)\.(\d+)<""").findAll(xml)
                .map { publicPatch("${it.groupValues[1]}.${it.groupValues[2]}") }
                .distinct()
                .sortedWith { a, b -> compare(b, a) }
                .toList()

        /** The number players see: the client's "16.20" is patch 26.20 (the site's lib/patch-name.ts). */
        fun publicPatch(p: String): String {
            val parts = p.split('.')
            val major = parts.getOrNull(0)?.toIntOrNull() ?: return p
            val minor = parts.getOrNull(1)?.toIntOrNull() ?: return p
            return "${if (major < 20) major + 10 else major}.$minor"
        }

        /** Compares "26.9" and "26.10" as numbers, not text. */
        fun compare(a: String, b: String): Int {
            val x = a.split('.').map { it.toIntOrNull() ?: 0 }
            val y = b.split('.').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(x.size, y.size)) {
                val d = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
                if (d != 0) return d
            }
            return 0
        }

        fun httpGet(url: String): String? = runCatching {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000
            c.readTimeout = 15_000
            c.setRequestProperty("User-Agent", Site.USER_AGENT_SUFFIX)
            try {
                if (c.responseCode != 200) null else c.inputStream.bufferedReader().use { it.readText() }
            } finally {
                c.disconnect()
            }
        }.getOrNull()
    }
}
