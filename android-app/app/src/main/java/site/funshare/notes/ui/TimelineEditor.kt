package site.funshare.notes.ui

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.launch
import site.funshare.notes.AppViewModel
import site.funshare.notes.NotesLinks
import site.funshare.notes.NotesTimeline
import site.funshare.notes.TimelineItem

/** Which date the item page composes for; itemId null = a new item. */
private data class ItemPageTarget(val date: String, val itemId: String?)

/**
 * The timeline editor: a horizontal pager of date pages (items + today +
 * visited dates), a day bar for stepping/jumping, per-item checkboxes and
 * actions, and the paste & parse dialog. The "Add item" button on each
 * date page (and an item's Edit menu) open [TimelineItemPage], a dedicated
 * full page for the content and time range. Mutations go through
 * AppViewModel's tl* functions, which autosave like every edit.
 */
@Composable
fun TimelineEditor(vm: AppViewModel, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val today = remember(vm.editingKey) { NotesLinks.localDateKey(java.util.Date()) }
    var visited by remember(vm.editingKey) { mutableStateOf(setOf<String>()) }
    var parseOpen by remember { mutableStateOf(false) }
    var itemPageFor by remember(vm.editingKey) { mutableStateOf<ItemPageTarget?>(null) }

    // The item page replaces the pager entirely; pagerState lives here, so
    // returning from it restores the exact date page the user left.
    itemPageFor?.let { target ->
        TimelineItemPage(
            vm = vm,
            date = target.date,
            itemId = target.itemId,
            onClose = { itemPageFor = null },
        )
        return
    }

    fun datesWith(extra: Set<String>): List<String> =
        NotesTimeline.pageDates(vm.editTimeline, today, extra)

    val dates = datesWith(visited)
    val pagerState = rememberPagerState(
        initialPage = dates.indexOf(today).takeIf { it >= 0 } ?: 0,
        pageCount = { datesWith(visited).size },
    )

    fun jumpTo(date: String) {
        if (!NotesLinks.isDateTitle(date)) return
        scope.launch {
            visited = visited + date
            val target = datesWith(visited + date).indexOf(date)
            if (target >= 0) pagerState.animateScrollToPage(target)
        }
    }

    Column(modifier.fillMaxSize()) {
        /* title — the same flat, borderless field as the markdown editor */
        androidx.compose.foundation.text.BasicTextField(
            value = vm.editTitle,
            onValueChange = {
                vm.editTitle = it
                vm.onEditorChanged()
            },
            singleLine = true,
            textStyle = MaterialTheme.typography.headlineSmall.copy(
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { inner ->
                if (vm.editTitle.isEmpty()) {
                    Text(
                        "Title",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                }
                inner()
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 6.dp),
        )

        /* day bar */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = {
                val cur = dates.getOrNull(pagerState.currentPage) ?: today
                jumpTo(NotesLinks.addDays(cur, -1) ?: today)
            }) { Icon(Icons.Filled.KeyboardArrowLeft, contentDescription = "Previous day") }
            Text(
                NotesLinks.formatDayLabel(dates.getOrNull(pagerState.currentPage) ?: today),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            IconButton(onClick = {
                val cur = dates.getOrNull(pagerState.currentPage) ?: today
                jumpTo(NotesLinks.addDays(cur, 1) ?: today)
            }) { Icon(Icons.Filled.KeyboardArrowRight, contentDescription = "Next day") }
            TextButton(onClick = { jumpTo(today) }) { Text("Today") }
            TextButton(onClick = { parseOpen = true }) {
                Text(if (vm.timelineParseEnabled) "Parse" else "Parse (basic)")
            }
        }

        HorizontalPager(state = pagerState, modifier = Modifier.weight(1f)) { page ->
            val date = dates.getOrNull(page) ?: return@HorizontalPager
            TimelineDatePage(
                vm = vm,
                date = date,
                today = today,
                onAddItem = { itemPageFor = ItemPageTarget(date, null) },
                onEditItem = { itemPageFor = ItemPageTarget(it.date, it.id) },
            )
        }
    }

    if (parseOpen) {
        TimelineParseDialog(
            vm = vm,
            onClose = { parseOpen = false },
        )
    }
}

/* ------------------------------------------------------------ one date page */

@Composable
private fun TimelineDatePage(
    vm: AppViewModel,
    date: String,
    today: String,
    onAddItem: () -> Unit,
    onEditItem: (TimelineItem) -> Unit,
) {
    // canonical display order: order (drag) -> start time -> createdAt
    val dayItems = remember(vm.editTimeline, date) {
        NotesTimeline.sortItems(vm.editTimeline.filter { it.date == date })
    }
    val doneCount = dayItems.count { it.done }

    // long-press drag reorder state: which item is in the air and how far
    var dragId by remember { mutableStateOf<String?>(null) }
    var dragOffset by remember { mutableFloatStateOf(0f) }

    fun dropDrag() {
        val id = dragId ?: return
        // rows are ~64dp tall (compact single/two-line cards); land by offset
        val shift = (dragOffset / 64f).toInt().coerceIn(-dayItems.size, dayItems.size)
        val from = dayItems.indexOfFirst { it.id == id }
        if (from >= 0 && shift != 0) {
            val to = (from + shift).coerceIn(0, dayItems.size - 1)
            // dropping "before" the item currently at `to`
            val beforeId = dayItems.getOrNull(to + (if (shift > 0) 1 else 0))?.id
            vm.tlReorder(id, if (to == dayItems.size - 1) null else beforeId)
        }
        dragId = null
        dragOffset = 0f
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                NotesLinks.formatDayLabel(date),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                if (doneCount > 0) "${dayItems.size} items · $doneCount done"
                else "${dayItems.size} item${if (dayItems.size == 1) "" else "s"}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            if (dayItems.isEmpty()) {
                Text(
                    if (date == today && vm.editTimeline.isEmpty())
                        "No items yet — add one below, or use Parse."
                    else
                        "Nothing on this day.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }
            dayItems.forEach { item ->
                val dragging = item.id == dragId
                Box(
                    Modifier
                        .zIndex(if (dragging) 1f else 0f)
                        .graphicsLayer { translationY = if (dragging) dragOffset else 0f }
                        .pointerInput(item.id) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { dragId = item.id; dragOffset = 0f },
                                onDrag = { change, amount ->
                                    change.consume()
                                    dragOffset += amount.y
                                },
                                onDragEnd = { dropDrag() },
                                onDragCancel = { dragId = null; dragOffset = 0f },
                            )
                        },
                ) {
                    TimelineItemRow(vm, item, onEdit = { onEditItem(item) })
                }
            }

            /* the one manual-add affordance per date page */
            Surface(
                onClick = onAddItem,
                shape = AppShapes.card,
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 12.dp),
            ) {
                Row(
                    Modifier.padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        "Add item",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

/**
 * Plain text with live citations: [[Target]] spans render in the accent
 * colour and open the target note on tap — the Compose counterpart of the
 * web's citeify(). Unresolvable targets stay plain struck-through text
 * (the create-note flow needs the editor, so we do not offer it here).
 */
@Composable
private fun CiteText(
    text: String,
    done: Boolean,
    vm: AppViewModel,
    modifier: Modifier = Modifier,
) {
    val base = if (done) MaterialTheme.colorScheme.onSurfaceVariant
    else MaterialTheme.colorScheme.onSurface
    val accent = MaterialTheme.colorScheme.primary
    val annotated = remember(text, vm.linkIndex, vm.notes) {
        buildAnnotatedString {
            for (part in NotesLinks.citeifiedParts(
                text,
                resolve = { vm.resolveWikilink(it) },
                resolveDisplay = { t -> NotesLinks.resolveCitation(vm.linkIndex, vm.notes, t)?.title },
            )) {
                if (part.citationId == null) {
                    withStyle(
                        SpanStyle(
                            color = base,
                            textDecoration = if (done) TextDecoration.LineThrough else null,
                        ),
                    ) { append(part.text) }
                } else {
                    val deco = if (done) {
                        TextDecoration.combine(listOf(TextDecoration.LineThrough, TextDecoration.Underline))
                    } else TextDecoration.Underline
                    withStyle(SpanStyle(color = accent, textDecoration = deco)) {
                        pushStringAnnotation("citation", part.target)
                        append(part.text)
                        pop()
                    }
                }
            }
        }
    }
    ClickableText(
        text = annotated,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier,
        onClick = { offset ->
            annotated.getStringAnnotations("citation", offset, offset)
                .firstOrNull()
                ?.let { vm.openWikilink(it.item) {} }
        },
    )
}

/**
 * Compact HH:MM field — placeholder instead of a floating label so the row
 * stays one line tall; 88dp fits exactly 5 characters.
 */
@Composable
private fun TimeField(value: String, onValueChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.take(5)) },
        placeholder = { Text(label, style = MaterialTheme.typography.labelMedium) },
        modifier = Modifier.width(88.dp),
        singleLine = true,
        shape = AppShapes.field,
        textStyle = MaterialTheme.typography.labelMedium,
    )
}

