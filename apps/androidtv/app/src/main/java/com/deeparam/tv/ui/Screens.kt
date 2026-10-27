package com.deeparam.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.FilterChip
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.deeparam.tv.AugmentTier
import com.deeparam.tv.BuildConfig
import com.deeparam.tv.Champion
import com.deeparam.tv.ChefSpecial
import com.deeparam.tv.Named
import com.deeparam.tv.Pbe
import com.deeparam.tv.RARITIES
import com.deeparam.tv.TIERS
import com.deeparam.tv.percent

private val ScreenPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 24.dp, bottom = 48.dp)

/** A focusable block, so the remote can move through long pages one section at a time. */
@Composable
fun FocusBlock(modifier: Modifier = Modifier, onClick: () -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(24.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.surface,
            contentColor = Palette.fg,
            focusedContainerColor = Palette.raised,
            focusedContentColor = Palette.fg,
            pressedContainerColor = Palette.raised,
            pressedContentColor = Palette.fg,
        ),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Palette.accent))),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.01f),
    ) {
        Column(Modifier.padding(28.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

/** Tier-ordered champion grid. Within a tier the highest win rate comes first. */
fun championsByTier(champions: List<Champion>): List<Pair<String, List<Champion>>> {
    val order = TIERS + listOf("")
    return champions
        .groupBy { it.tier?.uppercase()?.takeIf { t -> t in TIERS } ?: "" }
        .toList()
        .sortedBy { order.indexOf(it.first) }
        .map { (tier, list) -> tier to list.sortedWith(compareByDescending<Champion> { it.winRate ?: -1.0 }.thenBy { it.name }) }
}

@Composable
fun ChampionsScreen(
    champions: List<Champion>,
    gridState: LazyGridState,
    restoreId: String?,
    onOpen: (Champion) -> Unit,
) {
    val groups = remember(champions) { championsByTier(champions) }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(168.dp),
        state = gridState,
        contentPadding = ScreenPadding,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        for ((tier, list) in groups) {
            item(span = { GridItemSpan(maxLineSpan) }, key = "tier-$tier") {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    TierChip(tier.ifEmpty { null }, large = true)
                    Text(if (tier.isEmpty()) "Not enough games" else "${list.size} champion${if (list.size == 1) "" else "s"}", color = Palette.muted, fontSize = 18.sp)
                }
            }
            items(list, key = { it.id }) { champion ->
                val requester = remember { FocusRequester() }
                ChampionCard(champion, Modifier.focusRequester(requester)) { onOpen(champion) }
                if (champion.id == restoreId) LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
            }
        }
    }
}

@Composable
private fun ChampionCard(champion: Champion, modifier: Modifier, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = modifier,
        colors = CardDefaults.colors(containerColor = Palette.surface, focusedContainerColor = Palette.raised),
        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, Palette.accent))),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            SiteImage(champion.icon, 96.dp, corner = 20.dp)
            Spacer(Modifier.height(10.dp))
            Text(champion.name, color = Palette.fg, fontSize = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(percent(champion.winRate)?.let { "$it win rate" } ?: " ", color = Palette.muted, fontSize = 14.sp)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun AugmentsScreen(augments: List<AugmentTier>) {
    var rarity by rememberSaveable { mutableStateOf<String?>(null) }
    val shown = remember(augments, rarity) {
        augments.filter { rarity == null || it.rarity == rarity }
            .sortedWith(compareBy<AugmentTier> { TIERS.indexOf(it.tier?.uppercase()).let { i -> if (i < 0) 99 else i } }
                .thenByDescending { it.winRate ?: -1.0 })
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(300.dp),
        contentPadding = ScreenPadding,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                (listOf<String?>(null) + RARITIES).forEach { r ->
                    FilterChip(selected = rarity == r, onClick = { rarity = r }) {
                        Text(r?.let { rarityLabel(it) } ?: "All", fontSize = 16.sp)
                    }
                }
            }
        }
        items(shown, key = { it.name + it.rarity }) { aug ->
            Card(
                onClick = {},
                colors = CardDefaults.colors(containerColor = Palette.surface, focusedContainerColor = Palette.raised),
                border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, Palette.accent))),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    SiteImage(aug.icon, 64.dp, corner = 14.dp)
                    Column(Modifier.weight(1f)) {
                        Text(aug.name, color = rarityColor(aug.rarity), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(percent(aug.winRate)?.let { "$it win" }, percent(aug.pickRate)?.let { "$it pick" }).joinToString(" · "),
                            color = Palette.muted, fontSize = 14.sp, maxLines = 1)
                    }
                    TierChip(aug.tier)
                }
            }
        }
    }
}

