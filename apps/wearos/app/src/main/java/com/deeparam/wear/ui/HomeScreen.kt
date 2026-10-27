package com.deeparam.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import com.deeparam.wear.R
import com.deeparam.wear.WatchStore
import com.deeparam.wear.data.Champion

/** Patch, today's Chef's Special, pinned champions and the champion list. */
@Composable
fun HomeScreen(
    state: WatchStore.State,
    onSpecial: () -> Unit,
    onChampions: () -> Unit,
    onChampion: (String) -> Unit,
    onAbout: () -> Unit,
    onRetry: () -> Unit,
) {
    val list = rememberScalingLazyListState()
    val data = state.data
    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item {
                ListHeader {
                    Text(
                        data?.patch?.let { stringResource(R.string.patch, it) } ?: stringResource(R.string.app_name),
                        style = MaterialTheme.typography.title3,
                    )
                }
            }
            if (data != null) {
                data.chefsSpecial?.let { special ->
                    item { ListHeader { Text(stringResource(R.string.chefs_special), color = MaterialTheme.colors.primary) } }
                    item {
                        Chip(
                            onClick = onSpecial,
                            label = { Text(special.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            secondaryLabel = { Text(special.name) },
                            icon = { ChampionIcon(special.iconUrl, ChipDefaults.LargeIconSize) },
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                val pinned = state.pinned.mapNotNull(data::champion)
                if (pinned.isNotEmpty()) {
                    item { ListHeader { Text(stringResource(R.string.pinned)) } }
                    items(pinned, key = { it.id }) { ChampionChip(it) { onChampion(it.id) } }
                }
                item {
                    Chip(
                        onClick = onChampions,
                        label = { Text(stringResource(R.string.champions)) },
                        colors = ChipDefaults.primaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else if (state.loading) {
                item { CircularProgressIndicator(Modifier.size(32.dp)) }
            } else {
                item {
                    Text(
                        stringResource(R.string.cant_reach),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.body2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Chip(onClick = onRetry, label = { Text(stringResource(R.string.try_again)) },
                        modifier = Modifier.fillMaxWidth())
                }
            }
            item {
                Chip(
                    onClick = onAbout,
                    label = { Text(stringResource(R.string.about)) },
                    colors = ChipDefaults.childChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
fun ChampionChip(champion: Champion, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        label = { Text(champion.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = champion.tier?.let { tier ->
            { Text(stringResource(R.string.tier, tier), color = DeepColors.tier(tier)) }
        },
        icon = { ChampionIcon(champion.iconUrl, ChipDefaults.IconSize) },
        colors = ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth(),
    )
}
