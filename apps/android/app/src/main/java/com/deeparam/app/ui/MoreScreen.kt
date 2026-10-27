package com.deeparam.app.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Vibration
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.deeparam.app.BuildConfig
import com.deeparam.app.PageStore
import com.deeparam.app.PatchAlerts
import com.deeparam.core.Haptics
import com.deeparam.core.Legal
import com.deeparam.core.SiteTab

/** The More tab: the site's other pages, the app's settings, and the legal pages and notice. */
@Composable
fun MoreScreen(store: PageStore, onOpen: (SiteTab) -> Unit) {
    val context = LocalContext.current
    val view = LocalView.current
    var alertsOn by remember { mutableStateOf(PatchAlerts.isEnabled(context) && PatchAlerts.canNotify(context)) }
    var alertsDenied by remember { mutableStateOf(false) }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        alertsOn = granted
        alertsDenied = !granted
        PatchAlerts.setEnabled(context, granted)
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.widthIn(max = 720.dp).fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item { Header("More") }
            pages(SiteTab.MORE, onOpen)
            item { Section("Settings") }
            item {
                SwitchRow(
                    Icons.Rounded.Vibration, "Haptics",
                    "Light taps when you switch tabs, pull to refresh, draft augments and more. Same switch as Vibration in the site's settings.",
                    store.hapticsOn,
                ) { on ->
                    if (!on) Haptics.play(view, Haptics.Kind.TICK)
                    store.setHaptics(on)
                    if (on) Haptics.play(view, Haptics.Kind.TICK)
                }
            }
            item {
                SwitchRow(
                    Icons.Rounded.NotificationsActive, "New patch alerts",
                    if (alertsDenied) "Notifications are off for DeepARAM. Turn them on in Android's settings to get patch alerts."
                    else "Get a notification when a new live patch or PBE update is on DeepARAM.",
                    alertsOn,
                ) { on ->
                    Haptics.play(view, Haptics.Kind.TICK)
                    if (on && Build.VERSION.SDK_INT >= 33 && !PatchAlerts.canNotify(context)) {
                        askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        alertsOn = on
                        PatchAlerts.setEnabled(context, on)
                    }
                }
            }
            item { Section("About") }
            pages(SiteTab.LEGAL, onOpen)
            item {
                Row(Icons.Rounded.Email, "Contact") {
                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:${Legal.CONTACT_EMAIL}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            item {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(Legal.RIOT_NOTICE, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "DeepARAM ${BuildConfig.VERSION_NAME}",
                        modifier = Modifier.padding(top = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun LazyListScope.pages(tabs: List<SiteTab>, onOpen: (SiteTab) -> Unit) {
    tabs.forEach { tab -> item(tab.id) { Row(iconFor(tab.icon), tab.title) { onOpen(tab) } } }
}

@Composable
private fun Header(title: String) {
    Text(title, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
}

@Composable
private fun Section(title: String) {
    HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.outline)
    Text(title, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Row(icon: ImageVector, title: String, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title, style = MaterialTheme.typography.titleMedium) },
        leadingContent = { Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 4.dp),
    )
}

@Composable
private fun SwitchRow(icon: ImageVector, title: String, note: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title, style = MaterialTheme.typography.titleMedium) },
        supportingContent = { Text(note) },
        leadingContent = { Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
        trailingContent = { Switch(checked = checked, onCheckedChange = onChange) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        modifier = Modifier.clickable { onChange(!checked) }.padding(horizontal = 4.dp),
    )
}
