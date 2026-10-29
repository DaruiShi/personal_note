package site.funshare.notes.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.funshare.notes.ThemeMode

/* Curated brand schemes (indigo/violet) — consistent across devices. */

private val LightScheme = lightColorScheme(
    primary = Color(0xFF4F46E5),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE1E0FF),
    onPrimaryContainer = Color(0xFF1B1A67),
    secondary = Color(0xFF7A5AF8),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE9E1FF),
    onSecondaryContainer = Color(0xFF26105E),
    tertiary = Color(0xFFD6336C),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFE0EC),
    onTertiaryContainer = Color(0xFF5C0E37),
    background = Color(0xFFFBFBFE),
    onBackground = Color(0xFF1A1A24),
    surface = Color(0xFFFBFBFE),
    onSurface = Color(0xFF1A1A24),
    surfaceVariant = Color(0xFFEFEFF6),
    onSurfaceVariant = Color(0xFF57576B),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF6F6FA),
    surfaceContainer = Color(0xFFF1F1F7),
    surfaceContainerHigh = Color(0xFFEBEBF2),
    surfaceContainerHighest = Color(0xFFE5E5ED),
    outline = Color(0xFF79798C),
    outlineVariant = Color(0xFFE4E4EC),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFBFC2FF),
    onPrimary = Color(0xFF23248A),
    primaryContainer = Color(0xFF3B3EA8),
    onPrimaryContainer = Color(0xFFE1E0FF),
    secondary = Color(0xFFCBB9FF),
    onSecondary = Color(0xFF311C6E),
    secondaryContainer = Color(0xFF493486),
    onSecondaryContainer = Color(0xFFE9E1FF),
    tertiary = Color(0xFFFFB1C8),
    onTertiary = Color(0xFF5C0E37),
    tertiaryContainer = Color(0xFF7C2348),
    onTertiaryContainer = Color(0xFFFFD9E4),
    background = Color(0xFF0E0E13),
    onBackground = Color(0xFFE5E3EE),
    surface = Color(0xFF0E0E13),
    onSurface = Color(0xFFE5E3EE),
    surfaceVariant = Color(0xFF27272F),
    onSurfaceVariant = Color(0xFFC7C6D5),
    surfaceContainerLowest = Color(0xFF09090D),
    surfaceContainerLow = Color(0xFF17171E),
    surfaceContainer = Color(0xFF1B1B23),
    surfaceContainerHigh = Color(0xFF26262E),
    surfaceContainerHighest = Color(0xFF31313B),
    outline = Color(0xFF9191A2),
    outlineVariant = Color(0xFF46464F),
)

private val AppTypography = Typography(
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.25).sp,
    ),
    headlineSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.25).sp,
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.25).sp,
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
    ),
    titleSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
    labelSmall = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.3.sp,
    ),
)

private val MaterialShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun FunshareTheme(themeMode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val scheme = if (dark) DarkScheme else LightScheme
    CompositionLocalProvider(LocalIsDark provides dark) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AppTypography,
            shapes = MaterialShapes,
            content = content,
        )
    }
}
