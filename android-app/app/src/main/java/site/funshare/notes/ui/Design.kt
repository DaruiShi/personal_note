package site.funshare.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/** True when the app's theme (not necessarily the system) is dark. */
val LocalIsDark = staticCompositionLocalOf { false }

/** Indigo → violet → fuchsia, the app's signature gradient. */
val BrandGradient = listOf(Color(0xFF6366F1), Color(0xFF8B5CF6), Color(0xFFD946EF))

fun brandBrush(): Brush = Brush.linearGradient(BrandGradient)

/* ----------------------------------------------------- tag color palette */

data class TagStyle(val bg: Color, val fg: Color)

private val TagPaletteLight = listOf(
    TagStyle(Color(0xFFE4E4FF), Color(0xFF3F3CB8)),
    TagStyle(Color(0xFFFFE1EA), Color(0xFFA3124C)),
    TagStyle(Color(0xFFFCF0D3), Color(0xFF8A5A00)),
    TagStyle(Color(0xFFD9F3E3), Color(0xFF0E6B43)),
    TagStyle(Color(0xFFDDF0FD), Color(0xFF0B6291)),
)

private val TagPaletteDark = listOf(
    TagStyle(Color(0xFF2A2A52), Color(0xFFB9B9FF)),
    TagStyle(Color(0xFF4A1F31), Color(0xFFFFB3C9)),
    TagStyle(Color(0xFF453516), Color(0xFFF5CE82)),
    TagStyle(Color(0xFF163828), Color(0xFF9BE3BC)),
    TagStyle(Color(0xFF1B3648), Color(0xFFA5D8F8)),
)

@Composable
fun tagStyleFor(tag: String): TagStyle {
    val palette = if (LocalIsDark.current) TagPaletteDark else TagPaletteLight
    return palette[abs(tag.hashCode()) % palette.size]
}

/** Small rounded "#" chip in a pastel tint derived from the tag name. */
@Composable
fun TagChip(tag: String, selected: Boolean = false, onClick: (() -> Unit)? = null) {
    val style = tagStyleFor(tag)
    val bg = if (selected) MaterialTheme.colorScheme.primary else style.bg
    val fg = if (selected) MaterialTheme.colorScheme.onPrimary else style.fg
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .clip(shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .background(bg, shape),
    ) {
        Text(
            "#$tag",
            Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            color = fg,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
        )
    }
}

/* ------------------------------------------------------------- avatars */

private val AvatarGradients = listOf(
    listOf(Color(0xFF6366F1), Color(0xFF8B5CF6)),
    listOf(Color(0xFFEC4899), Color(0xFFF472B6)),
    listOf(Color(0xFF06B6D4), Color(0xFF3B82F6)),
    listOf(Color(0xFF10B981), Color(0xFF34D399)),
    listOf(Color(0xFFF59E0B), Color(0xFFF97316)),
    listOf(Color(0xFF8B5CF6), Color(0xFFD946EF)),
)

/** Circular avatar with the initial on a per-name gradient. */
@Composable
fun InitialAvatar(name: String, modifier: Modifier = Modifier, size: Dp = 42.dp) {
    val colors = AvatarGradients[abs(name.hashCode()) % AvatarGradients.size]
    Box(
        modifier
            .size(size)
            .background(Brush.linearGradient(colors), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase(),
            color = Color.White,
            fontSize = (size.value * 0.4f).sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/* -------------------------------------------------------- shared pieces */

/** Tiny uppercase label chip (e.g. "ADMIN"). */
@Composable
fun Badge(text: String) {
    Box(
        Modifier
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}

/** Rounded tonal group container used by Settings/Admin sections. */
object AppShapes {
    val card = RoundedCornerShape(20.dp)
    val pill = RoundedCornerShape(50)
    val field = RoundedCornerShape(16.dp)
    val dialog = RoundedCornerShape(24.dp)
}