/**
 * Morning / Noon / Afternoon / Evening quick picks. Tapping the active
 * preset clears both fields (toggle off). The active chip highlights when
 * the fields exactly match its range.
 */
@Composable
private fun TimePresetRow(start: String, end: String, onPick: (String?, String?) -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (p in NotesTimeline.TIME_PRESETS) {
            val active = start == p.start && end == p.end
            Surface(
                onClick = { if (active) onPick(null, null) else onPick(p.start, p.end) },
                shape = MaterialTheme.shapes.large,
                color = if (active) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (active) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.outlineVariant,
                ),
            ) {
                Text(
                    p.label,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (active) MaterialTheme.colorScheme.onPrimaryContainer
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/* --------------------------------------------------------------- one item */

@Composable
private fun TimelineItemRow(vm: AppViewModel, item: TimelineItem, onEdit: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    var moveOpen by remember { mutableStateOf(false) }

    // Same tonal borderless card language as the notes list — an outlined
    // surface here reads as a text-input box, which confused the page.
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = AppShapes.card,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            Modifier.padding(start = 4.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = item.done,
                onCheckedChange = { vm.tlToggleDone(item.id) },
            )
            if (item.timeLabel.isNotEmpty()) {
                Surface(
                    shape = AppShapes.pill,
                    color = if (item.done) MaterialTheme.colorScheme.surfaceContainerHigh
                    else MaterialTheme.colorScheme.secondaryContainer,
                ) {
                    Text(
                        item.timeLabel,
                        Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Spacer(Modifier.size(8.dp))
            }
            CiteText(
                text = item.text,
                done = item.done,
                vm = vm,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 6.dp),
            )
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(
                        Icons.Filled.MoreVert,
                        contentDescription = "Item actions",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                        onClick = { menuOpen = false; onEdit() },
                    )
                    DropdownMenuItem(
                        text = { Text("Move to date") },
                        leadingIcon = { Icon(Icons.Filled.CalendarToday, contentDescription = null) },
                        onClick = { menuOpen = false; moveOpen = true },
                    )
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                        onClick = { menuOpen = false; vm.tlDelete(item.id) },
                    )
                }
            }
        }
    }

    if (moveOpen) {
        var date by remember { mutableStateOf(item.date) }
        AlertDialog(
            onDismissRequest = { moveOpen = false },
            title = { Text("Move to date") },
            text = {
                OutlinedTextField(
                    value = date,
                    onValueChange = { date = it },
                    label = { Text("YYYY-MM-DD") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (NotesLinks.isDateTitle(date)) vm.tlMove(item.id, date.trim())
                        moveOpen = false
                    },
                ) { Text("Move") }
            },
            dismissButton = {
                TextButton(onClick = { moveOpen = false }) { Text("Cancel") }
            },
        )
    }
}

