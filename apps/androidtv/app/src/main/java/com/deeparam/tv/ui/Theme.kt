package com.deeparam.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

// The site's dark theme colors (web/src/app/globals.css).
object Palette {
    val bg = Color(0xFF090B0F)
    val surface = Color(0xFF11151C)
    val raised = Color(0xFF181D26)
    val fg = Color(0xFFE8ECF2)
    val muted = Color(0xFF8B94A3)
    val line = Color(0xFF222936)
    val accent = Color(0xFF5CC0FF)
    val accentInk = Color(0xFF04121C)
    val good = Color(0xFF4CC98B)
    val bad = Color(0xFFF0776F)
    val gold = Color(0xFFE0B45C)
    val silver = Color(0xFFA3ADBB)
    val prismatic = Brush.linearGradient(listOf(Color(0xFF9FE7FF), Color(0xFFC9B8FF), Color(0xFFFFB8E0), Color(0xFFFFE2A3)))
    val prismaticInk = Color(0xFFC9B8FF)
}

/** Tier chip background and text, as on the site's tier list. */
fun tierColors(tier: String?): Pair<Color, Color> = when (tier?.uppercase()) {
    "S" -> Color(0xFFE2553F) to Color.White
    "A" -> Color(0xFFF0913A) to Color(0xFF1A0E02)
    "B" -> Color(0xFFE6C24A) to Color(0xFF1D1602)
    "C" -> Color(0xFF7FB6E8) to Color(0xFF04121C)
    else -> Palette.raised to Palette.muted
}

fun rarityColor(rarity: String): Color = when (rarity) {
    "prismatic" -> Palette.prismaticInk
    "gold" -> Palette.gold
    else -> Palette.silver
}

fun rarityLabel(rarity: String): String = rarity.replaceFirstChar { it.uppercase() }

@Composable
fun DeepAramTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Palette.accentInk,
            background = Palette.bg,
            onBackground = Palette.fg,
            surface = Palette.surface,
            onSurface = Palette.fg,
            surfaceVariant = Palette.raised,
            onSurfaceVariant = Palette.muted,
            border = Palette.line,
            inverseSurface = Palette.fg,
            inverseOnSurface = Palette.bg,
        ),
        content = content,
    )
}
