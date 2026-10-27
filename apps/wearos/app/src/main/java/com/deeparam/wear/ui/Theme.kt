package com.deeparam.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

/** The site's dark theme colours. */
object DeepColors {
    val accent = Color(0xFF5CC0FF)
    val secondaryText = Color(0xFFB0B8C4)

    fun rarity(name: String): Color = when (name.lowercase()) {
        "prismatic" -> Color(0xFFD68CFF)
        "gold" -> Color(0xFFFFC74D)
        else -> Color(0xFFBFBFBF)
    }

    fun tier(tier: String): Color = when (tier.uppercase().take(1)) {
        "S" -> Color(0xFFFF7373)
        "A" -> Color(0xFFFFB359)
        "B" -> Color(0xFFFFE066)
        "C" -> Color(0xFF8CD980)
        else -> Color(0xFFB3B3B3)
    }
}

@Composable
fun DeepTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = DeepColors.accent,
            primaryVariant = DeepColors.accent,
            secondary = DeepColors.accent,
            onPrimary = Color.Black,
            onSecondary = Color.Black,
        ),
        content = content,
    )
}
