package com.deeparam.tv

import android.os.Bundle
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.Tab
import androidx.tv.material3.TabRow
import androidx.tv.material3.Text
import androidx.compose.foundation.Image
import com.deeparam.tv.ui.AboutScreen
import com.deeparam.tv.ui.AugmentsScreen
import com.deeparam.tv.ui.ChampionDetail
import com.deeparam.tv.ui.ChampionsScreen
import com.deeparam.tv.ui.ChefScreen
import com.deeparam.tv.ui.DeepAramTheme
import com.deeparam.tv.ui.Palette
import com.deeparam.tv.ui.PbeScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = Repository(applicationContext)
        setContent {
            DeepAramTheme {
                Box(Modifier.fillMaxSize().background(Palette.bg)) { App(repository) }
            }
        }
    }
}

private sealed interface UiState {
    data object Loading : UiState
    data object Failed : UiState
    data class Ready(val loaded: Loaded) : UiState
}

internal enum class Section(val label: String) { Champions("Tier List"), Augments("Augments"), Chef("Chef Special"), Pbe("PBE"), About("About") }

/** Tabs that have something to show; Augments and PBE wait for the data that fills them. */
internal fun sectionsFor(data: TvData): List<Section> = buildList {
    add(Section.Champions)
    if (data.augments.isNotEmpty()) add(Section.Augments)
    if (data.chefsSpecial != null) add(Section.Chef)
    if (data.pbe != null) add(Section.Pbe)
    add(Section.About)
}

@Composable
private fun App(repository: Repository) {
    var state by remember { mutableStateOf<UiState>(UiState.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        // A reload behind data already on screen keeps that data (and the place in it) if it fails.
        if (state !is UiState.Ready) state = UiState.Loading
        val result = runCatching { repository.load() }
        state = result.fold({ UiState.Ready(it) }, { if (state is UiState.Ready) state else UiState.Failed })
    }
    when (val s = state) {
        UiState.Loading -> Centered { Text("Loading…", color = Palette.muted, fontSize = 22.sp) }
        UiState.Failed -> Centered {
            val retry = remember { FocusRequester() }
            Text("Can't reach deeparam.com right now.", color = Palette.fg, fontSize = 26.sp)
            Spacer(Modifier.size(24.dp))
            Button(onClick = { attempt++ }, modifier = Modifier.focusRequester(retry)) { Text("Try again") }
            LaunchedEffect(Unit) { runCatching { retry.requestFocus() } }
        }
        is UiState.Ready -> Ready(s.loaded, onReload = { attempt++ })
    }
}

@Composable
private fun Ready(loaded: Loaded, onReload: () -> Unit) {
    val data = loaded.data
    val sections = remember(data) { sectionsFor(data) }
    var selected by rememberSaveable { mutableIntStateOf(0) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var restoreId by remember { mutableStateOf<String?>(null) }
    val gridState = rememberLazyGridState()
    val section = sections[selected.coerceIn(sections.indices)]
    val open = openId?.let { id -> data.champions.firstOrNull { it.id == id } }
    val savedAt = loaded.savedAt?.let { DateUtils.getRelativeTimeSpanString(it).toString().lowercase() }

    BackHandler(enabled = open != null) {
        restoreId = openId
        openId = null
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 48.dp, end = 48.dp, top = 28.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Image(painterResource(R.mipmap.ic_launcher), contentDescription = null, modifier = Modifier.size(44.dp))
            Text("DeepARAM", color = Palette.fg, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            if (open == null) {
                TabRow(selectedTabIndex = selected, modifier = Modifier.weight(1f)) {
                    sections.forEachIndexed { i, sec ->
                        Tab(selected = i == selected, onFocus = { selected = i }) {
                            Text(sec.label, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp))
                        }
                    }
                }
            } else {
                Text("‹  ${open.name}", color = Palette.muted, fontSize = 20.sp, modifier = Modifier.weight(1f))
            }
            Text(
                (if (data.patch.isNotEmpty()) "Patch ${data.patch}" else "") + (if (savedAt != null) "  ·  Offline" else ""),
                color = if (savedAt != null) Palette.bad else Palette.muted,
                fontSize = 18.sp,
            )
        }
        Box(Modifier.weight(1f)) {
            if (open != null) {
                ChampionDetail(open, data.patch)
            } else when (section) {
                Section.Champions -> ChampionsScreen(data.champions, gridState, restoreId) {
                    openId = it.id
                }
                Section.Augments -> AugmentsScreen(data.augments)
                Section.Chef -> data.chefsSpecial?.let { chef ->
                    ChefScreen(chef, data.champions.firstOrNull { it.id == chef.champion }) { openId = it.id }
                }
                Section.Pbe -> data.pbe?.let { PbeScreen(it) }
                Section.About -> AboutScreen(Legal.RIOT_NOTICE, savedAt)
            }
        }
    }
    if (savedAt != null) {
        // Try for fresh data again once a minute while showing the saved copy.
        LaunchedEffect(loaded) {
            kotlinx.coroutines.delay(60_000)
            onReload()
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        content()
    }
}