@Composable
fun ChampionDetail(champion: Champion, patch: String) {
    val first = remember { FocusRequester() }
    LazyColumn(contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.fillMaxSize()) {
        item {
            FocusBlock(Modifier.focusRequester(first)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    SiteImage(champion.icon, 144.dp, corner = 28.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(champion.name, fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Palette.fg)
                            TierChip(champion.tier, large = true)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                            Stat("Win rate", percent(champion.winRate))
                            Stat("Pick rate", percent(champion.pickRate))
                            Stat("Patch", patch.ifEmpty { null })
                        }
                    }
                }
            }
        }
        if (champion.skills.isNotEmpty()) item {
            FocusBlock {
                SectionTitle("Skill order")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    champion.skills.forEachIndexed { i, s ->
                        if (i > 0) Text("›", color = Palette.muted, fontSize = 28.sp)
                        Box(Modifier.width(56.dp).height(56.dp), contentAlignment = Alignment.Center) {
                            Text(s, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Palette.accent)
                        }
                    }
                }
            }
        }
        if (champion.items.isNotEmpty()) item {
            FocusBlock {
                SectionTitle("Build")
                NamedPills(champion.items)
            }
        }
        if (champion.augments.isNotEmpty()) item {
            FocusBlock {
                SectionTitle("Best augments")
                champion.augments.forEach { (rarity, list) ->
                    Text(rarityLabel(rarity), color = rarityColor(rarity), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    NamedPills(list, accent = rarityColor(rarity))
                }
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
}

@Composable
fun ChefScreen(chef: ChefSpecial, champion: Champion?, onOpenChampion: (Champion) -> Unit) {
    LazyColumn(contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.fillMaxSize()) {
        item {
            FocusBlock(onClick = { champion?.let(onOpenChampion) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    SiteImage(champion?.icon ?: chef.icon, 144.dp, corner = 28.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Chef Special" + (chef.date?.let { " · $it" } ?: ""), color = Palette.gold, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        Text(chef.title, fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Palette.fg)
                        Text(chef.name + (if (champion != null) "  ·  Select for champion page" else ""), color = Palette.muted, fontSize = 18.sp)
                    }
                }
            }
        }
        if (chef.augments.isNotEmpty()) item {
            FocusBlock {
                SectionTitle("Augments")
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    chef.augments.forEach { NamedPill(Named(it.name, it.icon), rarityColor(it.rarity), badge = if (it.core) "Core" else null) }
                }
            }
        }
        if (chef.items.isNotEmpty()) item {
            FocusBlock {
                SectionTitle("Items")
                NamedPills(chef.items)
            }
        }
        chef.why?.let { item { FocusBlock { SectionTitle("Why it works"); Body(it) } } }
        chef.play?.let { item { FocusBlock { SectionTitle("How to play it"); Body(it) } } }
    }
}

@Composable
fun PbeScreen(pbe: Pbe) {
    LazyColumn(contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.fillMaxSize()) {
        item {
            FocusBlock {
                Text(pbe.label ?: "PBE", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Palette.fg)
                pbe.dataAsOf?.let { Text("Updated $it", color = Palette.muted, fontSize = 17.sp) }
                pbe.augmentPool?.let { Body(it) }
                pbe.caveat?.let { Body(it, Palette.muted) }
            }
        }
        if (pbe.sections.isEmpty()) item { FocusBlock { Body("No PBE changes right now.") } }
        pbe.sections.forEach { section ->
            item { SectionTitle(section.title, Modifier.padding(top = 12.dp, start = 8.dp), Palette.accent) }
            items(section.entries) { entry ->
                FocusBlock {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (entry.icon != null) SiteImage(entry.icon, 56.dp, corner = 14.dp)
                        Text(entry.name, fontSize = 22.sp, fontWeight = FontWeight.SemiBold,
                            color = entry.rarity?.let { rarityColor(it) } ?: Palette.fg)
                    }
                    entry.lines.forEach { Body("•  $it") }
                }
            }
        }
    }
}

@Composable
fun AboutScreen(riotNotice: String, savedAt: String?) {
    LazyColumn(contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.fillMaxSize()) {
        item {
            FocusBlock {
                Text("DeepARAM", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = Palette.fg)
                Body("ARAM Mayhem tier lists, builds and PBE changes on your TV. The Simulator, The Kitchen and your own stats are on deeparam.com.")
                Text("Version ${BuildConfig.VERSION_NAME}" + (savedAt?.let { "  ·  Showing a copy saved $it" } ?: ""), color = Palette.muted, fontSize = 16.sp)
            }
        }
        item { FocusBlock { Body(riotNotice, Palette.muted) } }
    }
}

@Composable
private fun Body(text: String, color: Color = Palette.fg) {
    Text(text, color = color, fontSize = 20.sp, lineHeight = 30.sp)
}
