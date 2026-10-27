package com.deeparam.app

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.annotation.VisibleForTesting
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import com.deeparam.app.ui.DeepARAMApp
import com.deeparam.app.ui.DeepARAMTheme
import com.deeparam.core.Site
import com.deeparam.core.SiteTab

class MainActivity : ComponentActivity() {
    @VisibleForTesting internal lateinit var store: PageStore
    @VisibleForTesting internal val nav = Nav()

    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pendingFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        pendingFiles = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = PageStore(this, platform()) { callback, params ->
            pendingFiles?.onReceiveValue(null)
            pendingFiles = callback
            runCatching { pickFiles.launch(params.createIntent()) }.onFailure { pendingFiles = null; callback.onReceiveValue(null) }.isSuccess
        }
        savedInstanceState?.getString(STATE_TAB)?.let { nav.selected = it }
        if (savedInstanceState == null) handle(intent)

        setContent {
            val dark = store.theme != "light"
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            DeepARAMTheme(dark) { DeepARAMApp(store, nav) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** deeparam.com links and patch alerts open in the tab they belong to. */
    private fun handle(intent: Intent?) {
        val url = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data?.toString() ?: return
        if (Site.isInternal(url)) nav.route(url, store)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_TAB, nav.selected)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        store.destroy()
        super.onDestroy()
    }

    /**
     * Keyboard shortcuts for Chromebooks and tablets with a keyboard: Ctrl+1 to Ctrl+5 pick a tab,
     * Ctrl+R or F5 reloads, Alt+Left goes back.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val tabs = SiteTab.PRIMARY.map { it.id } + Nav.MORE
        val page = nav.currentTab()?.let { store.page(it) }
        when {
            event.isCtrlPressed && keyCode in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_5 -> nav.selected = tabs[keyCode - KeyEvent.KEYCODE_1]
            (event.isCtrlPressed && keyCode == KeyEvent.KEYCODE_R) || keyCode == KeyEvent.KEYCODE_F5 -> page?.reload()
            event.isAltPressed && keyCode == KeyEvent.KEYCODE_DPAD_LEFT && page?.canGoBack == true -> page.goBack()
            else -> return super.onKeyDown(keyCode, event)
        }
        return true
    }

    /** "chromeos" on Chromebooks, otherwise "android"; the page sees it as html[data-app]. */
    private fun platform(): String {
        val pm = packageManager
        return if (pm.hasSystemFeature("org.chromium.arc") || pm.hasSystemFeature("org.chromium.arc.device_management")) "chromeos" else "android"
    }

    private companion object {
        const val STATE_TAB = "tab"
    }
}
