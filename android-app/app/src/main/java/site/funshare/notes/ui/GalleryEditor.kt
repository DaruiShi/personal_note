package site.funshare.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import site.funshare.notes.AppViewModel
import site.funshare.notes.GalleryCard
import site.funshare.notes.NotesGallery

/** Card colours per palette key: (light bg, fg, dark bg, fg) pairs chosen
 *  for AA contrast, mirroring the web's style.css blocks. */
private val G_COLORS = mapOf(
    "amber" to Quadruple(0xFFFDECC8, 0xFF7A4100, 0xFF4A3812, 0xFFF5D998),
    "rose" to Quadruple(0xFFFBD5DC, 0xFF8A1F3A, 0xFF4D1A26, 0xFFF6C1CD),
    "violet" to Quadruple(0xFFE4D9FB, 0xFF55309A, 0xFF35276B, 0xFFD4C4FB),
    "indigo" to Quadruple(0xFFD9E0FB, 0xFF33419E, 0xFF27306E, 0xFFC3CDFB),
    "sky" to Quadruple(0xFFD4ECFB, 0xFF0B5A86, 0xFF123C57, 0xFFB7E0F8),
    "teal" to Quadruple(0xFFC9F0EC, 0xFF0D5F57, 0xFF0F4038, 0xFFB6ECE4),
    "emerald" to Quadruple(0xFFCDF3DD, 0xFF0D5F3A, 0xFF12402A, 0xFFB7ECD0),
    "lime" to Quadruple(0xFFE3F4C4, 0xFF4A5C0A, 0xFF37430F, 0xFFDCF2A8),
    "orange" to Quadruple(0xFFFDE0C8, 0xFF8A4300, 0xFF53300D, 0xFFF8D3A8),
    "fuchsia" to Quadruple(0xFFF7D4F6, 0xFF82177C, 0xFF551452, 0xFFF2C4F0),
    "slate" to Quadruple(0xFFE2E5EC, 0xFF333A4C, 0xFF2A3040, 0xFFC9D1E2),
    "sand" to Quadruple(0xFFEFE6D4, 0xFF6B5A37, 0xFF453A24, 0xFFECDCB8),
)

private data class Quadruple(val a: Long, val b: Long, val c: Long, val d: Long)

@Composable
private fun gPair(key: String): Pair<Color, Color> {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val q = G_COLORS[key] ?: G_COLORS["slate"]!!
    return if (dark) Color(q.c) to Color(q.d) else Color(q.a) to Color(q.b)
}

