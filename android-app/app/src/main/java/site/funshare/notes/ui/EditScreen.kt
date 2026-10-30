package site.funshare.notes.ui

import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.text.Spannable
import android.widget.TextView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListBulleted
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.HorizontalRule
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Title
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material3.CircularProgressIndicator
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.ext.tasklist.TaskListSpan
import io.noties.markwon.image.ImagesPlugin
import io.noties.markwon.image.network.OkHttpNetworkSchemeHandler
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import site.funshare.notes.Api
import site.funshare.notes.AppViewModel
import site.funshare.notes.EditStatus
import site.funshare.notes.NotesLinks

private var cachedMarkwon: Markwon? = null
private var markwonKey: List<Any>? = null

/** Draws text at ~55% of the body color — the "missing link" treatment. */
private class MutedTextSpan(private val baseColor: Int) : android.text.style.CharacterStyle() {
    override fun updateDrawState(tp: android.text.TextPaint) {
        tp.color = (baseColor and 0x00FFFFFF) or (0x8C shl 24)
    }
}

/** Markwon with tables, task lists, images, LaTeX math and server-aware links. */
internal fun markwon(
    context: Context,
    client: OkHttpClient,
    serverBase: String,
    publicBase: String,
    latexTextSizePx: Float,
    latexColor: Int,
): Markwon {
    val key = listOf(client, serverBase, publicBase, latexTextSizePx, latexColor)
    if (cachedMarkwon == null || markwonKey != key) {
        markwonKey = key
        cachedMarkwon = Markwon.builder(context.applicationContext)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(TaskListPlugin.create(context))
            .usePlugin(
                ImagesPlugin.create { plugin ->
                    plugin.removeSchemeHandler("http")
                    plugin.removeSchemeHandler("https")
                    plugin.addSchemeHandler(OkHttpNetworkSchemeHandler.create(client))
                    plugin.addSchemeHandler(LatexImageHandler(latexTextSizePx, latexColor))
                },
            )
            .usePlugin(object : io.noties.markwon.AbstractMarkwonPlugin() {
                override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                    builder.linkResolver { view, link ->
                        openPreviewLink(view, link, client, serverBase, publicBase)
                    }
                }

                override fun afterSetText(textView: android.widget.TextView) {
                    // Missing wikilinks render in a muted tone (the dashed
                    // underline of the web client is not expressible in a
                    // text paint). Recolor by URL scheme after the render.
                    val text = textView.text as? android.text.Spannable ?: return
                    val spans = text.getSpans(
                        0, text.length,
                        io.noties.markwon.core.spans.LinkSpan::class.java,
                    )
                    for (span in spans) {
                        if (!span.url.startsWith(NotesLinks.WIKILINK_MISSING_SCHEME)) continue
                        val start = text.getSpanStart(span)
                        val end = text.getSpanEnd(span)
                        if (start < 0 || end <= start) continue
                        val base = textView.currentTextColor
                        text.setSpan(
                            MutedTextSpan(base),
                            start, end,
                            android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                        )
                    }
                }
            })
            .build()
    }
    return cachedMarkwon!!
}

/* ------------------------------------------------ markdown edit helpers */

private fun wrapSelection(tfv: TextFieldValue, mark: String): TextFieldValue {
    val text = tfv.text
    val a = tfv.selection.min
    val b = tfv.selection.max
    val inner = text.substring(a, b)
    // toggle off when the selection is already wrapped
    if (inner.length >= 2 * mark.length && inner.startsWith(mark) && inner.endsWith(mark)) {
        val stripped = inner.substring(mark.length, inner.length - mark.length)
        val newText = text.substring(0, a) + stripped + text.substring(b)
        return TextFieldValue(newText, TextRange(a, a + stripped.length))
    }
    val wrapped = mark + inner + mark
    val newText = text.substring(0, a) + wrapped + text.substring(b)
    val start = a + mark.length
    return TextFieldValue(newText, TextRange(start, start + inner.length))
}