/* ------------------------------------------------------ item add/edit page */

/**
 * A full page for composing one timeline item: content and time range.
 * Opened by a date page's "Add item" button (itemId = null) or an item's
 * Edit menu. Saving goes through tlAdd / tlUpdateItem, which autosave the
 * note like every edit; the system back button closes without saving.
 */
@Composable
private fun TimelineItemPage(
    vm: AppViewModel,
    date: String,
    itemId: String?,
    onClose: () -> Unit,
) {
    val existing = itemId?.let { id -> vm.editTimeline.firstOrNull { it.id == id } }
    var text by remember(itemId, date) { mutableStateOf(existing?.text ?: "") }
    var start by remember(itemId, date) { mutableStateOf(existing?.start ?: "") }
    var end by remember(itemId, date) { mutableStateOf(existing?.end ?: "") }

    androidx.activity.compose.BackHandler(onBack = onClose)

    fun save() {
        if (text.isBlank()) return
        if (existing != null) {
            vm.tlUpdateItem(existing.id, text, start.ifBlank { null }, end.ifBlank { null })
        } else {
            vm.tlAdd(date, text, start.ifBlank { null }, end.ifBlank { null })
        }
        onClose()
    }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        /* page header */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to timeline",
                )
            }
            Column {
                Text(
                    if (existing != null) "Edit item" else "Add item",
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    NotesLinks.formatDayLabel(date),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            /* content — flat, borderless, like the note editors */
            androidx.compose.foundation.text.BasicTextField(
                value = text,
                onValueChange = { text = it },
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                decorationBox = { inner ->
                    if (text.isEmpty()) {
                        Text(
                            "What's the plan?",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                        )
                    }
                    inner()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 14.dp),
            )

            /* time range */
            Text(
                "Time range",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.size(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TimeField(start, { start = it }, "from")
                Text(
                    "–",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TimeField(end, { end = it }, "to")
            }
            Spacer(Modifier.size(12.dp))
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                TimePresetRow(start, end) { s, e -> start = s.orEmpty(); end = e.orEmpty() }
            }
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.height(16.dp))
        }

        /* save */
        androidx.compose.material3.Button(
            onClick = { save() },
            enabled = text.isNotBlank(),
            shape = AppShapes.pill,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            Text(if (existing != null) "Save changes" else "Add to ${NotesLinks.formatDayLabel(date)}")
        }
    }
}

