package com.deeparam.wear

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.deeparam.wear.data.Favorites
import com.deeparam.wear.data.WatchData
import com.deeparam.wear.data.WatchFeed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Holds what the watch shows. Opens with the saved copy, then refreshes from the site. */
class WatchStore(app: Application) : AndroidViewModel(app) {
    data class State(
        val data: WatchData? = null,
        val savedAt: Long? = null,
        val loading: Boolean = false,
        val failed: Boolean = false,
        val pinned: List<String> = emptyList(),
    )

    private val feed = WatchFeed(File(app.filesDir, "watch-data.json"))
    private val favorites = Favorites(app)
    private val _state = MutableStateFlow(State(pinned = favorites.ids))
    val state: StateFlow<State> = _state.asStateFlow()
    private var loaded = false

    init {
        viewModelScope.launch {
            val saved = withContext(Dispatchers.IO) { feed.load() }
            if (saved != null) _state.update { it.copy(data = saved.data, savedAt = saved.savedAt) }
            loaded = true
            refreshIfStale()
        }
    }

    /** Refreshes when there is nothing yet or the copy is older than an hour. */
    fun refreshIfStale() {
        if (!loaded) return
        val savedAt = _state.value.savedAt
        if (savedAt != null && System.currentTimeMillis() - savedAt < 60 * 60 * 1000) return
        refresh()
    }

    fun refresh() {
        if (_state.value.loading) return
        _state.update { it.copy(loading = true) }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { feed.refresh() } }
            _state.update { s ->
                result.fold(
                    { s.copy(data = it.data, savedAt = it.savedAt, loading = false, failed = false) },
                    { s.copy(loading = false, failed = true) },
                )
            }
        }
    }

    fun togglePin(id: String) {
        favorites.toggle(id)
        _state.update { it.copy(pinned = favorites.ids) }
    }
}