private fun toggleLinePrefix(tfv: TextFieldValue, prefix: String): TextFieldValue {
    val text = tfv.text
    val a = tfv.selection.min
    val b = tfv.selection.max
    var ls = a
    while (ls > 0 && text[ls - 1] != '\n') ls--
    var le = b
    while (le < text.length && text[le] != '\n') le++
    val block = text.substring(ls, le)
    val lines = block.split("\n")
    val all = lines.all { it.startsWith(prefix) }
    val newBlock = if (all) {
        lines.joinToString("\n") { it.removePrefix(prefix) }
    } else {
        lines.joinToString("\n") { prefix + it }
    }
    val newText = text.substring(0, ls) + newBlock + text.substring(le)
    return TextFieldValue(newText, TextRange(ls, ls + newBlock.length))
}

private fun insertAtCursor(tfv: TextFieldValue, snippet: String): TextFieldValue {
    val a = tfv.selection.min
    val newText = tfv.text.substring(0, a) + snippet + tfv.text.substring(a)
    return TextFieldValue(newText, TextRange(a + snippet.length))
}

/** Insert a block (image markdown) on its own line at the cursor. */
private fun insertBlock(tfv: TextFieldValue, snippet: String): TextFieldValue {
    val a = tfv.selection.min
    val before = tfv.text.substring(0, a)
    val after = tfv.text.substring(a)
    val pre = if (before.isEmpty() || before.endsWith("\n")) "" else "\n"
    val post = if (after.isEmpty() || after.startsWith("\n")) "" else "\n"
    val inserted = pre + snippet + post
    return TextFieldValue(
        before + inserted + after,
        TextRange(before.length + inserted.length),
    )
}

/* ------------------------------------------------------------- screen */