/**
 * The gallery editor: a responsive grid of colour cards opening into a
 * detail view (title, content, tags, 12 colour swatches, move buttons).
 * Add asks the server for a title/tags when they are empty and the server
 * has an LLM configured; on failure the local title heuristic is used and
 * the card is still added.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GalleryEditor(vm: AppViewModel, modifier: Modifier = Modifier) {
    val cards = vm.editGallery
    var openId by remember(vm.editingKey) { mutableStateOf<String?>(null) } // null = grid, "new" = creating

    if (openId == null) {
        Column(modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Button(onClick = { openId = "new" }) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Spacer(Modifier.size(4.dp))
                    Text("New card")
                }
                val sum = NotesGallery.summary(cards)
                Text(
                    if (sum.total > 0) "${sum.total} cards · ${sum.colors} colours" else "",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (cards.isEmpty()) {
                Text(
                    "No cards yet — press “New card” to add one.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 160.dp),
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(cards, key = { it.id }) { card ->
                        GalleryCardView(card = card, onClick = { openId = card.id })
                    }
                }
            }
        }
    } else {
        GalleryCardDetail(
            vm = vm,
            creating = openId == "new",
            card = cards.firstOrNull { it.id == openId },
            onDone = { openId = null },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryCardView(card: GalleryCard, onClick: () -> Unit) {
    val (bg, fg) = gPair(card.color)
    Surface(
        color = bg,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier
            .heightIn(min = 120.dp)
            .combinedClickable(onClick = onClick)
            .semantics { contentDescription = "Card ${card.title}" },
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(
                card.title.ifBlank { "Untitled card" },
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                color = fg,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                NotesGallery.previewText(card.content),
                style = MaterialTheme.typography.bodySmall,
                color = fg.copy(alpha = 0.85f),
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            if (card.tags.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    card.tags.forEach { tag ->
                        Text(
                            tag,
                            style = MaterialTheme.typography.labelSmall,
                            color = fg,
                            modifier = Modifier
                                .background(fg.copy(alpha = 0.12f), CircleShape)
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryCardDetail(
    vm: AppViewModel,
    creating: Boolean,
    card: GalleryCard?,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var title by remember(card?.id ?: "new") { mutableStateOf(card?.title ?: "") }
    var content by remember(card?.id ?: "new") { mutableStateOf(card?.content ?: "") }
    var tags by remember(card?.id ?: "new") { mutableStateOf(card?.tags ?: emptyList()) }
    var color by remember(card?.id ?: "new") {
        mutableStateOf(card?.color ?: NotesGallery.PALETTE[0])
    }
    var tagInput by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf(false) }

    /** Editing an existing card: push one field into the VM (no-op while
     *  creating — the Add button commits the whole card at once). */
    fun pushIfEditing(key: String, value: Any?) {
        val c = card ?: return
        if (!creating) vm.gUpdate(c.id, mapOf(key to value))
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onDone) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to grid")
            }
            Text(
                if (creating) "New card" else "Card",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            if (!creating && card != null) {
                IconButton(onClick = { deleteConfirm = true }) {
                    Icon(
                        Icons.Filled.Delete,
                        contentDescription = "Delete card",
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        OutlinedTextField(
            value = title,
            onValueChange = { title = it; pushIfEditing("title", it.trim()) },
            label = { Text("Title (empty = AI or first words)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = content,
            onValueChange = { content = it; pushIfEditing("content", it) },
            label = { Text("Content") },
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            minLines = 4,
            maxLines = 12,
        )

        /* tags */
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            tags.forEach { tag ->
                InputChip(
                    selected = false,
                    onClick = {
                        tags = tags.filterNot { it == tag }
                        pushIfEditing("tags", tags)
                    },
                    label = { Text("$tag ×") },
                )
            }
        }
        OutlinedTextField(
            value = tagInput,
            onValueChange = { tagInput = it },
            label = { Text("Add tag (empty = AI)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = {
                if (tagInput.isNotBlank()) {
                    tags = NotesGallery.normalizeTags(tags + tagInput.split(',', '，'))
                    tagInput = ""
                    pushIfEditing("tags", tags)
                }
            }),
        )

        /* colour swatches */
        Text(
            "Colour",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.horizontalScroll(rememberScrollState()),
        ) {
            NotesGallery.PALETTE.forEach { key ->
                val (bg, fg) = gPair(key)
                val active = key == color
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .background(bg, CircleShape)
                        .then(
                            if (active) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape)
                            else Modifier
                        )
                        .combinedClickable(onClick = {
                            color = key
                            pushIfEditing("color", key)
                        })
                        .semantics { contentDescription = "Colour $key" },
                    contentAlignment = Alignment.Center,
                ) {
                    if (active) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = null,
                            tint = fg,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        if (creating) {
            Button(
                onClick = {
                    if (content.isBlank()) {
                        vm.postMessage("Card content is empty")
                        return@Button
                    }
                    scope.launch {
                        busy = true
                        val needTitle = title.isBlank()
                        val needTags = tags.isEmpty()
                        var suggestedTitle: String? = null
                        var suggestedTags: List<String>? = null
                        if (needTitle || needTags) {
                            val (t, g, notice) = vm.suggestForCard(content.trim(), needTitle, needTags)
                            suggestedTitle = t
                            suggestedTags = g
                            notice?.let { vm.postMessage(it) }
                        }
                        val finalTitle = title.trim().ifBlank {
                            suggestedTitle ?: NotesGallery.fallbackTitle(content)
                        }
                        val finalTags = tags.ifEmpty { suggestedTags ?: emptyList() }
                        vm.gAdd(
                            NotesGallery.newCard(
                                title = finalTitle,
                                content = content,
                                tags = finalTags,
                                color = color,
                            ),
                        )
                        busy = false
                        onDone()
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.size(8.dp))
                    Text("Adding…")
                } else {
                    Text("Add")
                }
            }
        } else if (card != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 24.dp),
            ) {
                TextButton(onClick = { vm.gMove(card.id, -1) }) { Text("Move earlier") }
                TextButton(onClick = { vm.gMove(card.id, 1) }) { Text("Move later") }
                TextButton(onClick = onDone) { Text("Done") }
            }
        }
    }

    if (deleteConfirm && card != null) {
        AlertDialog(
            onDismissRequest = { deleteConfirm = false },
            title = { Text("Delete this card?") },
            text = { Text("“${card.title.ifBlank { "Untitled card" }}” will be removed from the gallery.") },
            confirmButton = {
                TextButton(onClick = {
                    vm.gDelete(card.id)
                    deleteConfirm = false
                    onDone()
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { deleteConfirm = false }) { Text("Cancel") }
            },
        )
    }
}
