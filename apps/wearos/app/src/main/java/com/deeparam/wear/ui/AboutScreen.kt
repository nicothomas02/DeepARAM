package com.deeparam.wear.ui

import android.text.format.DateUtils
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import com.deeparam.wear.R
import com.deeparam.wear.WatchStore
import com.deeparam.wear.data.Legal

/** When the data was last updated, and Riot's notice. */
@Composable
fun AboutScreen(state: WatchStore.State, onRefresh: () -> Unit) {
    val list = rememberScalingLazyListState()
    val small = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item { ListHeader { Text(stringResource(R.string.app_name), style = MaterialTheme.typography.title3) } }
            item { Text(stringResource(R.string.tagline), style = MaterialTheme.typography.body2, textAlign = TextAlign.Center, modifier = small) }
            state.savedAt?.let { at ->
                item {
                    val ago = DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
                    Text(stringResource(R.string.updated, ago), style = MaterialTheme.typography.caption2,
                        color = DeepColors.secondaryText, textAlign = TextAlign.Center, modifier = small)
                }
            }
            if (state.failed) {
                item {
                    Text(stringResource(R.string.offline), style = MaterialTheme.typography.caption2,
                        color = DeepColors.secondaryText, textAlign = TextAlign.Center, modifier = small)
                }
            }
            item {
                Chip(onClick = onRefresh, enabled = !state.loading, label = { Text(stringResource(R.string.refresh)) },
                    modifier = Modifier.fillMaxWidth())
            }
            item {
                Text(Legal.RIOT_NOTICE, fontSize = 10.sp, color = DeepColors.secondaryText,
                    textAlign = TextAlign.Center, modifier = small)
            }
        }
    }
}
