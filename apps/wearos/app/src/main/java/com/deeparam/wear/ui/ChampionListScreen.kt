package com.deeparam.wear.ui

import android.app.RemoteInput
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.input.RemoteInputIntentHelper
import com.deeparam.wear.R
import com.deeparam.wear.data.WatchData

private const val QUERY = "query"

/** Every champion, searchable by voice, keyboard or handwriting. */
@Composable
fun ChampionListScreen(data: WatchData?, onChampion: (String) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val prompt = stringResource(R.string.search_prompt)
    val search = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        result.data?.let { RemoteInput.getResultsFromIntent(it)?.getCharSequence(QUERY) }?.let { query = it.toString() }
    }
    val list = rememberScalingLazyListState()
    val champions = data?.search(query).orEmpty()

    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item { ListHeader { Text(stringResource(R.string.champions)) } }
            item {
                Chip(
                    onClick = {
                        val intent: Intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
                        RemoteInputIntentHelper.putRemoteInputsExtra(
                            intent, listOf(RemoteInput.Builder(QUERY).setLabel(prompt).build()),
                        )
                        search.launch(intent)
                    },
                    label = { Text(if (query.isBlank()) prompt else "“$query”") },
                    secondaryLabel = if (query.isBlank()) null else {
                        { Text(stringResource(R.string.tap_to_change)) }
                    },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (query.isNotBlank()) {
                item {
                    Chip(onClick = { query = "" }, label = { Text(stringResource(R.string.show_all)) },
                        colors = ChipDefaults.childChipColors(), modifier = Modifier.fillMaxWidth())
                }
            }
            if (champions.isEmpty() && query.isNotBlank()) {
                item {
                    Text(stringResource(R.string.no_match), textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.body2, modifier = Modifier.fillMaxWidth())
                }
            }
            items(champions, key = { it.id }) { ChampionChip(it) { onChampion(it.id) } }
        }
    }
}
