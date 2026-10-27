package com.deeparam.wear.data

import android.content.Context

/** Champions pinned to the top of the home screen, kept on the watch. */
class Favorites(context: Context) {
    private val prefs = context.getSharedPreferences("deeparam", Context.MODE_PRIVATE)

    val ids: List<String>
        get() = prefs.getString(KEY, "").orEmpty().split(",").filter { it.isNotEmpty() }

    fun contains(id: String): Boolean = id in ids

    fun toggle(id: String) {
        val list = ids.toMutableList()
        if (!list.remove(id)) list.add(id)
        prefs.edit().putString(KEY, list.joinToString(",")).apply()
    }

    private companion object {
        const val KEY = "favorites"
    }
}
