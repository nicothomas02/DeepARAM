package com.deeparam.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.deeparam.core.SiteTab

/** Which tab is showing, and which page under More is open. */
class Nav {
    var selected by mutableStateOf(SiteTab.HOME.id)
    var moreTab by mutableStateOf<SiteTab?>(null)

    fun primary(id: String): SiteTab? = SiteTab.PRIMARY.firstOrNull { it.id == id }

    /** The page on screen, or null for the More list itself. */
    fun currentTab(): SiteTab? = if (selected == MORE) moreTab else primary(selected)

    /** Shows a site link in the tab it belongs to: one of the main four, or a page under More. */
    fun route(url: String, store: PageStore) {
        val tab = SiteTab.forUrl(url)
        if (tab in SiteTab.PRIMARY) {
            selected = tab.id
        } else {
            selected = MORE
            moreTab = tab
        }
        store.page(tab).open(url)
    }

    companion object {
        const val MORE = "more"
    }
}
