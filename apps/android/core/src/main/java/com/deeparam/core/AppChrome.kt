package com.deeparam.core

/**
 * Script run on every site page inside the app. The app draws its own tab bar, so the site's
 * tab bar, More sheet and header links are hidden; the rest of the page is left as is.
 * The same CSS as the Apple apps (apps/shared/DeepARAMKit AppChrome.swift).
 */
object AppChrome {
    const val CSS = """
html[data-app] .tabbar, html[data-app] .sheet, html[data-app] .sheet-scrim,
html[data-app] .site-header .nav { display: none !important; }
html[data-app] body { padding-bottom: 0 !important; }
html[data-app] main { padding-bottom: 24px !important; }
html[data-app], html[data-app] body { overscroll-behavior-y: none; }
"""

    /** [platform] goes in html[data-app] ("android", "chromeos", "tv"...). */
    fun script(platform: String): String {
        val css = CSS.replace("\\", "\\\\").replace("`", "\\`")
        return """
(function(){
  var d=document.documentElement; d.dataset.app=${jsString(platform)};
  function add(){
    if(document.getElementById('deeparam-app-css'))return;
    var s=document.createElement('style'); s.id='deeparam-app-css'; s.textContent=`$css`;
    (document.head||d).appendChild(s);
  }
  add(); document.addEventListener('DOMContentLoaded',add);
})();
""".trimIndent()
    }

    fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}
