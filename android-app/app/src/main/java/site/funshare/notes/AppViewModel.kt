package site.funshare.notes

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.graphics.Bitmap
import java.io.IOException
import java.util.UUID

/** Navigation destinations; last element of [AppViewModel.backStack] is on screen. */
sealed interface Screen {
    data object Login : Screen
    data object Notes : Screen
    data object Edit : Screen
    data object Settings : Screen
    data object Admin : Screen
    data object Trash : Screen
}

/** A save lost the rev race; [server] is the winning version. */
data class ConflictState(val noteId: String, val server: Note)

sealed interface EditStatus {
    data object Idle : EditStatus
    data object Saving : EditStatus
    data class Saved(val at: Long) : EditStatus
    /** Kept on this phone as a local draft; will be pushed on the next sync. */
    data class Pending(val reason: String?) : EditStatus
}

enum class ThemeMode(val label: String) {
    SYSTEM("System"), LIGHT("Light"), DARK("Dark");

    companion object {
        fun from(s: String): ThemeMode = entries.firstOrNull { it.name.equals(s, true) } ?: SYSTEM
    }
}

class AppViewModel(app: NotesApp) : AndroidViewModel(app) {

    /** Share-token path segment of a share link ("/share/<32 hex chars>"). */
    private val SHARE_TOKEN = Regex("""/share/([0-9a-f]{32})""")
    private val store = app.store
    val api = Api(store)

    /* ----------------------------------------------------------- state */

    var backStack by mutableStateOf(listOf<Screen>(Screen.Login))
        private set
    var booting by mutableStateOf(true)
        private set
    var busy by mutableStateOf(false)
        private set

    var user by mutableStateOf<User?>(null)
        private set
    var sessionInfo by mutableStateOf<SessionInfo?>(null)
        private set

    var notes by mutableStateOf(store.cachedNotes + store.pendingNotes)
        private set
    var folders by mutableStateOf<List<Folder>>(emptyList())
        private set
    /** null = all notes, "" = unfiled, otherwise a folder id. */
    var selectedFolderId by mutableStateOf<String?>(null)
    var refreshing by mutableStateOf(false)
        private set
    var offline by mutableStateOf(false)
        private set

    var themeMode by mutableStateOf(ThemeMode.from(store.themeMode))
        private set

    /** Text scale for the note preview (1f = default). */
    var previewFontScale by mutableStateOf(store.previewFontScale)
        private set

    /** One-shot snackbar message. */
    var message by mutableStateOf<String?>(null)

    /* editor state */
    private var editingId: String? = null
    /** Identity of the note in the editor ("new" until first save). */
    val editingKey: String get() = editingId ?: "new"
    /** Existing notes open in preview; a brand-new note opens in edit mode. */
    var editStartInPreview by mutableStateOf(false)
        private set
    /** Folder chosen for a note that has never been saved ("new"). */
    var pendingDraftFolderId by mutableStateOf<String?>(null)
        private set
    var editTitle by mutableStateOf("")
    var editContent by mutableStateOf("")
    var editTags by mutableStateOf(listOf<String>())
    var editPinned by mutableStateOf(false)
    var editStatus by mutableStateOf<EditStatus>(EditStatus.Idle)
        private set
    /** Non-null while a save hit a 409 and the user must pick a version. */
    var conflict by mutableStateOf<ConflictState?>(null)
        private set
    private var lastSavedSnapshot: String = ""
    private var autosaveJob: Job? = null
    /** Debounces folder reorder requests so rapid Up/Down taps don't race. */
    private var folderReorderJob: Job? = null

    /* admin state */
    var adminData by mutableStateOf<AdminData?>(null)
    var adminLoading by mutableStateOf(false)
        private set

    /* trash state */
    var trash by mutableStateOf<List<Note>>(emptyList())
        private set
    var trashLoading by mutableStateOf(false)
        private set

    /* share state (from /api/session) */
    /** Server serves /share/<token>/qr.svg; false on servers without the QR module. */
    var shareQrEnabled by mutableStateOf(false)
        private set

