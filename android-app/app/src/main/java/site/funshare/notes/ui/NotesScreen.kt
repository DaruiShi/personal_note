package site.funshare.notes.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOff
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import site.funshare.notes.AppViewModel
import site.funshare.notes.Folder
import site.funshare.notes.Note
import site.funshare.notes.NotesLinks
import site.funshare.notes.Screen

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(vm: AppViewModel) {
    val context = LocalContext.current
    var query by rememberSaveable { mutableStateOf("") }
    var selectedTag by rememberSaveable { mutableStateOf<String?>(null) }
    var deleteTarget by remember { mutableStateOf<Note?>(null) }
    var actionTarget by remember { mutableStateOf<Note?>(null) }
    var moveTargetId by remember { mutableStateOf<String?>(null) }
    var newFolderOpen by remember { mutableStateOf(false) }
    var folderMenu by remember { mutableStateOf<site.funshare.notes.Folder?>(null) }

    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    fun closeDrawer() { scope.launch { drawerState.close() } }

    BackHandler {
        when {
            drawerState.isOpen -> closeDrawer()
            query.isNotBlank() -> query = ""
            selectedTag != null -> selectedTag = null
            vm.selectedFolderId != null -> vm.selectedFolderId = null
            else -> (context as? Activity)?.moveTaskToBack(true)
        }
    }

    val allTags = remember(vm.notes) {
        vm.notes.flatMap { it.tags }.distinct().sorted()
    }

    val visible = remember(vm.notes, query, selectedTag, vm.selectedFolderId) {
        var list = vm.notes
        when (vm.selectedFolderId) {
            null -> {}
            "" -> list = list.filter { it.folderId == null }
            else -> list = list.filter { it.folderId == vm.selectedFolderId }
        }
        selectedTag?.let { t -> list = list.filter { it.tags.contains(t) } }
        if (query.isNotBlank()) {
            val q = query.trim()
            list = list.filter {
                it.title.contains(q, true) ||
                    it.content.contains(q, true) ||
                    it.tags.any { t -> t.contains(q, true) }
            }
        }
        list
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                FolderDrawerContent(
                    noteCount = vm.notes.size,
                    unfiledCount = vm.notes.count { it.folderId == null },
                    folders = vm.orderedFolders,
                    selectedFolderId = vm.selectedFolderId,
                    onSelect = { id ->
                        vm.selectedFolderId = id
                        closeDrawer()
                    },
                    onNewFolder = {
                        closeDrawer()
                        newFolderOpen = true
                    },
                    onFolderMenu = { folderMenu = it },
                )
            }
        },
    ) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            floatingActionButton = {
                ExtendedFloatingActionButton(
                    onClick = { vm.openEditor("new") },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("New", fontWeight = FontWeight.SemiBold) },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = AppShapes.pill,
                )
            },
        ) { padding ->
            PullToRefreshBox(
                isRefreshing = vm.refreshing,
                onRefresh = { vm.refresh() },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                Column(Modifier.fillMaxSize()) {
                    /* ------------------------------ header */
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = 4.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(
                                Icons.Filled.Menu,
                                contentDescription = "Folders",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Column(Modifier.weight(1f)) {
                            Text("Notes", style = MaterialTheme.typography.headlineMedium)
                            Text(
                                when {
                                    vm.selectedFolderId != null -> {
                                        val name = when (vm.selectedFolderId) {
                                            "" -> "Unfiled"
                                            else -> vm.folders
                                                .firstOrNull { it.id == vm.selectedFolderId }
                                                ?.name ?: "Folder"
                                        }
                                        "$name · ${visible.size} notes"
                                    }
                                    vm.notes.isEmpty() -> "Empty and ready"
                                    else -> {
                                        val local = vm.notes.count { it.isLocal }
                                        val base = "${vm.notes.size} notes"
                                        if (local > 0) "$base · $local waiting to sync" else base
                                    }
                                },
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (vm.user?.isAdmin == true) {
                            IconButton(onClick = { vm.navigate(Screen.Admin); vm.loadAdmin() }) {
                                Icon(
                                    Icons.Filled.AdminPanelSettings,
                                    contentDescription = "Manage users",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        IconButton(onClick = { vm.openDailyNote(NotesLinks.localDateKey(java.util.Date())) }) {
                            Icon(
                                Icons.Filled.Event,
                                contentDescription = "Today's note",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { vm.newTimelineNote() }) {
                            Icon(
                                Icons.Filled.Timeline,
                                contentDescription = "New timeline note",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { vm.newGalleryNote() }) {
                            Icon(
                                Icons.Filled.GridView,
                                contentDescription = "New gallery note",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { vm.navigate(Screen.Settings) }) {
                            Icon(
                                Icons.Filled.Settings,
                                contentDescription = "Settings",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    /* ------------------------------ search pill */
                    SearchPill(
                        query = query,
                        onQuery = { query = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 6.dp),
                    )

                    if (vm.offline) OfflineBanner()

                    /* ------------------------------ tag filter */
                if (allTags.isNotEmpty()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterPill(
                            label = "All",
                            selected = selectedTag == null,
                            onClick = { selectedTag = null },
                        )
                        allTags.forEach { tag ->
                            TagChip(
                                tag = tag,
                                selected = selectedTag == tag,
                                onClick = { selectedTag = if (selectedTag == tag) null else tag },
                            )
                        }
                    }
                }

                /* ------------------------------ list */
                when {
                    vm.notes.isEmpty() && vm.refreshing ->
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }

                    visible.isEmpty() -> EmptyList(
                        filtered = !selectedTag.isNullOrEmpty() || query.isNotBlank(),
                        onNew = { vm.openEditor("new") },
                    )

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 20.dp, end = 20.dp, top = 6.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(visible, key = { it.id }) { note ->
                            NoteCard(
                                note = note,
                                folderName = note.folderId
                                    ?.let { vm.folderName(it) }
                                    ?.ifEmpty { null },
                                modifier = Modifier.animateItem(),
                                onClick = { vm.openEditor(note.id) },
                                onLongClick = { actionTarget = note },
                            )
                        }
                    }
                }
            }
        }
        }
    }

    deleteTarget?.let { note ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete note?") },
            text = { Text(note.title.ifBlank { noteSnippet(note.content, 60) }.ifBlank { "This note" }) },
            confirmButton = {
                TextButton(onClick = {
                    vm.deleteNote(note.id)
                    deleteTarget = null
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancel") } },
        )
    }

    actionTarget?.let { note ->
        AlertDialog(
            onDismissRequest = { actionTarget = null },
            title = { Text(note.title.ifBlank { "Untitled" }) },
            text = { Text("Choose an action for this note.") },
            confirmButton = {
                TextButton(onClick = {
                    moveTargetId = note.id
                    actionTarget = null
                }) { Text("Move to folder…") }
            },
            dismissButton = {
                TextButton(onClick = {
                    deleteTarget = note
                    actionTarget = null
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
        )
    }

    if (newFolderOpen) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { newFolderOpen = false },
            title = { Text("New folder") },
            text = {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(64) },
                    singleLine = true,
                    shape = AppShapes.field,
                    placeholder = { Text("Folder name") },
                )
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank() && !vm.busy,
                    onClick = {
                        vm.createFolder(name) { newFolderOpen = false }
                    },
                ) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { newFolderOpen = false }) { Text("Cancel") } },
        )
    }

    folderMenu?.let { picked ->
        // Read the live folder so pin/move actions update the dialog instantly.
        val folder = vm.folders.firstOrNull { it.id == picked.id } ?: picked
        var rename by remember(folder.id) { mutableStateOf(folder.name) }
        val canMoveUp = vm.folderNeighbour(folder.id, -1) != null
        val canMoveDown = vm.folderNeighbour(folder.id, 1) != null
        AlertDialog(
            onDismissRequest = { folderMenu = null },
            title = { Text("Folder \"${folder.name}\"") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = rename,
                        onValueChange = { rename = it.take(64) },
                        singleLine = true,
                        shape = AppShapes.field,
                        label = { Text("Name") },
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { vm.setFolderPinned(folder.id, !folder.pinned) }) {
                            Icon(
                                Icons.Filled.PushPin,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = if (folder.pinned) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text(if (folder.pinned) "Unpin" else "Pin to top")
                        }
                        Spacer(Modifier.weight(1f))
                        IconButton(
                            enabled = canMoveUp,
                            onClick = { vm.moveFolder(folder.id, -1) },
                        ) {
                            Icon(
                                Icons.Filled.ArrowUpward,
                                contentDescription = "Move up",
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        IconButton(
                            enabled = canMoveDown,
                            onClick = { vm.moveFolder(folder.id, 1) },
                        ) {
                            Icon(
                                Icons.Filled.ArrowDownward,
                                contentDescription = "Move down",
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                    Text(
                        "Pinned folders are listed above the others. Up/Down reorders folders within their own group.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                Row {
                    TextButton(
                        enabled = rename.isNotBlank() && rename.trim() != folder.name && !vm.busy,
                        onClick = {
                            vm.renameFolder(folder.id, rename)
                            folderMenu = null
                        },
                    ) { Text("Rename") }
                    TextButton(
                        enabled = !vm.busy,
                        onClick = {
                            vm.deleteFolder(folder.id)
                            folderMenu = null
                        },
                    ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            },
            dismissButton = { TextButton(onClick = { folderMenu = null }) { Text("Cancel") } },
        )
    }

    moveTargetId?.let { noteId ->
        MoveNoteDialog(
            vm = vm,
            noteId = noteId,
            onDismiss = { moveTargetId = null },
        )
    }
}

/**
 * Drawer content: a fixed header, a scrollable list (All notes, Unfiled and
 * every folder) and a fixed "New folder" footer. The list must scroll — with
 * many folders the rows below the fold were unreachable before v1.16.
 */
@Composable
internal fun FolderDrawerContent(
    noteCount: Int,
    unfiledCount: Int,
    folders: List<Folder>,
    selectedFolderId: String?,
    onSelect: (String?) -> Unit,
    onNewFolder: () -> Unit,
    onFolderMenu: (Folder) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Text("Funshare Notes", style = MaterialTheme.typography.titleLarge)
            Text(
                "$noteCount notes · ${folders.size} folders",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        HorizontalDivider()
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            NavigationDrawerItem(
                icon = { Icon(Icons.AutoMirrored.Filled.MenuBook, contentDescription = null) },
                label = { Text("All notes") },
                badge = { Text("$noteCount") },
                selected = selectedFolderId == null,
                onClick = { onSelect(null) },
                modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Filled.FolderOff, contentDescription = null) },
                label = { Text("Unfiled") },
                badge = { Text("$unfiledCount") },
                selected = selectedFolderId == "",
                onClick = { onSelect("") },
                modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
            )
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text(
                "FOLDERS",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 28.dp, bottom = 6.dp),
            )
            folders.forEach { folder ->
                NavigationDrawerItem(
                    icon = { Icon(Icons.Filled.Folder, contentDescription = null) },
                    label = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                folder.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (folder.pinned) {
                                Spacer(Modifier.size(4.dp))
                                Icon(
                                    Icons.Filled.PushPin,
                                    contentDescription = "Pinned",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(12.dp),
                                )
                            }
                        }
                    },
                    badge = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                "${folder.noteCount}",
                                style = MaterialTheme.typography.labelMedium,
                            )
                            IconButton(
                                onClick = { onFolderMenu(folder) },
                                modifier = Modifier.size(26.dp),
                            ) {
                                Icon(
                                    Icons.Filled.MoreVert,
                                    contentDescription = "Folder options",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                        }
                    },
                    selected = selectedFolderId == folder.id,
                    onClick = { onSelect(folder.id) },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )
            }
            Spacer(Modifier.height(8.dp))
        }
        HorizontalDivider()
        NavigationDrawerItem(
            icon = { Icon(Icons.Filled.CreateNewFolder, contentDescription = null) },
            label = { Text("New folder") },
            selected = false,
            onClick = onNewFolder,
            modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
        )
    }
}

/**
 * Folder picker: choose Unfiled or one of the folders, or type a name to
 * create a folder and move the note there in one step.
 */
@Composable
internal fun MoveNoteDialog(vm: AppViewModel, noteId: String, onDismiss: () -> Unit) {
    var newFolder by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move to folder") },
        text = {
            Column(Modifier.selectableGroup()) {
                TextButton(onClick = {
                    vm.moveNote(noteId, null)
                    onDismiss()
                }) {
                    Icon(Icons.Filled.FolderOff, contentDescription = null, Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Unfiled")
                }
                // Same order as the drawer (pinned first) and scrollable when
                // the account has many folders.
                Column(
                    Modifier
                        .heightIn(max = 320.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    vm.orderedFolders.forEach { folder ->
                        TextButton(onClick = {
                            vm.moveNote(noteId, folder.id)
                            onDismiss()
                        }) {
                            Icon(
                                if (folder.pinned) Icons.Filled.PushPin else Icons.Filled.Folder,
                                contentDescription = null,
                                Modifier.size(18.dp),
                            )
                            Spacer(Modifier.size(8.dp))
                            Text(
                                folder.name +
                                    if (folder.noteCount > 0) "  ·  ${folder.noteCount}" else "",
                            )
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = newFolder,
                    onValueChange = { newFolder = it.take(64) },
                    singleLine = true,
                    shape = AppShapes.field,
                    placeholder = { Text("New folder name") },
                )
                TextButton(
                    enabled = newFolder.isNotBlank() && !vm.busy,
                    onClick = {
                        vm.createFolder(newFolder.trim()) { id ->
                            if (id != null) vm.moveNote(noteId, id)
                            onDismiss()
                        }
                    },
                ) { Text("Create and move") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SearchPill(query: String, onQuery: (String) -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .background(MaterialTheme.colorScheme.surfaceContainerLow, AppShapes.pill)
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.size(10.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text(
                        "Search notes",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQuery,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (query.isNotEmpty()) {
                Spacer(Modifier.size(6.dp))
                IconButton(
                    onClick = { onQuery("") },
                    modifier = Modifier.size(24.dp),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Clear search",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.surfaceContainerLow
    val fg = if (selected) MaterialTheme.colorScheme.onPrimary
    else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(onClick = onClick, shape = AppShapes.pill, color = bg) {
        Text(
            label,
            Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = fg,
        )
    }
}

@Composable
private fun OfflineBanner() {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Filled.CloudOff,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiaryContainer,
                modifier = Modifier.size(18.dp),
            )
            Text(
                "Offline — showing notes on this phone. Changes sync later.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

@Composable
private fun EmptyList(filtered: Boolean, onNew: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier
                .size(88.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerLow, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.MenuBook,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(38.dp),
            )
        }
        Spacer(Modifier.height(18.dp))
        Text(
            if (filtered) "Nothing found" else "No notes yet",
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            if (filtered) "Try a different search or filter"
            else "Capture a thought before it disappears",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (!filtered) {
            Spacer(Modifier.height(20.dp))
            TextButton(onClick = onNew) { Text("Write your first note") }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NoteCard(
    note: Note,
    modifier: Modifier = Modifier,
    folderName: String? = null,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        shape = AppShapes.card,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (note.pinned) {
                    Icon(
                        Icons.Filled.PushPin,
                        contentDescription = "Pinned",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.size(6.dp))
                }
                Text(
                    note.title.ifBlank { "Untitled" },
                    style = MaterialTheme.typography.titleMedium,
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    formatNoteTime(note.updatedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (note.content.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    noteSnippet(note.content),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (folderName != null || note.tags.isNotEmpty() || note.isLocal) {
                Spacer(Modifier.height(10.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (folderName != null) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            Icon(
                                Icons.Filled.Folder,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.tertiary,
                                modifier = Modifier.size(13.dp),
                            )
                            Text(
                                folderName,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.tertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    if (note.isLocal) {
                        Text(
                            "not synced",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                    note.tags.take(3).forEach { tag -> TagChip(tag = tag) }
                    if (note.tags.size > 3) {
                        Text(
                            "+${note.tags.size - 3}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
