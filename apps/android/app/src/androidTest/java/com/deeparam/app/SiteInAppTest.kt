package com.deeparam.app

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.deeparam.core.SiteTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opens the app on a real (emulated) device and checks the live site loads inside it, dressed for the app. */
@RunWith(AndroidJUnit4::class)
class SiteInAppTest {

    /** Runs [js] on the Home page until [ready] accepts the answer or a minute passes; returns the last answer. */
    private fun poll(scenario: ActivityScenario<MainActivity>, js: String, ready: (String) -> Boolean): String {
        var result = ""
        val deadline = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < deadline) {
            val done = CountDownLatch(1)
            scenario.onActivity { a ->
                val page = a.store.page(SiteTab.HOME)
                if (page.isLoading || page.webView.url == null) done.countDown()
                else page.webView.evaluateJavascript(js) { result = it; done.countDown() }
            }
            done.await(10, TimeUnit.SECONDS)
            if (ready(result)) break
            Thread.sleep(1_000)
        }
        return result
    }

    private val probe = """
        JSON.stringify({
          host: location.hostname,
          app: document.documentElement.dataset.app || '',
          ua: navigator.userAgent.indexOf('DeepARAMApp/') >= 0,
          tabbar: (function(){var t=document.querySelector('.tabbar');return t?getComputedStyle(t).display:'missing'})(),
          bridge: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.deeparamHaptic),
          title: document.title
        })
    """.trimIndent()

    /**
     * The live site opens in Home and every deeparam.com page gets the app's user agent, html[data-app]
     * and haptics bridge. (From CI's data-centre network the site may answer with its bot check page
     * instead of Home, so this checks the app's part on whichever deeparam.com page arrives.)
     */
    @Test
    fun liveSiteOpensWithAppBridge() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val result = poll(scenario, probe) { it.contains("""\"bridge\":true""") }
            assertTrue("deeparam.com never loaded: $result", result.contains("""\"host\":\"deeparam.com\""""))
            assertTrue("html[data-app] not set: $result", result.contains("""\"app\":\"android\""""))
            assertTrue("user agent lacks DeepARAMApp/: $result", result.contains("""\"ua\":true"""))
            assertTrue("haptics bridge missing: $result", result.contains("""\"bridge\":true"""))
        }
    }

    /** The site's own tab bar, More sheet and header links are hidden on a deeparam.com page with all three. */
    @Test
    fun siteNavIsHiddenInTheApp() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            poll(scenario, "1") { it == "1" } // let the first live load finish so it can't replace the test page
            val html = """<!doctype html><html><head><title>DeepARAM test</title></head><body>
                <header class="site-header"><nav class="nav" id="nav">links</nav></header>
                <main>page</main><nav class="tabbar" id="tabbar">tabs</nav><div class="sheet" id="sheet">more</div>
                </body></html>"""
            scenario.onActivity { a ->
                a.store.page(SiteTab.HOME).webView.loadDataWithBaseURL("https://deeparam.com/app-test", html, "text/html", "utf-8", null)
            }
            val js = "['tabbar','sheet','nav'].map(function(i){return getComputedStyle(document.getElementById(i)).display}).join(',')+'|'+document.title"
            val result = poll(scenario, js) { it.contains("DeepARAM test") && it.startsWith("\"none,none,none") }
            assertEquals("\"none,none,none|DeepARAM test\"", result)
        }
    }

    @Test
    fun linksOpenInTheirTab() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("https://deeparam.com/patches/26.21")).setClass(context, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(open).use { scenario ->
            scenario.onActivity { a ->
                assertEquals(Nav.MORE, a.nav.selected)
                assertEquals("patches", a.nav.moreTab?.id)
            }
        }
        val tiers = Intent(Intent.ACTION_VIEW, Uri.parse("https://deeparam.com/tier-list?tab=augments")).setClass(context, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(tiers).use { scenario ->
            scenario.onActivity { a -> assertEquals(SiteTab.TIERS.id, a.nav.selected) }
        }
    }
}