/** MIME types offered by the document picker (server sniffs the real type). */
private val DOCUMENT_MIMES = arrayOf(
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.spreadsheet",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/zip",
    "application/rtf",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditScreen(vm: AppViewModel) {
    val noteKey = vm.editingKey
    // Tapping a note opens it in preview; "New" opens the editor directly.
    var preview by remember(noteKey) { mutableStateOf(vm.editStartInPreview) }
    var addTagOpen by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf(false) }
    var content by remember(noteKey) { mutableStateOf(TextFieldValue(vm.editContent)) }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val httpClient = vm.okHttpClient()
    val serverBase = vm.serverBase
    var uploading by remember { mutableStateOf<String?>(null) }
    var clipImage by remember { mutableStateOf<Uri?>(null) }
    var shareBusy by remember { mutableStateOf(false) }
    var shareUrl by remember { mutableStateOf<String?>(null) }
    var moveOpen by remember { mutableStateOf(false) }
    var wikilinkCreate by remember { mutableStateOf<String?>(null) }

    /* Preview wikilink taps arrive through the global Markwon link resolver
       (the renderer is cached app-wide, so the handler is a settable hook). */
    val openLinkTarget by androidx.compose.runtime.rememberUpdatedState { target: String ->
        vm.openWikilink(target) { wikilinkCreate = target }
    }
    DisposableEffect(Unit) {
        previewWikilinkHandler = { target, _ -> openLinkTarget(target) }
        onDispose { previewWikilinkHandler = null }
    }

    /* clipboard: offer to insert a copied image */
    val clipboard = remember { context.getSystemService(ClipboardManager::class.java) }
    fun refreshClipImage() {
        try {
            val clip = clipboard?.primaryClip
            if (clip == null || clip.itemCount == 0) {
                clipImage = null
                return
            }
            val desc = clip.description
            val isImage = (0 until desc.mimeTypeCount).any { desc.getMimeType(it).startsWith("image/") }
            val uri = clip.getItemAt(0).uri
            clipImage = if (isImage && uri != null) uri else null
        } catch (e: Exception) {
            clipImage = null
        }
    }
    DisposableEffect(Unit) {
        val listener = ClipboardManager.OnPrimaryClipChangedListener { refreshClipImage() }
        clipboard?.addPrimaryClipChangedListener(listener)
        refreshClipImage()
        onDispose { clipboard?.removePrimaryClipChangedListener(listener) }
    }

    /* image insertion: pick or paste → compress → upload → markdown */
    fun insertImageMarkdown(snippet: String) {
        content = insertBlock(content, snippet)
        vm.editContent = content.text
        vm.onEditorChanged()
    }
    suspend fun insertFromUri(uri: Uri) {
        uploading = "Reading image…"
        val prepared = prepareImageForUpload(context, uri)
        if (prepared == null) {
            uploading = null
            vm.postMessage("Couldn't read that image")
            return
        }
        uploading = "Uploading image…"
        try {
            val url = vm.api.uploadFile(prepared.bytes, prepared.mime, prepared.name)
            insertImageMarkdown("![${prepared.alt}]($url)")
        } catch (e: Exception) {
            vm.postMessage("Image upload failed — ${Api.describeError(e)}")
        } finally {
            uploading = null
        }
    }
    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) scope.launch { insertFromUri(uri) }
    }

    /* document attachment: pick → upload raw bytes → markdown link */
    val pickDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) scope.launch {
            uploading = "Reading document…"
            val doc = readDocumentForUpload(context, uri)
            if (doc == null) {
                uploading = null
                vm.postMessage("Couldn't read that file (limit ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)")
                return@launch
            }
            val (bytes, name) = doc
            uploading = "Uploading $name…"
            try {
                val url = vm.api.uploadFile(
                    bytes,
                    context.contentResolver.getType(uri) ?: "",
                    name,
                )
                insertImageMarkdown("[$name]($url)")
            } catch (e: Exception) {
                vm.postMessage("Upload failed — ${Api.describeError(e)}")
            } finally {
                uploading = null
            }
        }
    }

    BackHandler {
        vm.closeEditor()
        vm.back()
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(onClick = { vm.closeEditor(); vm.back() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (!vm.editIsTimeline) {
                        IconButton(onClick = { preview = !preview }) {
                            Icon(
                                if (preview) Icons.Filled.Edit else Icons.AutoMirrored.Filled.MenuBook,
                                contentDescription = if (preview) "Edit" else "Preview",
                            )
                        }
                    }
                    IconButton(onClick = {
                        if (shareBusy) return@IconButton
                        shareBusy = true
                        vm.shareCurrentNote { url, err ->
                            shareBusy = false
                            if (url != null) shareUrl = url
                            else vm.postMessage(err ?: "Couldn't create share link")
                        }
                    }) {
                        Icon(
                            Icons.Filled.Share,
                            contentDescription = "Share note",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = {
                        vm.editPinned = !vm.editPinned
                        vm.onEditorChanged()
                    }) {
                        Icon(
                            if (vm.editPinned) Icons.Filled.PushPin else Icons.Outlined.PushPin,
                            contentDescription = "Pin note",
                            tint = if (vm.editPinned) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { moveOpen = true }) {
                        Icon(
                            Icons.Filled.Folder,
                            contentDescription = "Move to folder",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { deleteConfirm = true }) {
                        Icon(
                            Icons.Filled.Delete,
                            contentDescription = "Delete note",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
        ) {
            // Day bar for daily notes — driven purely by the current title,
            // so renaming to/from a date shows or hides it immediately.
            val dayKey = remember(vm.editTitle) {
                if (NotesLinks.isDateTitle(vm.editTitle)) {
                    NotesLinks.parseDateKey(vm.editTitle.trim())?.let { NotesLinks.localDateKey(it) }
                } else null
            }
            dayKey?.let { key ->
                DayNavBar(
                    label = NotesLinks.formatDayLabel(key),
                    onPrev = { NotesLinks.addDays(key, -1)?.let(vm::openDailyNote) },
                    onNext = { NotesLinks.addDays(key, 1)?.let(vm::openDailyNote) },
                    onToday = { vm.openDailyNote(NotesLinks.localDateKey(java.util.Date())) },
                )
            }
            Box(Modifier.weight(1f)) {
            if (vm.editIsTimeline) {
                TimelineEditor(
                    vm = vm,
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (preview) {
                val fontScale = vm.previewFontScale
                // Wikilinks become markdown links with a private scheme the
                // link resolver routes back into the app; code stays literal.
                val wikilinkMarkdown = NotesLinks.toMarkdownLinks(
                    preprocessLatex(
                        resolvePreviewUrls(vm.editContent, vm.publicBase, serverBase),
                    ),
                ) { vm.resolveWikilink(it) }
                val noteId = noteKey.takeIf { it != "new" && !it.startsWith("local:") }
                val backlinks = remember(vm.linkIndex, noteId, vm.notes) {
                    noteId?.let { NotesLinks.inboundFor(vm.linkIndex, it, vm.notes) } ?: emptyList()
                }
                val outTargets = remember(vm.linkIndex, noteId) {
                    noteId?.let { vm.linkIndex.outbound[it] } ?: emptyList()
                }
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(bottom = 72.dp),
                ) {
                    Text(
                        vm.editTitle.ifBlank { "Untitled" },
                        style = MaterialTheme.typography.headlineSmall.copy(
                            fontSize = (24 * fontScale).sp,
                            lineHeight = (30 * fontScale).sp,
                        ),
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                    )
                    MarkdownText(
                        markdown = wikilinkMarkdown,
                        client = httpClient,
                        serverBase = serverBase,
                        publicBase = vm.publicBase,
                        textSizeSp = 15.5f * fontScale,
                        onTaskClick = { vm.toggleEditorTask(it) },
                        modifier = Modifier
                            .padding(horizontal = 24.dp, vertical = 4.dp)
                            .fillMaxWidth(),
                    )
                    if (backlinks.isNotEmpty() || outTargets.isNotEmpty()) {
                        BacklinksSection(
                            backlinks = backlinks,
                            outTargets = outTargets,
                            isResolved = { vm.resolveWikilink(it) != null },
                            onOpen = { vm.openEditor(it) },
                            onOpenTarget = { target ->
                                vm.openWikilink(target) { wikilinkCreate = target }
                            },
                            modifier = Modifier
                                .padding(horizontal = 24.dp, vertical = 8.dp)
                                .fillMaxWidth(),
                        )
                    }
                    Spacer(Modifier.height(48.dp))
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    /* title — flat, borderless */
                    BasicTextField(
                        value = vm.editTitle,
                        onValueChange = {
                            vm.editTitle = it
                            vm.onEditorChanged()
                        },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.headlineSmall.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
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
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp, vertical = 6.dp),
                    )

                    /* tags row */
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 24.dp, vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        vm.editTags.forEach { tag ->
                            TagChip(
                                tag = tag,
                                onClick = {
                                    vm.editTags = vm.editTags - tag
                                    vm.onEditorChanged()
                                },
                            )
                        }
                        Box(
                            Modifier
                                .background(
                                    MaterialTheme.colorScheme.surfaceContainerLow,
                                    AppShapes.pill,
                                )
                                .clickable { addTagOpen = true }
                                .padding(horizontal = 12.dp, vertical = 5.dp),
                        ) {
                            Text(
                                "+ tag",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    /* markdown quick toolbar */
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                    ) {
                        Row(
                            Modifier
                                .horizontalScroll(rememberScrollState())
                                .padding(horizontal = 4.dp, vertical = 2.dp),
                        ) {
                            ToolbarButton(Icons.Filled.Image, "Insert image") {
                                pickImage.launch(
                                    PickVisualMediaRequest(
                                        ActivityResultContracts.PickVisualMedia.ImageOnly,
                                    ),
                                )
                            }
                            ToolbarButton(Icons.Filled.AttachFile, "Attach document") {
                                pickDocument.launch(DOCUMENT_MIMES)
                            }
                            ToolbarButton(Icons.Filled.FormatBold, "Bold") {
                                content = wrapSelection(content, "**")
                            }
                            ToolbarButton(Icons.Filled.FormatItalic, "Italic") {
                                content = wrapSelection(content, "*")
                            }
                            ToolbarButton(Icons.Filled.Title, "Heading") {
                                content = toggleLinePrefix(content, "# ")
                            }
                            ToolbarButton(Icons.Filled.FormatListBulleted, "List") {
                                content = toggleLinePrefix(content, "- ")
                            }
                            ToolbarButton(Icons.Outlined.CheckBox, "Task") {
                                content = toggleLinePrefix(content, "- [ ] ")
                            }
                            ToolbarButton(Icons.Filled.FormatQuote, "Quote") {
                                content = toggleLinePrefix(content, "> ")
                            }
                            ToolbarButton(Icons.Filled.Code, "Code") {
                                content = wrapSelection(content, "`")
                            }
                            ToolbarButton(Icons.Filled.HorizontalRule, "Divider") {
                                content = insertAtCursor(content, "\n\n---\n\n")
                            }
                        }
                    }

                    /* image upload / clipboard status */
                    if (uploading != null) {
                        UploadInfoRow(text = uploading!!)
                    } else if (clipImage != null && !preview) {
                        ClipboardImageRow(
                            onInsert = {
                                val uri = clipImage
                                clipImage = null
                                if (uri != null) scope.launch { insertFromUri(uri) }
                            },
                            onDismiss = { clipImage = null },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                    }

                    /* content */
                    BasicTextField(
                        value = content,
                        onValueChange = {
                            content = it
                            vm.editContent = it.text
                            vm.onEditorChanged()
                        },
                        textStyle = MaterialTheme.typography.bodyLarge,
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        decorationBox = { inner ->
                            if (content.text.isEmpty()) {
                                Text(
                                    "Write in Markdown…",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                                )
                            }
                            inner()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(horizontal = 24.dp, vertical = 8.dp),
                    )
                }
            }

            /* floating save-status pill */
            SaveStatusPill(
                status = vm.editStatus,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 16.dp),
            )
            }
        }
    }

    if (addTagOpen) {
        var newTag by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { addTagOpen = false },
            title = { Text("Add tag") },
            text = {
                OutlinedTextField(
                    value = newTag,
                    onValueChange = { newTag = it.take(32) },
                    singleLine = true,
                    shape = AppShapes.field,
                    placeholder = { Text("tag name") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val t = newTag.trim()
                    if (t.isNotEmpty() && !vm.editTags.contains(t)) {
                        vm.editTags = vm.editTags + t
                        vm.onEditorChanged()
                    }
                    addTagOpen = false
                }) { Text("Add") }
            },
            dismissButton = { TextButton(onClick = { addTagOpen = false }) { Text("Cancel") } },
        )
    }

    if (deleteConfirm) {
        AlertDialog(
            onDismissRequest = { deleteConfirm = false },
            title = { Text("Move to trash?") },
            text = { Text("You can restore it from Settings → Trash until the trash is emptied.") },
            confirmButton = {
                TextButton(onClick = {
                    deleteConfirm = false
                    vm.deleteEditingNote()
                }) { Text("Move to trash", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteConfirm = false }) { Text("Cancel") } },
        )
    }

    /* A save lost the rev race: three explicit ways out, never a silent merge. */
    vm.conflict?.let { c ->
        if (vm.editingKey == c.noteId) {
            AlertDialog(
                onDismissRequest = { }, // a choice is required
                title = { Text("This note changed elsewhere") },
                text = {
                    Text(
                        "It was saved on another device after your last sync. Nothing is lost — " +
                            "a version you discard stays recoverable on the server.",
                    )
                },
                confirmButton = {
                    TextButton(onClick = { vm.resolveConflictKeepMine() }) { Text("Keep mine") }
                },
                dismissButton = {
                    Row {
                        TextButton(onClick = { vm.resolveConflictKeepBoth() }) { Text("Keep both") }
                        TextButton(onClick = { vm.resolveConflictKeepTheirs() }) { Text("Keep theirs") }
                    }
                },
            )
        }
    }

    if (moveOpen) {
        MoveNoteDialog(
            vm = vm,
            noteId = vm.editingKey,
            onDismiss = { moveOpen = false },
        )
    }

    wikilinkCreate?.let { target ->
        AlertDialog(
            onDismissRequest = { wikilinkCreate = null },
            title = { Text("Create this note?") },
            text = { Text("No note titled “${target}” exists yet. Create it now?") },
            confirmButton = {
                TextButton(onClick = {
                    wikilinkCreate = null
                    vm.createAndOpenNote(target)
                }) { Text("Create") }
            },
            dismissButton = {
                TextButton(onClick = { wikilinkCreate = null }) { Text("Cancel") }
            },
        )
    }

    shareUrl?.let { url ->
        ShareDialog(
            url = url,
            busy = shareBusy,
            qrEnabled = vm.shareQrEnabled,
            loadQr = { vm.loadShareQr(url) },
            onShare = {
                val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(android.content.Intent.EXTRA_TEXT, url)
                    putExtra(android.content.Intent.EXTRA_TITLE, vm.editTitle.ifBlank { "Note" })
                }
                context.startActivity(android.content.Intent.createChooser(send, "Share note"))
            },
            onCopy = {
                val cm = context.getSystemService(ClipboardManager::class.java)
                cm?.setPrimaryClip(android.content.ClipData.newPlainText("note link", url))
                vm.postMessage("Link copied")
            },
            onRevoke = {
                shareBusy = true
                vm.unshareCurrentNote { err ->
                    shareBusy = false
                    shareUrl = null
                    vm.postMessage(err ?: "Sharing turned off — the link no longer works")
                }
            },
            onDismiss = { shareUrl = null },
        )
    }
}

@Composable
private fun ShareDialog(
    url: String,
    busy: Boolean,
    qrEnabled: Boolean,
    loadQr: suspend () -> Bitmap?,
    onShare: () -> Unit,
    onCopy: () -> Unit,
    onRevoke: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Fetch + render once per link; stays null (QR hidden) when the server
    // has no QR module or the fetch fails — the link itself still works.
    var qrBitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    if (qrEnabled) {
        LaunchedEffect(url) { qrBitmap = loadQr() }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Share this note") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Anyone with the link can read this note until you turn sharing off.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    shape = AppShapes.field,
                ) {
                    androidx.compose.foundation.text.selection.SelectionContainer {
                        Text(
                            url,
                            Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                qrBitmap?.let { bmp ->
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Image(
                            bmp.asImageBitmap(),
                            contentDescription = "QR code for this share link",
                            modifier = Modifier
                                .size(184.dp)
                                .background(Color.White, AppShapes.field)
                                .padding(8.dp),
                            contentScale = ContentScale.Fit,
                        )
                        Text(
                            "Scan to open on a phone",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = onShare, enabled = !busy) { Text("Share…") }
                TextButton(onClick = onCopy, enabled = !busy) { Text("Copy") }
            }
        },
        dismissButton = {
            TextButton(onClick = onRevoke, enabled = !busy) {
                Text("Turn off", color = MaterialTheme.colorScheme.error)
            }
        },
    )
}

/* ------------------------------------------------- wikilinks + daily notes */

/**
 * Linked-from section below a note's preview: the outbound line of chips
 * plus a row per linking note with a snippet around its wikilink.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BacklinksSection(
    backlinks: List<NotesLinks.Backlink>,
    outTargets: List<String>,
    isResolved: (String) -> Boolean,
    onOpen: (String) -> Unit,
    onOpenTarget: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (outTargets.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val resolvedCount = outTargets.count { isResolved(it) }
                Text(
                    if (resolvedCount > 0) "Links to $resolvedCount note${if (resolvedCount == 1) "" else "s"}:"
                    else "Links:",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                for (t in outTargets) {
                    val resolved = isResolved(t)
                    Surface(
                        onClick = { onOpenTarget(t) },
                        shape = MaterialTheme.shapes.large,
                        color = if (resolved) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surface,
                        border = if (resolved) null
                        else androidx.compose.foundation.BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                        ),
                    ) {
                        Text(
                            t,
                            style = MaterialTheme.typography.labelMedium,
                            color = if (resolved) MaterialTheme.colorScheme.onPrimaryContainer
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
            }
        }
        if (backlinks.isNotEmpty()) {
            Text(
                "Linked from ${backlinks.size}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            for (b in backlinks) {
                Surface(
                    onClick = { onOpen(b.id) },
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.outlineVariant,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Text(
                            b.title.ifBlank { "Untitled" },
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (b.snippet.isNotEmpty()) {
                            Text(
                                b.snippet,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Prev / label / Today bar shown while a daily note (date title) is open. */
@Composable
private fun DayNavBar(
    label: String,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrev) {
            Icon(Icons.Filled.KeyboardArrowLeft, contentDescription = "Previous day")
        }
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        IconButton(onClick = onNext) {
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = "Next day")
        }
        TextButton(onClick = onToday) { Text("Today") }
    }
}

@Composable
private fun ToolbarButton(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(
            icon,
            contentDescription = desc,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun UploadInfoRow(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            CircularProgressIndicator(
                Modifier.size(16.dp),
                strokeWidth = 2.dp,
            )
            Text(
                text,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ClipboardImageRow(
    onInsert: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        modifier = modifier,
    ) {
        Row(
            Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Image,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.size(10.dp))
            Text(
                "Image in clipboard",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onInsert) { Text("Insert") }
            IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Dismiss",
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun SaveStatusPill(status: EditStatus, modifier: Modifier = Modifier) {
    Crossfade(
        targetState = status,
        modifier = modifier,
        label = "saveStatus",
    ) { s ->
        val (text, color) = when (s) {
            is EditStatus.Saving -> "Saving…" to MaterialTheme.colorScheme.onSurfaceVariant
            is EditStatus.Saved -> "Saved · ${formatSaveTime(s.at)}" to MaterialTheme.colorScheme.primary
            is EditStatus.Pending -> "Offline — kept on this phone" to MaterialTheme.colorScheme.tertiary
            else -> "" to MaterialTheme.colorScheme.onSurfaceVariant
        }
        if (text.isNotEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = AppShapes.pill,
                shadowElevation = 4.dp,
            ) {
                Text(
                    text,
                    Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
                    color = color,
                )
            }
        } else {
            Box(Modifier.width(1.dp))
        }
    }
}

@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    client: OkHttpClient? = null,
    serverBase: String = "",
    publicBase: String = "",
    textSizeSp: Float = 15.5f,
    onTaskClick: ((Int) -> Unit)? = null,
) {
    val textColor = MaterialTheme.colorScheme.onSurface.toArgbCompat()
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val taskClick by androidx.compose.runtime.rememberUpdatedState(onTaskClick)

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                textSize = textSizeSp
                setLineSpacing(0f, 1.15f)
                setTextIsSelectable(onTaskClick == null)
                if (onTaskClick != null) {
                    // Tap detection at the VIEW level. Markwon's setMarkdown
                    // installs a LinkMovementMethod and makes this TextView
                    // clickable, so the interop view itself consumes every
                    // touch — a Compose pointerInput above the AndroidView
                    // never sees a tap. The OnTouchListener runs inside the
                    // view's own dispatch, before that consumption.
                    val slop = android.view.ViewConfiguration.get(ctx).scaledTouchSlop
                    var downX = 0f
                    var downY = 0f
                    setOnTouchListener { v, e ->
                        when (e.actionMasked) {
                            android.view.MotionEvent.ACTION_DOWN -> {
                                downX = e.x
                                downY = e.y
                                false // let the view (and links / scrolling) proceed
                            }
                            android.view.MotionEvent.ACTION_UP -> {
                                val isTap =
                                    kotlin.math.abs(e.x - downX) <= slop &&
                                        kotlin.math.abs(e.y - downY) <= slop
                                downX = 0f
                                downY = 0f
                                val click = taskClick
                                val index = if (isTap && click != null)
                                    TaskTap.taskIndexAt(v as TextView, e.x, e.y)
                                else
                                    -1
                                if (index >= 0 && click != null) {
                                    v.performClick()
                                    click(index)
                                    true // consumed: this was a checkbox tap
                                } else {
                                    false // links and everything else keep working
                                }
                            }
                            else -> false
                        }
                    }
                }
            }
        },
        update = { tv ->
            tv.setTextColor(textColor)
            tv.textSize = textSizeSp
            val mw =
                if (client != null) {
                    markwon(
                        tv.context, client, serverBase, publicBase,
                        latexTextSizePx = textSizeSp * density,
                        latexColor = textColor,
                    )
                } else legacyMarkwon(tv.context)
            mw.setMarkdown(tv, markdown)
        },
    )
}

/** Fallback without image support (not used by the editor today). */
private var legacyMarkwonInstance: Markwon? = null
private fun legacyMarkwon(context: Context): Markwon =
    legacyMarkwonInstance ?: Markwon.builder(context.applicationContext)
        .usePlugin(TablePlugin.create(context))
        .usePlugin(TaskListPlugin.create(context))
        .build()
        .also { legacyMarkwonInstance = it }

private fun androidx.compose.ui.graphics.Color.toArgbCompat(): Int =
    android.graphics.Color.argb(
        (alpha * 255).toInt(), (red * 255).toInt(), (green * 255).toInt(), (blue * 255).toInt(),
    )
