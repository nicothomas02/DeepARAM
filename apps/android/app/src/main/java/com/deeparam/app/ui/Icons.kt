package com.deeparam.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountCircle
import androidx.compose.material.icons.rounded.Article
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Leaderboard
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.Restaurant
import androidx.compose.material.icons.rounded.Science
import androidx.compose.ui.graphics.vector.ImageVector

/** The icon for each SiteTab.icon name. */
fun iconFor(name: String): ImageVector = when (name) {
    "home" -> Icons.Rounded.Home
    "tiers" -> Icons.Rounded.Leaderboard
    "simulator" -> Icons.Rounded.Bolt
    "kitchen" -> Icons.Rounded.Restaurant
    "pbe" -> Icons.Rounded.Science
    "patches" -> Icons.Rounded.Article
    "info" -> Icons.Rounded.Info
    "champions" -> Icons.Rounded.Groups
    "items" -> Icons.Rounded.Inventory2
    "account" -> Icons.Rounded.AccountCircle
    "privacy" -> Icons.Rounded.PrivacyTip
    "terms" -> Icons.Rounded.Gavel
    else -> Icons.Rounded.Menu
}
