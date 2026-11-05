package site.funshare.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Percentage parsing shared by the progress controls: empty clears (no bar
 * tracked), anything else clamps to a whole 0-100 percent — the Compose
 * counterpart of the web client's readProgressInput().
 */
fun parseProgressInput(text: String): Int? {
    val t = text.trim()
    if (t.isEmpty()) return null
    val n = t.toDoubleOrNull() ?: return null
    return n.roundToInt().coerceIn(0, 100)
}

/**
 * Press-to-set + drag-to-adjust over a progress track — the Compose
 * counterpart of the web's pointer handlers: a press jumps the fill to the
 * finger, dragging sweeps it, and release commits. Every event is
 * consumed so surrounding row/card gestures (open, long-press reorder)
 * never fire from the bar.
 */
@Composable
internal fun Modifier.progressDrag(
    onPreview: (Int) -> Unit,
    onCommit: (Int) -> Unit,
): Modifier {
    val preview by rememberUpdatedState(onPreview)
    val commit by rememberUpdatedState(onCommit)
    return this.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            var last = pctAt(down.position.x)
            preview(last)
            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                change.consume()
                if (!change.pressed) break
                val v = pctAt(change.position.x)
                if (v != last) {
                    last = v
                    preview(v)
                }
            }
            commit(last)
        }
    }
}

private fun androidx.compose.ui.input.pointer.AwaitPointerEventScope.pctAt(x: Float): Int =
    ((x / size.width) * 100f).roundToInt().coerceIn(0, 100)

/**
 * The slim progress track: a pill bar filled to [progress] percent. The
 * fill colour is passed in so each note type drives its own look (accent
 * for timeline items, the card's palette colour for gallery cards) — the
 * Compose counterpart of the web's .tl-progress-track / .g-progress-track.
 * A press jumps the fill to the finger and a drag sweeps it; [onChange]
 * commits once on release.
 */
@Composable
fun ProgressBarTrack(
    progress: Int,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    fill: Color = MaterialTheme.colorScheme.primary,
    track: Color = MaterialTheme.colorScheme.surfaceContainerHigh,
    bordered: Boolean = false,
    height: Dp = 6.dp,
    onDragActive: ((Boolean) -> Unit)? = null,
    label: String = "Item progress",
) {
    // live value while the finger is down; the committed value rules otherwise
    var dragging by remember { mutableStateOf(false) }
    var live by remember { mutableIntStateOf(progress) }
    val shown = if (dragging) live else progress
    val shape = RoundedCornerShape(percent = 50)
    Box(
        modifier
            // taller invisible touch area around the slim visual bar
            .height(height + 20.dp)
            .progressDrag(
                onPreview = {
                    dragging = true
                    live = it
                    onDragActive?.invoke(true)
                },
                onCommit = {
                    dragging = false
                    onDragActive?.invoke(false)
                    onChange(it)
                },
            )
            .padding(vertical = 10.dp)
            .clip(shape)
            .background(track)
            .then(
                if (bordered) Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
                else Modifier
            )
            .semantics {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(shown.toFloat(), 0f..100f)
            },
    ) {
        Box(
            Modifier
                .fillMaxWidth(shown / 100f)
                .fillMaxHeight()
                .clip(shape)
                .background(fill),
        )
    }
}

/**
 * A progress bar with its percentage label — the Compose counterpart of
 * the web's .tl-progress / .g-progress rows. Drag or press the track to
 * adjust; tap the "NN%" label and it swaps for a compact number field
 * (web .tl-progress-input) for exact values — empty removes the bar.
 * Renders only while a progress is tracked, like the web.
 */
@Composable
fun ProgressBarRow(
    progress: Int?,
    onChange: (Int?) -> Unit,
    modifier: Modifier = Modifier,
    fill: Color = MaterialTheme.colorScheme.primary,
    track: Color = MaterialTheme.colorScheme.surfaceContainerHigh,
    labelColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    dimmed: Boolean = false,
    onDragActive: ((Boolean) -> Unit)? = null,
    label: String = "Item progress",
) {
    if (progress == null) return
    var editing by remember { mutableStateOf(false) }
    Row(
        modifier.then(if (dimmed) Modifier.alpha(0.55f) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ProgressBarTrack(
            progress = progress,
            onChange = { onChange(it) },
            modifier = Modifier.weight(1f),
            fill = fill,
            track = track,
            onDragActive = onDragActive,
            label = label,
        )
        if (editing) {
            // exact numbers: the label swaps for a compact field, every
            // entry commits live and empty removes the bar (web parity)
            var text by remember { mutableStateOf(progress.toString()) }
            val focus = remember { FocusRequester() }
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it.filter(Char::isDigit).take(3)
                    onChange(parseProgressInput(text))
                },
                modifier = Modifier
                    .width(64.dp)
                    .focusRequester(focus),
                singleLine = true,
                textStyle = MaterialTheme.typography.labelSmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                keyboardActions = KeyboardActions(onDone = { editing = false }),
            )
            LaunchedEffect(Unit) { focus.requestFocus() }
        } else {
            Text(
                "$progress%",
                style = MaterialTheme.typography.labelSmall,
                color = labelColor,
                textAlign = TextAlign.End,
                modifier = Modifier
                    .widthIn(min = 36.dp)
                    .clickable { editing = true }
                    .padding(vertical = 6.dp),
            )
        }
    }
}
