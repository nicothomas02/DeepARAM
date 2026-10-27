package com.deeparam.core

import android.net.Uri

/** The site the apps show, and the tabs they offer. These match the site's phone tab bar. */
object Site {
    const val HOST = "deeparam.com"
    const val BASE = "https://deeparam.com"

    /** Added to the browser user agent so the site knows it is inside the app (web/src/lib/haptics.ts inApp()). */
    const val USER_AGENT_SUFFIX = "DeepARAMApp/1"

    fun url(path: String): String = if (path.startsWith("http")) path else BASE + (if (path.startsWith("/")) path else "/$path")

    /** True for pages that belong in the app; anything else opens in the browser. */
    fun isInternal(url: String?): Boolean {
        if (url == null) return false
        if (url.startsWith("about:")) return true
        return isInternalHost(hostOf(url))
    }

    fun isInternal(uri: Uri?): Boolean = uri != null && (uri.scheme == "about" || isInternalHost(uri.host))

    fun isInternalHost(host: String?): Boolean {
        val h = host?.lowercase() ?: return false
        return h == HOST || h == "www.$HOST"
    }

    /** The host of an http(s) URL without android.net.Uri, so it also works in plain unit tests. */
    fun hostOf(url: String): String? {
        val m = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:@]*@)?([^/?#:]+)").find(url) ?: return null
        return m.groupValues[2]
    }

    /** The path of a site URL ("/tier-list"), or null for other sites. */
    fun pathOf(url: String?): String? {
        if (!isInternal(url) || url == null) return null
        val afterHost = url.substringAfter("://").substringAfter('/', "")
        return "/" + afterHost.substringBefore('?').substringBefore('#')
    }
}

/** A page with its own place in the app's navigation. [icon] names the icon each app draws for it. */
data class SiteTab(val id: String, val title: String, val icon: String, val path: String) {
    val url: String get() = Site.url(path)

    /** Whether [url] is this tab's page or one below it. Home only owns "/". */
    fun owns(url: String?): Boolean {
        val p = Site.pathOf(url) ?: return false
        if (path == "/") return p == "/"
        return p == path || p.startsWith("$path/")
    }

    companion object {
        val HOME = SiteTab("home", "Home", "home", "/")
        val TIERS = SiteTab("tiers", "Tier List", "tiers", "/tier-list")
        val SIMULATOR = SiteTab("simulator", "Simulator", "simulator", "/simulator")
        val KITCHEN = SiteTab("kitchen", "Kitchen", "kitchen", "/kitchen")

        /** The site's phone tab bar: Home, Tier List, Simulator, The Kitchen, then More. */
        val PRIMARY = listOf(HOME, TIERS, SIMULATOR, KITCHEN)

        /** The More menu, in the site's order. */
        val MORE = listOf(
            SiteTab("pbe", "PBE", "pbe", "/pbe"),
            SiteTab("patches", "Patch Recaps", "patches", "/patches"),
            SiteTab("info", "Info", "info", "/info"),
            SiteTab("champions", "Champions", "champions", "/champions"),
            SiteTab("items", "Items", "items", "/items"),
            SiteTab("account", "Account", "account", "/account"),
        )

        val LEGAL = listOf(
            SiteTab("privacy", "Privacy", "privacy", "/privacy"),
            SiteTab("terms", "Terms", "terms", "/terms"),
        )

        val ALL = PRIMARY + MORE + LEGAL

        /** The tab a link belongs in: the most specific one that owns it, otherwise Home. */
        fun forUrl(url: String?): SiteTab = ALL.filter { it.owns(url) }.maxByOrNull { it.path.length } ?: HOME
    }
}
