package com.deeparam.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The site's colours (web/src/app/globals.css): dark by default, Mist when the site is set to Light. */
object SiteColors {
    val darkBg = Color(0xFF090B0F)
    val darkSurface = Color(0xFF11151C)
    val darkRaised = Color(0xFF181D26)
    val darkFg = Color(0xFFE8ECF2)
    val darkMuted = Color(0xFF8B94A3)
    val darkLine = Color(0xFF222936)
    val darkAccent = Color(0xFF5CC0FF)
    val darkAccentInk = Color(0xFF04121C)
    val darkAccentSoft = Color(0xFF0F2533)

    val lightBg = Color(0xFFE7EBEF)
    val lightSurface = Color(0xFFF0F3F6)
    val lightRaised = Color(0xFFE0E5EB)
    val lightFg = Color(0xFF1F252E)
    val lightMuted = Color(0xFF525B68)
    val lightLine = Color(0xFFD3DAE2)
    val lightAccent = Color(0xFF09659D)
    val lightAccentInk = Color(0xFFFFFFFF)
    val lightAccentSoft = Color(0xFFD6E6F1)
}

@Composable
fun DeepARAMTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = with(SiteColors) {
        if (dark) darkColorScheme(
            primary = darkAccent, onPrimary = darkAccentInk,
            secondaryContainer = darkAccentSoft, onSecondaryContainer = darkFg,
            background = darkBg, onBackground = darkFg,
            surface = darkBg, onSurface = darkFg,
            surfaceContainer = darkSurface, surfaceContainerHigh = darkRaised, surfaceContainerLow = darkSurface,
            surfaceVariant = darkRaised, onSurfaceVariant = darkMuted,
            outline = darkLine, outlineVariant = darkLine,
        ) else lightColorScheme(
            primary = lightAccent, onPrimary = lightAccentInk,
            secondaryContainer = lightAccentSoft, onSecondaryContainer = lightFg,
            background = lightBg, onBackground = lightFg,
            surface = lightBg, onSurface = lightFg,
            surfaceContainer = lightSurface, surfaceContainerHigh = lightRaised, surfaceContainerLow = lightSurface,
            surfaceVariant = lightRaised, onSurfaceVariant = lightMuted,
            outline = lightLine, outlineVariant = lightLine,
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}
