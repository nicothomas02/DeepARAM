package com.deeparam.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.itemsIndexed
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import com.deeparam.wear.R
import com.deeparam.wear.data.Champion
import java.text.NumberFormat

/** One champion at a glance: skill max order, build and augments by rarity. */
@Composable
fun ChampionScreen(champion: Champion, pinned: Boolean, onTogglePin: () -> Unit) {
    val list = rememberScalingLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    ChampionIcon(champion.iconUrl, 40.dp)
                    Column {
                        Text(champion.name, style = MaterialTheme.typography.title3)
                        champion.tier?.let {
                            Text(stringResource(R.string.tier, it), color = DeepColors.tier(it),
                                style = MaterialTheme.typography.caption2, fontWeight = FontWeight.Bold)
                        }
                        champion.winRate?.let {
                            val pct = NumberFormat.getPercentInstance().apply { maximumFractionDigits = 1; minimumFractionDigits = 1 }
                            Text(stringResource(R.string.win_rate, pct.format(it)), color = DeepColors.secondaryText,
                                style = MaterialTheme.typography.caption2)
                        }
                    }
                }
            }
            if (champion.skills.isNotEmpty()) {
                item { ListHeader { Text(stringResource(R.string.skill_order)) } }
                item { SkillOrder(champion.skills) }
            }
            if (champion.items.isNotEmpty()) {
                item { ListHeader { Text(stringResource(R.string.build)) } }
                itemsIndexed(champion.items) { i, item -> NumberedRow(i + 1, item) }
            }
            champion.augments.byRarity.forEach { (rarity, names) ->
                item { ListHeader { Text(rarityLabel(rarity), color = DeepColors.rarity(rarity)) } }
                items(names) { DotRow(it, DeepColors.rarity(rarity)) }
            }
            item {
                Chip(
                    onClick = onTogglePin,
                    label = { Text(stringResource(if (pinned) R.string.unpin else R.string.pin)) },
                    colors = ChipDefaults.childChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
fun rarityLabel(rarity: String): String = when (rarity.lowercase()) {
    "prismatic" -> stringResource(R.string.prismatic)
    "gold" -> stringResource(R.string.gold)
    else -> stringResource(R.string.silver)
}
