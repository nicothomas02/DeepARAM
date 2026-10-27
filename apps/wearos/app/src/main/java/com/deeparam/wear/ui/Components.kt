package com.deeparam.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import coil.compose.AsyncImage

@Composable
fun ChampionIcon(url: String, size: Dp) {
    AsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape).background(Color.Gray.copy(alpha = 0.25f)),
    )
}

/** Numbered list rows, like a build order. */
@Composable
fun NumberedRow(number: Int, text: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("$number", style = MaterialTheme.typography.caption2, color = DeepColors.secondaryText,
            modifier = Modifier.sizeIn(minWidth = 16.dp))
        Text(text, style = MaterialTheme.typography.body2)
    }
}

@Composable
fun DotRow(text: String, color: Color) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("●", color = color, fontSize = 8.sp)
        Text(text, style = MaterialTheme.typography.body2)
    }
}

/** Skill max order, like Q > E > W. */
@Composable
fun SkillOrder(skills: List<String>) {
    val label = "Max " + skills.joinToString(", then ")
    Row(
        Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        skills.forEachIndexed { i, s ->
            if (i > 0) Text("›", color = DeepColors.secondaryText)
            Text(
                s,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .background(DeepColors.accent.copy(alpha = if (i == 0) 0.35f else 0.15f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
    }
}
