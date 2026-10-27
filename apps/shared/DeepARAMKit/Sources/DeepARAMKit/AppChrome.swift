import Foundation

/// Script run on every site page inside the app. The app draws its own tab bar, so the site's
/// tab bar, More sheet and header links are hidden, and so is the first-visit tour, which points
/// at those links; the rest of the page is left as is.
public enum AppChrome {
    public static let css = """
    html[data-app] .tabbar, html[data-app] .sheet, html[data-app] .sheet-scrim,
    html[data-app] .site-header .nav, html[data-app] .tour, html[data-app] .tour-chip { display: none !important; }
    html[data-app] body { padding-bottom: 0 !important; }
    html[data-app] main { padding-bottom: 24px !important; }
    html[data-app], html[data-app] body { -webkit-touch-callout: none; overscroll-behavior-y: none; }
    """

    public static func script(platform: String) -> String {
        let escaped = css.replacingOccurrences(of: "`", with: "\\`")
        return """
        (function(){
          var d=document.documentElement; d.dataset.app=\(jsString(platform));
          if(!document.getElementById('deeparam-app-css')){
            var s=document.createElement('style'); s.id='deeparam-app-css'; s.textContent=`\(escaped)`;
            (document.head||d).appendChild(s);
          }
        })();
        """
    }

    private static func jsString(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
}
