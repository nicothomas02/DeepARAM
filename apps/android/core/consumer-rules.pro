# The page calls these through the JavaScript bridge, so they must keep their names.
-keepclassmembers class com.deeparam.core.AppBridge {
    @android.webkit.JavascriptInterface <methods>;
}
