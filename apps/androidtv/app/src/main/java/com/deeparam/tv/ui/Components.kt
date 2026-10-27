package com.deeparam.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.deeparam.tv.Named
import com.deeparam.tv.siteUrl

@Composable
fun SiteImage(path: String?, size: Dp, modifier: Modifier = Modifier, corner: Dp = 12.dp) {
    val shape = RoundedCornerShape(corner)
    Box(modifier.size(size).clip(shape).background(Palette.raised)) {
        val url = siteUrl(path)
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        }
    }
}

@Composable
fun TierChip(tier: String?, modifier: Modifier = Modifier, large: Boolean = false) {
    val (bg, ink) = tierColors(tier)
    Box(
        modifier
            .clip(RoundedCornerShape(if (large) 12.dp else 8.dp))
            .background(bg)
            .widthIn(min = if (large) 56.dp else 34.dp)
            .padding(horizontal = if (large) 14.dp else 8.dp, vertical = if (large) 6.dp else 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(tier ?: "–", color = ink, fontWeight = FontWeight.Bold, fontSize = if (large) 28.sp else 16.sp)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, color: Color = Palette.fg) {
    Text(text, modifier = modifier, style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.SemiBold)
}

/** A wrapping row of icon + name pills, for items and augments. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NamedPills(list: List<Named>, accent: Color = Palette.fg, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        list.forEach { NamedPill(it, accent) }
    }
}

@Composable
fun NamedPill(named: Named, accent: Color = Palette.fg, badge: String? = null) {
    Row(
        Modifier.clip(RoundedCornerShape(14.dp)).background(Palette.bg).padding(end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (named.icon != null) SiteImage(named.icon, 48.dp, corner = 14.dp) else Box(Modifier.size(width = 4.dp, height = 48.dp))
        Text(named.name, color = accent, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        if (badge != null) {
            Text(badge, color = Palette.accentInk, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Palette.accent).padding(horizontal = 6.dp, vertical = 1.dp))
        }
    }
}

@Composable
fun Stat(label: String, value: String?) {
    if (value == null) return
    androidx.compose.foundation.layout.Column {
        Text(label, color = Palette.muted, fontSize = 15.sp)
        Text(value, color = Palette.fg, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
    }
}
