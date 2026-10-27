package com.deeparam.app.ui

import android.text.format.DateFormat
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.deeparam.app.Nav
import com.deeparam.app.PageStore
import com.deeparam.core.Haptics
import com.deeparam.core.SitePage
import com.deeparam.core.SiteTab
import java.util.Date

/** A tab in the app's own bar: the site's four main pages, then More. */
private data class BarItem(val id: String, val title: String, val icon: ImageVector)

private val barItems = SiteTab.PRIMARY.map { BarItem(it.id, it.title, iconFor(it.icon)) } + BarItem(Nav.MORE, "More", Icons.Rounded.Menu)

/**
 * The whole app: the site's pages with a native tab bar on phones, or a side rail on tablets,
 * foldables and Chromebooks (600 dp and wider).
 */
@Composable
fun DeepARAMApp(store: PageStore, nav: Nav) {
    store.version // redraw when any page's state changes
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val view = LocalView.current

    fun select(id: String) {
        if (id == nav.selected) {
            Haptics.play(view, Haptics.Kind.TAP)
            if (id == Nav.MORE) nav.moreTab = null else nav.primary(id)?.let { store.page(it).reselect() }
        } else {
            Haptics.play(view, Haptics.Kind.STEP)
            nav.selected = id
        }
    }

    val current: SitePage? = nav.currentTab()?.let { store.page(it) }
    // Back: the page's own history first, then out of a More page, then to Home, then out of the app.
    BackHandler(enabled = current?.canGoBack == true || nav.moreTab != null || nav.selected != SiteTab.HOME.id) {
        when {
            current?.canGoBack == true -> current.goBack()
            nav.moreTab != null -> nav.moreTab = null
            else -> nav.selected = SiteTab.HOME.id
        }
    }

    Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        if (wide) {
            NavigationRail(
                containerColor = MaterialTheme.colorScheme.surfaceContainer,
                windowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start),
            ) {
                Spacer(Modifier.height(8.dp))
                barItems.forEach { item ->
                    NavigationRailItem(
                        selected = nav.selected == item.id,
                        onClick = { select(item.id) },
                        icon = { Icon(item.icon, contentDescription = null) },
                        label = { Text(item.title) },
                        colors = NavigationRailItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.secondaryContainer),
                    )
                }
            }
        }
        Scaffold(
            modifier = Modifier.weight(1f),
            containerColor = MaterialTheme.colorScheme.background,
            contentWindowInsets = if (wide) WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.End) else WindowInsets.safeDrawing,
            bottomBar = {
                if (!wide) NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                    barItems.forEach { item ->
                        NavigationBarItem(
                            selected = nav.selected == item.id,
                            onClick = { select(item.id) },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(item.title, maxLines = 1) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.secondaryContainer),
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                val tab = nav.currentTab()
                if (tab == null) {
                    MoreScreen(store, onOpen = { nav.moreTab = it; Haptics.play(view, Haptics.Kind.TAP) })
                } else if (nav.selected == Nav.MORE) {
                    Column(Modifier.fillMaxSize()) {
                        MorePageBar(tab.title, onBack = { nav.moreTab = null }, onReload = { store.page(tab).reload() })
                        Box(Modifier.weight(1f)) { WebTab(store, tab) }
                    }
                } else {
                    WebTab(store, tab)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MorePageBar(title: String, onBack: () -> Unit, onReload: () -> Unit) {
    TopAppBar(
        title = { Text(title, fontWeight = FontWeight.SemiBold) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") } },
        actions = { IconButton(onClick = onReload) { Icon(Icons.Rounded.Refresh, contentDescription = "Reload") } },
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

/** One page: its web view, a thin loading bar, and what to show when there is no connection. */
@Composable
private fun WebTab(store: PageStore, tab: SiteTab) {
    val page = store.page(tab)
    Box(Modifier.fillMaxSize()) {
        key(tab.id) {
            AndroidView(factory = { store.frame(tab).also { page.loadIfNeeded() } }, modifier = Modifier.fillMaxSize())
        }
        AnimatedVisibility(page.isLoading && page.progress in 1..99, modifier = Modifier.align(Alignment.TopCenter)) {
            LinearProgressIndicator(progress = { page.progress / 100f }, modifier = Modifier.fillMaxWidth().height(2.dp))
        }
        page.offlineSavedAt?.let { savedAt -> OfflineNote(savedAt, onRetry = page::reload, modifier = Modifier.align(Alignment.BottomCenter)) }
        if (page.failedOffline) OfflineScreen(onRetry = page::reload)
    }
}

@Composable
private fun OfflineNote(savedAt: Long, onRetry: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val time = DateFormat.getTimeFormat(context).format(Date(savedAt))
    val day = DateFormat.getMediumDateFormat(context).format(Date(savedAt))
    val today = DateFormat.getMediumDateFormat(context).format(Date())
    Surface(
        modifier = modifier.padding(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.large,
        tonalElevation = 2.dp,
    ) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.CloudOff, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "Offline. Saved copy from ${if (day == today) time else "$day $time"}",
                modifier = Modifier.padding(horizontal = 10.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
            TextButton(onClick = onRetry) { Text("Retry") }
        }
    }
}

@Composable
private fun OfflineScreen(onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Rounded.CloudOff, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        Text("You're offline", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            "This page hasn't been saved yet. Pages you open are kept for when there's no connection.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRetry) { Text("Try again") }
    }
}
