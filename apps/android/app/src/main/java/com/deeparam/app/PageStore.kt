package com.deeparam.app

import android.content.Context
import android.net.Uri
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.deeparam.core.Haptics
import com.deeparam.core.SitePage
import com.deeparam.core.SiteTab

/**
 * Every tab's page, made the first time it is shown and kept so each tab remembers where you were.
 * Compose reads [version] to redraw when any page's loading, back or offline state changes.
 */
class PageStore(
    private val context: Context,
    private val platform: String,
    private val chooseFiles: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean,
) : SitePage.Host {
    private val pages = mutableMapOf<String, SitePage>()
    private val frames = mutableMapOf<String, SwipeRefreshLayout>()

    var version by mutableIntStateOf(0); private set
    /** The site's Light / Dark choice, which the app's own bars follow. Dark until a page says otherwise. */
    var theme by mutableStateOf(context.getSharedPreferences("deeparam.settings", Context.MODE_PRIVATE).getString("theme", "dark") ?: "dark")
        private set
    var hapticsOn by mutableStateOf(Haptics.enabled(context)); private set

    fun page(tab: SiteTab): SitePage = pages.getOrPut(tab.id) { SitePage(context, tab, platform, this) }

    val all: Collection<SitePage> get() = pages.values

    /** The page's web view inside its pull-to-refresh frame, made once per page. */
    fun frame(tab: SiteTab): SwipeRefreshLayout = frames.getOrPut(tab.id) {
        val page = page(tab)
        SwipeRefreshLayout(context).apply {
            (page.webView.parent as? ViewGroup)?.removeView(page.webView)
            addView(page.webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            // Pull to refresh starts only at the top, and never in the Simulator, where dragging turns the 3D view.
            setOnChildScrollUpCallback { _, _ ->
                val p = pages[tab.id] ?: return@setOnChildScrollUpCallback true
                !p.atTop || p.webView.url?.contains("/simulator") == true
            }
            setOnRefreshListener {
                pages[tab.id]?.let { Haptics.play(it.webView, Haptics.Kind.TAP); it.reload() }
                postDelayed({ isRefreshing = false }, 600)
            }
        }
    }

    fun setHaptics(on: Boolean) {
        hapticsOn = on
        Haptics.store(context, on)
        pages.values.firstOrNull()?.writeHapticsSetting(on)
    }

    fun destroy() {
        pages.values.forEach { it.destroy() }
        pages.clear()
        frames.clear()
    }

    override fun onPageStateChanged(page: SitePage) { version++ }

    override fun onTheme(theme: String) {
        if (theme != "dark" && theme != "light") return
        this.theme = theme
        context.getSharedPreferences("deeparam.settings", Context.MODE_PRIVATE).edit().putString("theme", theme).apply()
    }

    override fun onHapticsSetting(on: Boolean) { hapticsOn = on }

    override fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams) = chooseFiles(callback, params)

    /** A page whose renderer died is replaced by a fresh one at the same address. */
    override fun onPageCrashed(page: SitePage) {
        val url = page.currentUrl
        val frame = frames[page.tab.id]
        frame?.removeView(page.webView)
        page.destroy()
        pages.remove(page.tab.id)
        val fresh = page(page.tab)
        frame?.addView(fresh.webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        fresh.open(url ?: page.tab.url)
        version++
    }
}