    /* wikilink index over the live notes (rebuilt on list changes,
       updated for one note on save — never per keystroke). */
    var linkIndex by mutableStateOf(NotesLinks.LinkIndex())
        private set

    private fun rebuildLinkIndex() {
        linkIndex = NotesLinks.buildLinkIndex(notes)
    }

    private fun updateLinkIndex(note: Note) {
        linkIndex = NotesLinks.updateNote(linkIndex, note)
    }

    init {
        viewModelScope.launch { boot() }
    }

    /* ------------------------------------------------------- lifecycle */

    private suspend fun boot() {
        user = store.cachedUser
        if (store.sessionCookie != null) {
            try {
                val s = api.session()
                applySessionFeatures(s)
                if (s.authenticated && s.user != null) {
                    user = s.user
                    store.cachedUser = s.user
                    enterNotes()
                    refresh()
                } else {
                    sessionExpired()
                }
            } catch (e: Exception) {
                if (user != null) {
                    // Signed in before but server unreachable → browse cache.
                    offline = true
                    enterNotes()
                } else {
                    sessionExpired()
                }
            }
        }
        booting = false
    }

    private fun sessionExpired() {
        store.sessionCookie = null
        user = null
        backStack = listOf(Screen.Login)
    }

    private fun enterNotes() {
        backStack = listOf(Screen.Notes)
    }

    /* ------------------------------------------------------ navigation */

    fun navigate(s: Screen) {
        if (s == Screen.Edit) autosaveNow()
        backStack = backStack + s
    }

    fun back() {
        if (backStack.lastOrNull() == Screen.Edit) autosaveNow()
        if (backStack.size > 1) backStack = backStack.dropLast(1)
    }

    fun atRoot(): Boolean = backStack.size <= 1

    /* -------------------------------------------------------- messages */

    fun postMessage(msg: String?) {
        message = msg
    }

    /* ------------------------------------------------------------ auth */