/* ---------------------------------------------------------- parse dialog */

@Composable
private fun TimelineParseDialog(vm: AppViewModel, onClose: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<NotesTimeline.Parsed>?>(null) }
    // per-row editable state, reset whenever new results arrive
    var checks by remember { mutableStateOf(listOf<Boolean>()) }
    var rowDates by remember { mutableStateOf(listOf<String>()) }
    val scope = rememberCoroutineScope()

    fun runParse() {
        if (text.isBlank()) {
            notice = "Paste some text first."
            return
        }
        busy = true
        notice = "Parsing…"
        scope.launch {
            val (items, msg) = vm.parsePaste(text)
            busy = false
            results = items
            checks = items.map { true }
            rowDates = items.map { it.date }
            notice = msg
        }
    }

    fun confirm() {
        val current = results ?: return
        val selected = current.mapIndexedNotNull { i, p ->
            if (checks.getOrNull(i) == true && NotesLinks.isDateTitle(rowDates.getOrNull(i) ?: p.date)) {
                NotesTimeline.Parsed(rowDates[i], p.text, p.guessed)
            } else null
        }
        if (selected.isNotEmpty()) {
            vm.tlMergeParsed(selected)
            vm.postMessage("Added ${selected.size} item${if (selected.size == 1) "" else "s"}")
        }
        onClose()
    }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Paste & parse") },
        text = {
            Column {
                Text(
                    "Your text is sent to the server's AI parser to extract dates. " +
                        "Nothing else from this note is sent.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text("Paste notes here — one thought per line…") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 8,
                    enabled = results == null, // keep the pasted text while reviewing
                )
                notice?.let {
                    Spacer(Modifier.size(8.dp))
                    Text(
                        it,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                results?.let { rs ->
                    Spacer(Modifier.size(8.dp))
                    LazyColumn(Modifier.fillMaxWidth().heightIn(240.dp)) {
                        items(rs.size) { i ->
                            val p = rs[i]
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Checkbox(
                                    checked = checks.getOrNull(i) == true,
                                    onCheckedChange = { checks = checks.toMutableList().also { l -> l[i] = it } },
                                )
                                OutlinedTextField(
                                    value = rowDates.getOrNull(i) ?: p.date,
                                    onValueChange = { d -> rowDates = rowDates.toMutableList().also { l -> l[i] = d } },
                                    modifier = Modifier.width(132.dp),
                                    singleLine = true,
                                    textStyle = MaterialTheme.typography.labelMedium,
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(p.text, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                    val timeLbl = p.start?.let { s -> s + (p.end?.let { e -> "–$e" } ?: "") } ?: ""
                                    val bits = listOfNotNull(
                                        timeLbl.ifEmpty { null },
                                        if (p.guessed) "date guessed" else null,
                                    ).joinToString(" · ")
                                    if (bits.isNotEmpty()) {
                                        Text(
                                            bits,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.tertiary,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (results == null) {
                TextButton(onClick = { runParse() }, enabled = !busy) {
                    Text(if (vm.timelineParseEnabled) "Parse" else "Parse (basic)")
                }
            } else {
                val n = checks.count { it }
                TextButton(onClick = { confirm() }, enabled = n > 0) {
                    Text("Add $n item${if (n == 1) "" else "s"}")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onClose) { Text("Close") }
        },
    )
}
