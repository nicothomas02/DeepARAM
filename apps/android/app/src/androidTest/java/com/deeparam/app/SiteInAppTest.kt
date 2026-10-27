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

    @Test
    fun homeLoadsWithAppChrome() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val js = """
                JSON.stringify({
                  app: document.documentElement.dataset.app || '',
                  ua: navigator.userAgent.indexOf('DeepARAMApp/') >= 0,
                  tabbar: (function(){var t=document.querySelector('.tabbar');return t?getComputedStyle(t).display:'none'})(),
                  bridge: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.deeparamHaptic),
                  title: document.title
                })
            """.trimIndent()
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
                if (result.contains("android") && result.contains("DeepARAM")) break
                Thread.sleep(1_000)
            }
            assertTrue("home page never loaded: $result", result.contains("DeepARAM"))
            assertTrue("html[data-app] not set: $result", result.contains("""\"app\":\"android\""""))
            assertTrue("user agent lacks DeepARAMApp/: $result", result.contains("""\"ua\":true"""))
            assertTrue("haptics bridge missing: $result", result.contains("""\"bridge\":true"""))
            assertTrue("site tab bar still showing: $result", result.contains("""\"tabbar\":\"none\""""))
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