    fun probeServer(rawUrl: String, trustAll: Boolean, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            try {
                val base = Api.normalizeBaseUrl(rawUrl)
                if (base.isEmpty()) return@launch
                // probe with the given URL (config updated so the client points there)
                store.serverUrl = base
                store.trustAllCerts = trustAll
                api.reloadClient()
                sessionInfo = api.session().also { applySessionFeatures(it) }
            } catch (e: Exception) {
                sessionInfo = null
            } finally {
                onDone()
            }
        }
    }

    fun login(username: String, password: String, rawUrl: String, trustAll: Boolean) {
        viewModelScope.launch {
            busy = true
            try {
                val base = Api.normalizeBaseUrl(rawUrl)
                if (base.isNotEmpty()) store.serverUrl = base
                store.trustAllCerts = trustAll
                api.reloadClient()
                val u = api.login(username.trim(), password)
                user = u
                store.cachedUser = u
                offline = false
                enterNotes()
                refresh()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
            }
        }
    }

    fun register(username: String, password: String, rawUrl: String, trustAll: Boolean) {
        viewModelScope.launch {
            busy = true
            try {
                val base = Api.normalizeBaseUrl(rawUrl)
                if (base.isNotEmpty()) store.serverUrl = base
                store.trustAllCerts = trustAll
                api.reloadClient()
                val u = api.register(username.trim(), password)
                user = u
                store.cachedUser = u
                offline = false
                enterNotes()
                refresh()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try { api.logout() } catch (e: Exception) { /* server may be unreachable */ }
            store.clearAccountData()
            user = null
            notes = emptyList()
            linkIndex = NotesLinks.LinkIndex()
            folders = emptyList()
            selectedFolderId = null
            offline = false
            backStack = listOf(Screen.Login)
        }
    }

    fun logoutEverywhere() {
        viewModelScope.launch {
            try { api.logoutAll() } catch (e: Exception) { /* ignore */ }
            store.clearAccountData()
            user = null
            notes = emptyList()
            linkIndex = NotesLinks.LinkIndex()
            folders = emptyList()
            selectedFolderId = null
            offline = false
            backStack = listOf(Screen.Login)
        }
    }

    fun changePassword(current: String, next: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            busy = true
            var ok = false
            try {
                api.changePassword(current, next)
                ok = true
                postMessage("Password changed")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
                onDone(ok)
            }
        }
    }

    fun deleteAccount(password: String) {
        viewModelScope.launch {
            busy = true
            try {
                api.deleteAccount(password)
                store.clearAccountData()
                user = null
                notes = emptyList()
            linkIndex = NotesLinks.LinkIndex()
                backStack = listOf(Screen.Login)
                postMessage("Account deleted")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
            }
        }
    }

    /* ----------------------------------------------------------- notes */

    fun refresh() {
        viewModelScope.launch {
            if (refreshing) return@launch
            refreshing = true
            try {
                syncPendingDrafts()
                val list = api.listNotes()
                val local = notes.filter { it.isLocal }
                notes = sortNotes(list + local)
                rebuildLinkIndex()
                store.cachedNotes = notes
                offline = false
                try {
                    folders = api.listFolders()
                } catch (e: Exception) {
                    // folders are auxiliary — an older server or a hiccup
                    // must not break the notes list
                }
            } catch (e: ApiException) {
                if (e.status == 401) sessionExpired() else offline = true
            } catch (e: Exception) {
                offline = true
            } finally {
                refreshing = false
            }
        }
    }

    fun folderName(id: String?): String =
        folders.firstOrNull { it.id == id }?.name ?: ""

    /** Folders as shown in the drawer / pickers: pinned first, then stored order. */
    val orderedFolders: List<Folder>
        get() = displayOrder(folders)

    /* -------------------------------------------------------------- folders */

    fun createFolder(name: String, onDone: (String?) -> Unit = {}) {
        viewModelScope.launch {
            busy = true
            try {
                val f = api.createFolder(name.trim())
                folders = folders + f
                selectedFolderId = f.id
                onDone(f.id)
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
                onDone(null)
            } finally {
                busy = false
            }
        }
    }

    /** The folder [delta] rows away in the drawer within the same pin group. */
    fun folderNeighbour(id: String, delta: Int): Folder? {
        val shown = orderedFolders
        val index = shown.indexOfFirst { it.id == id }
        val j = folderNeighbourIndex(shown, index, delta)
        return if (j >= 0) shown[j] else null
    }

    /**
     * Move a folder one row up/down in the drawer. Only folders of the same
     * pin group swap places, so a pinned folder can't be dragged below the
     * pinned section (it would still be displayed on top). The new order is
     * persisted through POST /api/folders/reorder.
     */
    fun moveFolder(id: String, delta: Int) {
        val other = folderNeighbour(id, delta) ?: return
        val before = folders
        val after = swapFolderOrder(before, id, other.id)
        if (after == before) return
        folders = after // optimistic — the drawer updates immediately
        // Rapid Up/Down taps all apply locally; only the final order is sent.
        folderReorderJob?.cancel()
        folderReorderJob = viewModelScope.launch {
            delay(200)
            try {
                api.reorderFolders(after.map { it.id })
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
                // Our copy may be stale (folder added/removed elsewhere) —
                // reload so the next move starts from the server's order.
                try {
                    folders = api.listFolders()
                } catch (reloadError: Exception) {
                    folders = before
                }
            }
        }
    }

    /** Pin/unpin a folder; pinned folders are listed above the rest. */
    fun setFolderPinned(id: String, pinned: Boolean) {
        val current = folders.firstOrNull { it.id == id } ?: return
        if (current.pinned == pinned) return
        val before = folders
        folders = folders.map { if (it.id == id) it.copy(pinned = pinned) else it }
        viewModelScope.launch {
            try {
                // The pin endpoint returns the raw folder (no noteCount), so
                // keep the count we already have.
                val updated = api.setFolderPinned(id, pinned)
                folders = folders.map {
                    if (it.id == id) updated.copy(noteCount = it.noteCount) else it
                }
            } catch (e: Exception) {
                folders = before
                postMessage(Api.describeError(e))
            }
        }
    }

    fun renameFolder(id: String, name: String) {
        viewModelScope.launch {
            busy = true
            try {
                api.renameFolder(id, name.trim())
                folders = api.listFolders()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
            }
        }
    }

    /** Delete a folder; its notes become unfiled (server moves them). */
    fun deleteFolder(id: String) {
        viewModelScope.launch {
            busy = true
            try {
                api.deleteFolder(id)
                folders = api.listFolders()
                notes = notes.map { if (it.folderId == id) it.copy(folderId = null) else it }
                store.cachedNotes = notes
                if (selectedFolderId == id) selectedFolderId = null
                postMessage("Folder deleted — its notes are unfiled")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                busy = false
            }
        }
    }

    /**
     * Move a note into a folder (null = unfiled). Works for the note being
     * edited, a list note, or an unsaved "new" note (applied on first save).
     */
    fun moveNote(id: String, folderId: String?) {
        if (id == "new") {
            pendingDraftFolderId = folderId
            postMessage("Will be saved in \"${folderName(folderId).ifEmpty { "Unfiled" }}\"")
            return
        }
        viewModelScope.launch {
            val note = notes.firstOrNull { it.id == id }
            if (note == null) {
                if (editingId == id) pendingDraftFolderId = folderId
                return@launch
            }
            val target = folderId?.takeIf { it.isNotEmpty() }
            if (note.isLocal) {
                notes = notes.map { if (it.id == id) note.copy(folderId = target) else it }
                store.pendingNotes = notes.filter { it.isLocal }
                if (editingId == id) pendingDraftFolderId = target
                postMessage("Moved")
                return@launch
            }
            try {
                val updated = api.updateNote(
                    note.id, note.title, note.content, note.tags, note.pinned, target,
                    rev = note.rev.takeIf { it > 0 },
                )
                notes = sortNotes(notes.map { if (it.id == id) updated else it })
                store.cachedNotes = notes
                folders = folders.map { f ->
                    when (f.id) {
                        target -> f.copy(noteCount = f.noteCount + 1)
                        note.folderId -> f.copy(noteCount = (f.noteCount - 1).coerceAtLeast(0))
                        else -> f
                    }
                }
                postMessage("Moved to \"${folderName(target).ifEmpty { "Unfiled" }}\"")
            } catch (e: ApiException) {
                if (e.status == 401) sessionExpired() else postMessage(Api.describeError(e))
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    private suspend fun syncPendingDrafts() {
        val pending = notes.filter { it.isLocal }
        for (n in pending) {
            try {
                val created = api.createNote(n.title, n.content, n.tags, n.pinned, n.folderId)
                notes = notes.map { if (it.id == n.id) created else it }
                if (editingId == n.id) {
                    editingId = created.id
                    if (backStack.lastOrNull() == Screen.Edit) replaceTop(Screen.Edit)
                }
            } catch (e: ApiException) {
                if (e.status == 401) { sessionExpired(); return }
                break // server error: keep the rest as drafts
            } catch (e: IOException) {
                break
            }
        }
        store.pendingNotes = notes.filter { it.isLocal }
        store.cachedNotes = notes
        rebuildLinkIndex()
    }

    private fun sortNotes(list: List<Note>): List<Note> =
        list.sortedWith(compareByDescending<Note> { it.pinned }.thenByDescending { it.updatedAt })

    fun deleteNote(id: String) {
        viewModelScope.launch {
            val note = notes.firstOrNull { it.id == id } ?: return@launch
            if (note.isLocal) {
                notes = notes.filterNot { it.id == id }
                rebuildLinkIndex()
                store.pendingNotes = notes.filter { it.isLocal }
                return@launch
            }
            try {
                api.deleteNote(id)
                notes = notes.filterNot { it.id == id }
                rebuildLinkIndex()
                store.cachedNotes = notes
                postMessage("Note moved to trash")
            } catch (e: ApiException) {
                if (e.status == 401) sessionExpired() else postMessage(Api.describeError(e))
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    fun togglePin(id: String) {
        viewModelScope.launch {
            val note = notes.firstOrNull { it.id == id && !it.isLocal } ?: return@launch
            try {
                val updated = api.updateNote(
                    note.id, note.title, note.content, note.tags, !note.pinned, note.folderId,
                    rev = note.rev.takeIf { it > 0 },
                )
                notes = sortNotes(notes.map { if (it.id == id) updated else it })
                store.cachedNotes = notes
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    /* ---------------------------------------------------------- editor */

    fun openEditor(id: String, startInEdit: Boolean = false) {
        val note = if (id == "new") null else notes.firstOrNull { it.id == id }
        editingId = id
        conflict = null
        editStartInPreview = note != null && !startInEdit
        pendingDraftFolderId = null
        editTitle = note?.title ?: ""
        editContent = note?.content ?: ""
        editTags = note?.tags ?: emptyList()
        editPinned = note?.pinned ?: false
        lastSavedSnapshot = editorSnapshot()
        editStatus = if (note == null) EditStatus.Idle else EditStatus.Saved(note.updatedAt)
        navigate(Screen.Edit)
    }

    private fun editorSnapshot(): String =
        "${editTitle}\u0000${editContent}\u0000${editTags.joinToString("\u0001")}\u0000$editPinned"

    private fun editorDirty(): Boolean = editorSnapshot() != lastSavedSnapshot

    private fun replaceTop(s: Screen) {
        if (backStack.isNotEmpty()) backStack = backStack.dropLast(1) + s
    }

    /** Called on every editor keystroke — schedules the debounced autosave. */
    fun onEditorChanged() {
        if (conflict != null) return // a pending conflict blocks autosave
        editStatus = EditStatus.Idle
        autosaveJob?.cancel()
        autosaveJob = viewModelScope.launch {
            delay(1200)
            editingId?.let { saveEditor(it) }
        }
    }

    /** Immediate save (used when leaving the editor). Captures the note id synchronously. */
    fun autosaveNow() {
        if (backStack.lastOrNull() != Screen.Edit) return
        autosaveJob?.cancel()
        if (!editorDirty() || conflict != null) return
        val id = editingId ?: return
        viewModelScope.launch { saveEditor(id) }
    }

    /** Toggle the [taskIndex]-th checkbox of the note being previewed/edited. */
    fun toggleEditorTask(taskIndex: Int) {
        val flipped = site.funshare.notes.ui.flipTaskMarker(editContent, taskIndex) ?: return
        editContent = flipped
        onEditorChanged()
    }

    /** The live OkHttp client (shares cookies + trust-all TLS). */
    fun okHttpClient() = api.httpClient()

    /* --------------------------------------- wikilinks + daily notes */

    /** Resolve a wikilink target to a note id, or null when nothing matches. */
    fun resolveWikilink(target: String): String? =
        NotesLinks.resolveTitle(linkIndex, target)

    /**
     * Open the note a wikilink points at; when no note has that title,
     * [onMissing] runs so the UI can offer creating it.
     */
    fun openWikilink(target: String, onMissing: () -> Unit) {
        val id = NotesLinks.resolveTitle(linkIndex, target)
        if (id != null) openEditor(id) else onMissing()
    }

    /** Create a note with this title (empty body) and open it for writing. */
    fun createAndOpenNote(title: String) {
        viewModelScope.launch {
            autosaveNow()
            try {
                val created = api.createNote(
                    title, "", emptyList(), false,
                    folderId = selectedFolderId?.takeIf { it.isNotEmpty() },
                )
                notes = sortNotes(listOf(created) + notes)
                updateLinkIndex(created)
                store.cachedNotes = notes
                openEditor(created.id, startInEdit = true)
            } catch (e: Exception) {
                postMessage("Couldn't create note — ${Api.describeError(e)}")
            }
        }
    }

    /**
     * Open (or create) the daily note titled [key] (YYYY-MM-DD). The
     * duplicate guard keeps the older note when two creations race a
     * double-tap: the loser is deleted again and the survivor opens.
     */
    fun openDailyNote(key: String) {
        if (key.isEmpty()) return
        viewModelScope.launch {
            autosaveNow()
            val k = NotesLinks.titleKey(key)
            notes.firstOrNull { NotesLinks.titleKey(it.title) == k }?.let {
                openEditor(it.id)
                return@launch
            }
            try {
                val created = api.createNote(
                    key, "", emptyList(), false,
                    folderId = selectedFolderId?.takeIf { it.isNotEmpty() },
                )
                val dup = notes.firstOrNull { NotesLinks.titleKey(it.title) == k }
                if (dup != null) {
                    try { api.deleteNote(created.id) } catch (e: Exception) { /* already gone */ }
                    openEditor(dup.id)
                    return@launch
                }
                notes = sortNotes(listOf(created) + notes)
                updateLinkIndex(created)
                store.cachedNotes = notes
                openEditor(created.id, startInEdit = true)
            } catch (e: Exception) {
                postMessage("Couldn't create daily note — ${Api.describeError(e)}")
            }
        }
    }

    /** Normalized current server base URL ("" when unset). */
    val serverBase: String
        get() = Api.normalizeBaseUrl(store.serverUrl)

    /**
     * Canonical public base for share/upload addresses. A base advertised by
     * the server (its PUBLIC_BASE_URL — the origin it bakes into link
     * previews and QR codes) wins; otherwise the local share-link setting.
     */
    val publicBase: String
        get() = Api.normalizeBaseUrl(
            sessionInfo?.publicBaseUrl?.takeIf { it.isNotBlank() }
                ?: store.shareLinkBase.trim().ifEmpty { Store.DEFAULT_SHARE_BASE },
        )

    /** Cache the share-relevant parts of /api/session. */
    private fun applySessionFeatures(s: SessionInfo) {
        shareQrEnabled = s.featuresQr
    }

    private fun saveEditor(id: String) {
        viewModelScope.launch {
            if (!editorDirty()) return@launch
            editStatus = EditStatus.Saving
            val snap = editorSnapshot()
            try {
                if (id == "new" || id.startsWith("local:")) {
                    val draft = notes.firstOrNull { it.id == id }
                    val created = api.createNote(
                        editTitle, editContent, editTags, editPinned,
                        folderId = pendingDraftFolderId ?: draft?.folderId,
                    )
                    editingId = created.id
                    pendingDraftFolderId = null
                    if (backStack.lastOrNull() == Screen.Edit) replaceTop(Screen.Edit)
                    notes = sortNotes(notes.filterNot { it.id == id } + created)
                    rebuildLinkIndex() // the old draft id left the list
                } else {
                    val current = notes.firstOrNull { it.id == id }
                    val updated = api.updateNote(
                        id, editTitle, editContent, editTags, editPinned,
                        folderId = pendingDraftFolderId ?: current?.folderId,
                        rev = current?.rev?.takeIf { it > 0 },
                    )
                    pendingDraftFolderId = null
                    notes = sortNotes(notes.map { if (it.id == id) updated else it })
                    updateLinkIndex(updated) // incremental: no full rescan per save
                }
                lastSavedSnapshot = snap
                editStatus = EditStatus.Saved(System.currentTimeMillis())
                store.cachedNotes = notes
                store.pendingNotes = notes.filter { it.isLocal }
                offline = false
            } catch (e: ApiException) {
                if (e.status == 401) {
                    sessionExpired()
                    return@launch
                }
                if (e.status == 409 && e.code == "conflict") {
                    val server = e.payload?.optJSONObject("note")?.let { Note.fromJson(it) }
                    if (server != null) {
                        // Park the editor on the conflict: never auto-retry, never merge.
                        conflict = ConflictState(noteId = id, server = server)
                        editStatus = EditStatus.Idle
                        return@launch
                    }
                }
                keepAsLocalDraft(id, snap, Api.describeError(e))
            } catch (e: Exception) {
                keepAsLocalDraft(id, snap, Api.describeError(e))
            }
        }
    }

    /** Server unreachable: park the note as a local draft and retry on next sync. */
    private fun keepAsLocalDraft(originalId: String, snap: String, reason: String) {
        val id = if (originalId == "new") "local:" + UUID.randomUUID().toString() else originalId
        val now = System.currentTimeMillis()
        val draft = Note(
            id = id, title = editTitle, content = editContent,
            tags = editTags, pinned = editPinned, createdAt = now, updatedAt = now,
        )
        editingId = id
        if (originalId == "new" && backStack.lastOrNull() == Screen.Edit) replaceTop(Screen.Edit)
        notes = sortNotes((notes.filterNot { it.id == id || it.id == originalId }) + draft)
        rebuildLinkIndex()
        store.pendingNotes = notes.filter { it.isLocal }
        lastSavedSnapshot = snap
        editStatus = EditStatus.Pending(reason)
        offline = true
    }

    fun deleteEditingNote() {
        val id = editingId ?: return
        autosaveJob?.cancel()
        editingId = null
        conflict = null
        deleteNote(id)
        backStack = backStack.filterNot { it == Screen.Edit }
    }

    fun closeEditor() {
        autosaveNow()
        editingId = null
    }

    /* -------------------------------------------------------- conflicts */

    /** Replace the editor + list with the server's winning version. */
    private fun adoptServerVersion(server: Note) {
        if (editingId == server.id) {
            editTitle = server.title
            editContent = server.content
            editTags = server.tags
            editPinned = server.pinned
            lastSavedSnapshot = editorSnapshot()
            editStatus = EditStatus.Saved(server.updatedAt)
        }
        notes = sortNotes(notes.map { if (it.id == server.id) server else it })
        updateLinkIndex(server)
        store.cachedNotes = notes
    }

    /** "Keep mine": overwrite the server version using its rev. */
    fun resolveConflictKeepMine() {
        val c = conflict ?: return
        conflict = null
        if (editingId != c.noteId) return
        viewModelScope.launch {
            editStatus = EditStatus.Saving
            val snap = editorSnapshot()
            try {
                val updated = api.updateNote(
                    c.noteId, editTitle, editContent, editTags, editPinned,
                    folderId = pendingDraftFolderId ?: c.server.folderId,
                    rev = c.server.rev,
                )
                pendingDraftFolderId = null
                notes = sortNotes(notes.map { if (it.id == c.noteId) updated else it })
                updateLinkIndex(updated)
                lastSavedSnapshot = snap
                editStatus = EditStatus.Saved(System.currentTimeMillis())
                store.cachedNotes = notes
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
                editStatus = EditStatus.Idle
            }
        }
    }

    /** "Keep theirs": load the server version into the editor. */
    fun resolveConflictKeepTheirs() {
        val c = conflict ?: return
        conflict = null
        adoptServerVersion(c.server)
        postMessage("Loaded the newer version")
    }

    /** "Keep both": save the local text as a copy, then load the server version. */
    fun resolveConflictKeepBoth() {
        val c = conflict ?: return
        conflict = null
        val localTitle = editTitle
        val localContent = editContent
        val localTags = editTags
        val localPinned = editPinned
        viewModelScope.launch {
            try {
                val copy = api.createNote(
                    "${localTitle.ifBlank { "Untitled" }} (conflict copy)",
                    localContent, localTags, localPinned,
                    folderId = pendingDraftFolderId ?: c.server.folderId,
                )
                notes = sortNotes(notes + copy)
                updateLinkIndex(copy)
                store.cachedNotes = notes
            } catch (e: Exception) {
                postMessage("Couldn't create the copy — ${Api.describeError(e)}")
            }
            adoptServerVersion(c.server)
            postMessage("Kept both — your version was saved as a copy")
        }
    }

    /* ----------------------------------------------------------- trash */

    fun loadTrash() {
        viewModelScope.launch {
            trashLoading = true
            try {
                trash = api.listTrash()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                trashLoading = false
            }
        }
    }

    fun restoreFromTrash(id: String) {
        viewModelScope.launch {
            try {
                val restored = api.restoreNote(id)
                trash = trash.filterNot { it.id == id }
                notes = sortNotes(notes + restored)
                store.cachedNotes = notes
                postMessage("Note restored")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    fun purgeFromTrash(id: String) {
        viewModelScope.launch {
            try {
                api.purgeNote(id)
                trash = trash.filterNot { it.id == id }
                postMessage("Deleted forever")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    fun emptyTrash() {
        viewModelScope.launch {
            try {
                val n = api.emptyTrash()
                trash = emptyList()
                postMessage("Trash emptied — $n note(s) removed")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    /* --------------------------------------------------------- settings */

    fun applyPreviewFontScale(scale: Float) {
        previewFontScale = scale
        store.previewFontScale = scale
    }

    /**
     * Save the note being edited, then create/rotate its public share link.
     * [onReady] receives the absolute link on success or an error message.
     */
    fun shareCurrentNote(onReady: (String?, String?) -> Unit) {
        autosaveNow()
        viewModelScope.launch {
            val id = editingId
            if (id == null || id == "new" || id.startsWith("local:")) {
                onReady(null, "The note is not saved on the server yet")
                return@launch
            }
            // wait for an in-flight autosave to land so the link shows the latest content
            var guard = 0
            while (editStatus is EditStatus.Saving && guard < 50) {
                delay(100)
                guard++
            }
            try {
                val path = api.createShare(id)
                // Recipients open the link through the public domain, not the
                // (possibly IP:port) address this phone talks to.
                onReady(publicBase + path, null)
            } catch (e: Exception) {
                onReady(null, Api.describeError(e))
            }
        }
    }

    /** Remove the public share link of the note being edited. */
    fun unshareCurrentNote(onDone: (String?) -> Unit) {
        viewModelScope.launch {
            val id = editingId
            if (id == null || id == "new" || id.startsWith("local:")) {
                onDone("The note is not saved on the server yet")
                return@launch
            }
            try {
                api.revokeShare(id)
                onDone(null)
            } catch (e: Exception) {
                onDone(Api.describeError(e))
            }
        }
    }

    /**
     * Rendered QR bitmap for an absolute share link, or null when the server
     * has no QR module, the link has no token, or the fetch/parse fails —
     * callers simply hide the QR in that case. The SVG is fetched through
     * [publicBase] so the encoded URL is the same origin the dialog shows.
     */
    suspend fun loadShareQr(linkUrl: String): Bitmap? {
        if (!shareQrEnabled) return null
        val token = SHARE_TOKEN.find(linkUrl)?.groupValues?.get(1) ?: return null
        val svg = api.fetchQrSvg(token, publicBase) ?: return null
        return QrSvg.render(svg, 640)
    }

    fun applyThemeMode(mode: ThemeMode) {
        themeMode = mode
        store.themeMode = mode.name.lowercase()
    }

    fun saveServerConfig(rawUrl: String, trustAll: Boolean, rawShareBase: String) {
        viewModelScope.launch {
            val base = Api.normalizeBaseUrl(rawUrl)
            if (base.isNotEmpty()) store.serverUrl = base
            store.trustAllCerts = trustAll
            store.shareLinkBase = Api.normalizeBaseUrl(
                rawShareBase.trim().ifEmpty { Store.DEFAULT_SHARE_BASE },
            )
            api.reloadClient()
            try {
                val s = api.session()
                sessionInfo = s
                applySessionFeatures(s)
                postMessage("Connection OK" + if (s.authenticated) " — signed in as ${s.user?.name}" else "")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    /* ----------------------------------------------------------- admin */

    fun loadAdmin() {
        viewModelScope.launch {
            adminLoading = true
            try {
                adminData = api.listUsers()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            } finally {
                adminLoading = false
            }
        }
    }

    fun setRegistrationOpen(open: Boolean) {
        viewModelScope.launch {
            try {
                val now = api.setRegistrationOpen(open)
                adminData = adminData?.copy(registrationOpen = now)
                postMessage(if (now) "Registration opened" else "Registration closed")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    fun setUserAdmin(id: String, admin: Boolean) {
        viewModelScope.launch {
            try {
                api.setUserAdmin(id, admin)
                loadAdmin()
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    fun adminDeleteUser(id: String) {
        viewModelScope.launch {
            try {
                api.deleteUser(id)
                loadAdmin()
                postMessage("User deleted")
            } catch (e: Exception) {
                postMessage(Api.describeError(e))
            }
        }
    }

    companion object {
        fun factory(app: NotesApp): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppViewModel(app) as T
        }
    }
}
