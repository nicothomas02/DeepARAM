package com.deeparam.core

import android.content.Context
import java.io.File

/** Keeps the last good copy of each page (an MHTML web archive) so a tab still opens without a connection. */
class OfflineStore(val folder: File) {
    constructor(context: Context) : this(File(context.cacheDir, "OfflinePages"))

    fun file(pageUrl: String): File {
        val path = Site.pathOf(pageUrl) ?: "/"
        val key = path.replace('/', '_').replace(Regex("[^A-Za-z0-9_.-]"), "-")
        return File(folder, "page$key.mht")
    }

    /** Where the web view should write a fresh copy; [commit] moves it into place once it is complete. */
    fun tempFile(pageUrl: String): File {
        folder.mkdirs()
        return File(folder, file(pageUrl).name + ".part")
    }

    fun commit(pageUrl: String): Boolean {
        val tmp = tempFile(pageUrl)
        if (!tmp.exists() || tmp.length() < 1024) { tmp.delete(); return false }
        return tmp.renameTo(file(pageUrl))
    }

    fun has(pageUrl: String) = file(pageUrl).exists()

    /** When the copy was saved, in milliseconds, or null if there is none. */
    fun savedAt(pageUrl: String): Long? = file(pageUrl).takeIf { it.exists() }?.lastModified()
}
