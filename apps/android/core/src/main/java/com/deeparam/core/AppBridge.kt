package com.deeparam.core

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Taps you can feel. The site's own taps (tab strips, the draft, share) reach the app through the same
 * hook the iPhone app uses (window.webkit.messageHandlers.deeparamHaptic, web/src/lib/haptics.ts), which
 * [AppBridge.SCRIPT] provides on Android; the app adds its own for tabs and refresh. One switch covers
 * both: the site's Vibration setting, mirrored in [enabled].
 */
object Haptics {
    enum class Kind { TAP, STEP, DONE, WARNING, TICK, THUD, WIN }

    private const val PREFS = "deeparam.settings"
    private const val KEY = "haptics"

    @Volatile private var cached: Boolean? = null

    fun enabled(context: Context): Boolean =
        cached ?: context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true).also { cached = it }

    fun store(context: Context, on: Boolean) {
        cached = on
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
    }

    fun play(view: View, kind: Kind) {
        if (!enabled(view.context)) return
        view.performHapticFeedback(constant(kind))
    }

    private fun constant(kind: Kind): Int {
        val r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        return when (kind) {
            Kind.TAP -> HapticFeedbackConstants.KEYBOARD_TAP
            Kind.STEP -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
            Kind.TICK -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK
            Kind.DONE, Kind.WIN -> if (r) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            Kind.WARNING -> if (r) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            Kind.THUD -> HapticFeedbackConstants.LONG_PRESS
        }
    }

    fun kindOf(name: String?): Kind? = when (name) {
        "tap" -> Kind.TAP
        "step" -> Kind.STEP
        "done" -> Kind.DONE
        "warning" -> Kind.WARNING
        "tick" -> Kind.TICK
        "thud" -> Kind.THUD
        "win" -> Kind.WIN
        else -> null
    }
}

/**
 * The page side of the app: haptics, the site's Vibration setting and its Light / Dark theme.
 * Installed on each web view as the "DeepARAMAndroid" JavaScript interface.
 */
class AppBridge(private val view: View, private val listener: Listener) {

    interface Listener {
        /** The site's theme ("dark" or "light") whenever a page loads or it changes. */
        fun onTheme(theme: String) {}
        /** The site's Vibration setting changed (or was read on load). */
        fun onHapticsSetting(on: Boolean) {}
    }

    private val main = Handler(Looper.getMainLooper())

    /** Once the site's own hook has spoken, its navigator.vibrate calls are the same taps again; skip them. */
    private var siteHookSeen = false

    @JavascriptInterface
    fun post(handler: String, json: String) {
        val body = runCatching { JSONObject(json) }.getOrNull() ?: return
        main.post { handle(handler, body) }
    }

    private fun handle(handler: String, body: JSONObject) {
        if (handler == SITE_HANDLER) siteHookSeen = true else if (siteHookSeen && body.has("buzz")) return
        if (body.has("haptics")) {
            val on = body.optBoolean("haptics", true)
            Haptics.store(view.context, on)
            listener.onHapticsSetting(on)
        }
        if (body.has("theme")) listener.onTheme(body.optString("theme", "dark"))
        // The site's hook sends {kind, style}: style says what it means, kind is the fallback.
        val kind = listOf("style", "kind", "buzz").firstNotNullOfOrNull { Haptics.kindOf(body.optString(it, "").ifEmpty { null }) }
        if (kind != null) Haptics.play(view, kind)
    }

    companion object {
        const val NAME = "DeepARAMAndroid"
        const val SITE_HANDLER = "deeparamHaptic"
        private const val PAGE_HANDLER = "deeparamHaptics"

        /**
         * Gives the page the iPhone app's message handlers (so web/src/lib/haptics.ts sends its taps here),
         * a navigator.vibrate that reaches the app, and reports the Vibration setting and theme.
         */
        val SCRIPT = """
(function(){
  var a=window.$NAME; if(!a||window.__deeparamBridge)return; window.__deeparamBridge=1;
  function h(n){return {postMessage:function(m){try{a.post(n,JSON.stringify(m||{}))}catch(e){}}}}
  var w=window.webkit=window.webkit||{}; w.messageHandlers=w.messageHandlers||{};
  w.messageHandlers.$SITE_HANDLER=h('$SITE_HANDLER'); var p=w.messageHandlers.$PAGE_HANDLER=h('$PAGE_HANDLER');
  try{Object.defineProperty(Navigator.prototype,'vibrate',{configurable:true,writable:true,value:function(v){
    var x=Array.isArray(v)?v:[v]; if(!x.length||!x[0])return true;
    p.postMessage({buzz:x.length>1?'done':(x[0]>10?'step':'tap')}); return true;
  }})}catch(e){}
  function sync(){
    try{var s=JSON.parse(localStorage.getItem('deeparam-settings')||'{}');p.postMessage({haptics:s.haptics!==false})}catch(e){}
    p.postMessage({theme:document.documentElement.dataset.theme||'dark'});
  }
  window.addEventListener('deeparam-settings',sync);
  try{new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})}catch(e){}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();
""".trimIndent()

        /** Writes the app's Haptics switch into the site's settings, so the two stay one setting. */
        fun writeHapticsSetting(on: Boolean) =
            "(function(){try{var k='deeparam-settings',s=JSON.parse(localStorage.getItem(k)||'{}');s.haptics=$on;localStorage.setItem(k,JSON.stringify(s));window.dispatchEvent(new Event(k))}catch(e){}})();"
    }
}
