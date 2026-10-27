package com.deeparam.core

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Environment
import android.os.Message
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * One tab's web page. Keeps its own web view so each tab remembers where you were, saves an offline
 * copy of pages that load, and shows the saved copy when there is no connection. The Android twin of
 * SitePage.swift in apps/shared/DeepARAMKit.
 */
@SuppressLint("SetJavaScriptEnabled")
class SitePage(
    context: Context,
    val tab: SiteTab,
    /** Goes in html[data-app]: "android", "chromeos", "tv"... */
    platform: String,
    private val host: Host,
    private val store: OfflineStore = OfflineStore(context),
) {
    /** What the app around the page does for it. Every method has a sensible default. */
    interface Host {
        /** Loading, back or offline state changed. */
        fun onPageStateChanged(page: SitePage) {}
        fun onTheme(theme: String) {}
        fun onHapticsSetting(on: Boolean) {}
        /** A file input was tapped. Return false to cancel it. */
        fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean = false
        /** The page's renderer died; the app should replace this page with a new one. */
        fun onPageCrashed(page: SitePage) {}
    }

    val webView: WebView = WebView(context)

    var isLoading = false; private set
    var progress = 0; private set
    val canGoBack get() = webView.canGoBack()
    /** Set while the page on screen is a saved copy: when it was saved, in milliseconds. */
    var offlineSavedAt: Long? = null; private set
    /** No connection and no saved copy for this page. */
    var failedOffline = false; private set
    /** The site URL this page is showing, or was trying to show when it went offline. */
    var currentUrl: String? = null; private set

    private var started = false
    private var showingCopy = false
    private val chromeScript = AppChrome.script(platform)

    init {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = true // only for the saved copies below; other file:// pages are refused
        s.allowContentAccess = false
        s.setSupportMultipleWindows(true)
        s.javaScriptCanOpenWindowsAutomatically = true
        s.userAgentString = "${s.userAgentString} ${Site.USER_AGENT_SUFFIX} Android"
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false) // the site has its own dark theme
        }
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.isVerticalScrollBarEnabled = true
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(AppBridge(webView, object : AppBridge.Listener {
            override fun onTheme(theme: String) = host.onTheme(theme)
            override fun onHapticsSetting(on: Boolean) = host.onHapticsSetting(on)
        }), AppBridge.NAME)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val origins = setOf(Site.BASE, "https://www.${Site.HOST}")
            WebViewCompat.addDocumentStartJavaScript(webView, chromeScript, origins)
            WebViewCompat.addDocumentStartJavaScript(webView, AppBridge.SCRIPT, origins)
        }

        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.setDownloadListener { url, userAgent, disposition, mime, _ -> download(url, userAgent, disposition, mime) }
    }

    fun loadIfNeeded() {
        if (started) return
        open(tab.url)
    }

    fun open(url: String) {
        started = true
        currentUrl = url
        showingCopy = false
        webView.loadUrl(url)
    }

    fun reload() {
        if (showingCopy || failedOffline || webView.url == null) open(currentUrl?.takeIf(Site::isInternal) ?: tab.url)
        else webView.reload()
    }

    fun goBack() = webView.goBack()

    /** Tapping the selected tab again: scroll to the top, or go back to the tab's first page. */
    fun reselect() {
        if (webView.scrollY > 4) {
            webView.evaluateJavascript("window.scrollTo({top:0,behavior:'smooth'})", null)
            return
        }
        if (Site.pathOf(webView.url) != tab.path) open(tab.url)
    }

    /** Whether the page is scrolled to its very top (pull to refresh only starts there). */
    val atTop get() = webView.scrollY <= 0

    /** Copies the app's Haptics switch into the site's settings. */
    fun writeHapticsSetting(on: Boolean) {
        if (Site.isInternal(webView.url)) webView.evaluateJavascript(AppBridge.writeHapticsSetting(on), null)
    }

    fun destroy() {
        webView.stopLoading()
        webView.destroy()
    }

    private fun changed() = host.onPageStateChanged(this)

    private fun saveOfflineCopy(url: String) {
        val tmp = store.tempFile(url)
        webView.saveWebArchive(tmp.path, false) { path -> if (path != null) store.commit(url) }
    }

    private fun showOfflineCopy(wanted: String?) {
        for (candidate in listOfNotNull(wanted, tab.url)) {
            if (store.has(candidate)) {
                offlineSavedAt = store.savedAt(candidate)
                failedOffline = false
                showingCopy = true
                webView.loadUrl(Uri.fromFile(store.file(candidate)).toString())
                changed()
                return
            }
        }
        failedOffline = true
        changed()
    }

    private fun isOnline(): Boolean {
        val cm = webView.context.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun openOutside(uri: Uri) {
        val intent = if (uri.scheme == "intent") runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) }.getOrNull()
        else Intent(Intent.ACTION_VIEW, uri)
        intent ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { webView.context.startActivity(intent) } catch (_: ActivityNotFoundException) {}
    }

    private fun isSavedCopy(uri: Uri) = uri.scheme == "file" && uri.path?.startsWith(store.folder.path) == true

    private fun download(url: String, userAgent: String, disposition: String?, mime: String?) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && uri.scheme != "http") return // blob: and data: links are handled by the page
        val name = URLUtil.guessFileName(url, disposition, mime)
        val req = DownloadManager.Request(uri)
            .setMimeType(mime)
            .addRequestHeader("User-Agent", userAgent)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
        runCatching { webView.context.getSystemService(DownloadManager::class.java)?.enqueue(req) }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme) {
                "http", "https" -> {
                    // Links to other websites open in the browser; site pages stay in the app.
                    if (request.isForMainFrame && !Site.isInternal(uri)) { openOutside(uri); true } else false
                }
                "about", "blob", "data" -> false
                "file" -> !isSavedCopy(uri)
                else -> { openOutside(uri); true } // mailto:, tel:, intent:, other apps
            }
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            isLoading = true
            if (Site.isInternal(url)) {
                currentUrl = url
                if (showingCopy) { showingCopy = false; offlineSavedAt = null }
                failedOffline = false
            }
            changed()
        }

        override fun onPageCommitVisible(view: WebView, url: String) {
            injectFallback(view)
        }

        override fun onPageFinished(view: WebView, url: String) {
            isLoading = false
            injectFallback(view)
            if (!showingCopy && Site.isInternal(url) && !failedOffline) saveOfflineCopy(url)
            changed()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            val connection = error.errorCode in setOf(ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT, ERROR_IO, ERROR_PROXY_AUTHENTICATION)
            if (connection || !isOnline()) showOfflineCopy(request.url.toString().takeIf(Site::isInternal))
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            host.onPageCrashed(this@SitePage)
            return true
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) = changed()

        /** Older web views can't add scripts before the page starts; run them as soon as it is visible. */
        private fun injectFallback(view: WebView) {
            val docStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            if (!docStart || showingCopy) {
                view.evaluateJavascript(chromeScript, null)
                view.evaluateJavascript(AppBridge.SCRIPT, null)
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress = newProgress
            changed()
        }

        // target="_blank" links and window.open: site pages open in this tab, others in the browser.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val probe = WebView(view.context)
            probe.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (Site.isInternal(uri)) open(uri.toString()) else openOutside(uri)
                    v.destroy()
                    return true
                }
            }
            (resultMsg.obj as? WebView.WebViewTransport)?.webView = probe
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
            host.showFileChooser(callback, params)
    }
}
