package com.deeparam.wear.ui

import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.deeparam.wear.WatchStore

/** Screens: home, Chef's Special, champion list, one champion, About. Swipe right to go back. */
@Composable
fun DeepARAMWearApp(store: WatchStore) {
    val state by store.state.collectAsStateWithLifecycle()
    val nav = rememberSwipeDismissableNavController()

    DeepTheme {
        Scaffold(
            modifier = Modifier.background(MaterialTheme.colors.background),
            timeText = { TimeText() },
            vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        ) {
            SwipeDismissableNavHost(navController = nav, startDestination = "home") {
                composable("home") {
                    HomeScreen(
                        state = state,
                        onSpecial = { nav.navigate("special") },
                        onChampions = { nav.navigate("champions") },
                        onChampion = { nav.navigate("champion/$it") },
                        onAbout = { nav.navigate("about") },
                        onRetry = store::refresh,
                    )
                }
                composable("special") {
                    state.data?.chefsSpecial?.let { SpecialScreen(it) }
                }
                composable("champions") {
                    ChampionListScreen(state.data, onChampion = { nav.navigate("champion/$it") })
                }
                composable("champion/{id}") { entry ->
                    val id = entry.arguments?.getString("id").orEmpty()
                    state.data?.champion(id)?.let {
                        ChampionScreen(it, pinned = id in state.pinned, onTogglePin = { store.togglePin(id) })
                    }
                }
                composable("about") {
                    AboutScreen(state, onRefresh = store::refresh)
                }
            }
        }
    }
}
