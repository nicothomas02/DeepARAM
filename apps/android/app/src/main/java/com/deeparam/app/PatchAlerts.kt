package com.deeparam.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.deeparam.core.PatchWatcher
import com.deeparam.core.PrefsSeenStore
import com.deeparam.core.Site
import com.deeparam.core.SiteNews
import java.util.concurrent.TimeUnit

/**
 * "New patch alerts" in More: every few hours Android lets the app check the site, and a new live
 * patch or PBE update posts a notification that opens that patch recap or the PBE page.
 */
object PatchAlerts {
    private const val CHANNEL = "patches"
    private const val WORK = "deeparam.patch-check"
    private const val PREFS = "deeparam.settings"
    private const val KEY = "patchAlerts"

    fun isEnabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
        if (on) {
            schedule(context)
            // Records what is current now, so the first alert is for something actually new.
            WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<CheckWorker>().setConstraints(constraints()).build())
        } else {
            WorkManager.getInstance(context).cancelUniqueWork(WORK)
        }
    }

    fun canNotify(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun schedule(context: Context) {
        val req = PeriodicWorkRequestBuilder<CheckWorker>(4, TimeUnit.HOURS).setConstraints(constraints()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun createChannel(context: Context) {
        val ch = NotificationChannel(CHANNEL, context.getString(R.string.channel_patches), NotificationManager.IMPORTANCE_DEFAULT)
        ch.description = context.getString(R.string.channel_patches_desc)
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
    }

    fun notify(context: Context, news: SiteNews) {
        if (!canNotify(context)) return
        val (id, title, text, path) = when (news) {
            is SiteNews.NewPatch -> Quad(1, "Patch ${news.patch} is live", "See what changed for ARAM Mayhem.", "/patches/${news.patch}")
            is SiteNews.NewPBE -> Quad(2, "New PBE update", "See what's changing on the test server.", "/pbe")
        }
        val open = Intent(Intent.ACTION_VIEW, Uri.parse(Site.url(path)), context, MainActivity::class.java)
        val pending = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(context).notify(id, n) } catch (_: SecurityException) {}
    }

    private data class Quad(val id: Int, val title: String, val text: String, val path: String)

    class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            if (!isEnabled(applicationContext)) return Result.success()
            val news = runCatching { PatchWatcher(PrefsSeenStore(applicationContext)).check() }.getOrElse { return Result.retry() }
            news.forEach { notify(applicationContext, it) }
            return Result.success()
        }
    }
}
