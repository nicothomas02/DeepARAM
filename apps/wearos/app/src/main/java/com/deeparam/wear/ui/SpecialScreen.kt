package com.deeparam.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.itemsIndexed
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import com.deeparam.wear.R
import com.deeparam.wear.data.ChefsSpecial

/** Today's Chef's Special from The Kitchen. */
@Composable
fun SpecialScreen(special: ChefsSpecial) {
    val list = rememberScalingLazyListState()
    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item { ListHeader { Text(stringResource(R.string.chefs_special), color = MaterialTheme.colors.primary) } }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    ChampionIcon(special.iconUrl, 40.dp)
                    Column {
                        Text(special.title, style = MaterialTheme.typography.title3)
                        Text(special.name, style = MaterialTheme.typography.caption2, color = DeepColors.secondaryText)
                        special.tier?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.caption2, color = DeepColors.accent)
                        }
                    }
                }
            }
            special.play?.takeIf { it.isNotBlank() }?.let { play ->
                item { ListHeader { Text(stringResource(R.string.how_to_play)) } }
                item { Text(play, style = MaterialTheme.typography.body2, modifier = Modifier.padding(horizontal = 8.dp)) }
            }
            if (special.augments.isNotEmpty()) {
                item { ListHeader { Text(stringResource(R.string.augments)) } }
                items(special.augments) { DotRow(it.name, DeepColors.rarity(it.rarity)) }
            }
            if (special.items.isNotEmpty()) {
                item { ListHeader { Text(stringResource(R.string.build)) } }
                itemsIndexed(special.items) { i, item -> NumberedRow(i + 1, item) }
            }
        }
    }
}
