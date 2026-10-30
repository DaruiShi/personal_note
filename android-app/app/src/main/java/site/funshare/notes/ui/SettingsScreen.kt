package site.funshare.notes.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.HowToReg
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.funshare.notes.AppViewModel
import site.funshare.notes.NotesApp
import site.funshare.notes.Store
import site.funshare.notes.ThemeMode
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SettingsScreen(vm: AppViewModel) {
    val context = LocalContext.current
    val store = remember { (context.applicationContext as NotesApp).store }

    var serverUrl by rememberSaveable { mutableStateOf(store.serverUrl) }
    var trustAll by rememberSaveable { mutableStateOf(store.trustAllCerts) }
    var shareBase by rememberSaveable { mutableStateOf(store.shareLinkBase) }
    var passwordOpen by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    var logoutAllConfirm by remember { mutableStateOf(false) }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri != null) {
            try {
                val json = Store.notesToJson(vm.notes.filterNot { it.isLocal })
                val payload = "{\"exportedAt\":${System.currentTimeMillis()},\"notes\":$json}"
                context.contentResolver.openOutputStream(uri)?.use { out ->
                    out.write(payload.toByteArray(Charsets.UTF_8))
                }
                vm.postMessage("Backup saved")
            } catch (e: Exception) {
                vm.postMessage("Backup failed: ${e.message}")
            }
        }
    }

    BackHandler { vm.back() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        /* ------------------------------ header */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 8.dp, top = 24.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Settings", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Signed in as ${vm.user?.name ?: "—"}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        /* ------------------------------ account card */
        GroupCard {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                InitialAvatar(vm.user?.name ?: "?")
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            vm.user?.name ?: "—",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (vm.user?.isAdmin == true) {
                            Spacer(Modifier.size(8.dp))
                            Badge("ADMIN")
                        }
                    }
                    Text(
                        "Personal account",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            InsetDivider()
            SettingsRow(
                icon = Icons.Filled.Key,
                title = "Change password",
                onClick = { passwordOpen = true },
            )
            if (vm.user?.isAdmin == true) {
                InsetDivider()
                SettingsRow(
                    icon = Icons.Filled.AdminPanelSettings,
                    title = "Manage users",
                    onClick = { vm.navigate(site.funshare.notes.Screen.Admin); vm.loadAdmin() },
                )
            }
        }

        Spacer(Modifier.height(8.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = { vm.logout() },
                shape = AppShapes.pill,
                modifier = Modifier.weight(1f),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout,
                    contentDescription = null,
                    Modifier.size(16.dp),
                )
                Spacer(Modifier.size(6.dp))
                Text("Sign out")
            }
            OutlinedButton(
                onClick = { logoutAllConfirm = true },
                shape = AppShapes.pill,
                modifier = Modifier.weight(1f),
            ) { Text("Sign out everywhere") }
        }

        SectionLabel("Server")
        GroupCard {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Address") },
                    singleLine = true,
                    shape = AppShapes.field,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = shareBase,
                    onValueChange = { shareBase = it },
                    label = { Text("Public share link base") },
                    supportingText = { Text("Used when building note share links") },
                    singleLine = true,
                    shape = AppShapes.field,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.Dns,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.size(10.dp))
                    Text(
                        "Trust all certificates",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(checked = trustAll, onCheckedChange = { trustAll = it })
                }
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = { vm.saveServerConfig(serverUrl, trustAll, shareBase) },
                    shape = AppShapes.pill,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Filled.CloudDone, contentDescription = null, Modifier.size(16.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Save & test connection")
                }
            }
        }

        SectionLabel("Appearance")
        GroupCard {
            Column(Modifier.padding(16.dp)) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    ThemeMode.entries.forEachIndexed { i, mode ->
                        SegmentedButton(
                            selected = vm.themeMode == mode,
                            onClick = { vm.applyThemeMode(mode) },
                            shape = SegmentedButtonDefaults.itemShape(
                                index = i,
                                count = ThemeMode.entries.size,
                            ),
                        ) { Text(mode.label) }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    "Preview text size",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    val sizes = listOf(0.85f to "Small", 1f to "Default", 1.2f to "Large", 1.4f to "Huge")
                    sizes.forEachIndexed { i, (scale, label) ->
                        SegmentedButton(
                            selected = vm.previewFontScale == scale,
                            onClick = { vm.applyPreviewFontScale(scale) },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = sizes.size),
                        ) { Text(label) }
                    }
                }
            }
        }

        SectionLabel("Data")
        GroupCard {
            SettingsRow(
                icon = Icons.Filled.Delete,
                title = "Trash",
                subtitle = "Restore or permanently delete notes",
                onClick = { vm.navigate(site.funshare.notes.Screen.Trash); vm.loadTrash() },
            )
            InsetDivider()
            SettingsRow(
                icon = Icons.Filled.Download,
                title = "Export backup (JSON)",
                subtitle = "All synced notes as one file",
                onClick = {
                    val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.getDefault()).format(Date())
                    exportLauncher.launch("funshare-notes-$stamp.json")
                },
            )
        }

        SectionLabel("Danger zone", color = MaterialTheme.colorScheme.error)
        GroupCard(container = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.35f)) {
            SettingsRow(
                icon = Icons.Filled.Delete,
                title = "Delete this account",
                subtitle = "Removes the account and all its notes",
                tint = MaterialTheme.colorScheme.error,
                onClick = { deleteOpen = true },
            )
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "Funshare Notes 1.19 · self-hosted notes",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
    }

    if (passwordOpen) {
        PasswordDialog(
            busy = vm.busy,
            onDismiss = { passwordOpen = false },
            onSubmit = { current, next, done -> vm.changePassword(current, next, done) },
        )
    }

    if (logoutAllConfirm) {
        AlertDialog(
            onDismissRequest = { logoutAllConfirm = false },
            title = { Text("Sign out everywhere?") },
            text = {
                Text(
                    "All devices signed in to this account (including this phone) will be signed out.",
                )
            },
            confirmButton = {
                TextButton(onClick = { logoutAllConfirm = false; vm.logoutEverywhere() }) {
                    Text("Sign out")
                }
            },
            dismissButton = { TextButton(onClick = { logoutAllConfirm = false }) { Text("Cancel") } },
        )
    }

    if (deleteOpen) {
        DeleteAccountDialog(
            onDismiss = { deleteOpen = false },
            busy = vm.busy,
            onDelete = { pwd -> deleteOpen = false; vm.deleteAccount(pwd) },
        )
    }
}

/* ------------------------------------------------------- pieces */

@Composable
private fun GroupCard(
    container: Color = MaterialTheme.colorScheme.surfaceContainerLow,
    content: @Composable () -> Unit,
) {
    Surface(
        color = container,
        shape = AppShapes.card,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
    ) { Column { content() } }
}

@Composable
private fun SectionLabel(
    text: String,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.8.sp,
        color = color,
        modifier = Modifier.padding(start = 32.dp, top = 20.dp, bottom = 8.dp),
    )
}

@Composable
private fun InsetDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 60.dp),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier
                .background(
                    MaterialTheme.colorScheme.surfaceContainerHigh,
                    RoundedCornerShape(10.dp),
                )
                .padding(8.dp)
                .size(18.dp),
        )
        Spacer(Modifier.size(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/* ------------------------------------------------------- dialogs */

@Composable
private fun PasswordDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (current: String, next: String, onDone: (Boolean) -> Unit) -> Unit,
) {
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Change password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = current,
                    onValueChange = { current = it },
                    label = { Text("Current password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    shape = AppShapes.field,
                )
                OutlinedTextField(
                    value = next,
                    onValueChange = { next = it },
                    label = { Text("New password (8+ chars)") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    shape = AppShapes.field,
                )
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("Repeat new password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    shape = AppShapes.field,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && current.isNotEmpty() && next.length >= 8,
                onClick = {
                    if (next != confirm) {
                        error = "New passwords don't match"
                    } else {
                        error = null
                        onSubmit(current, next) { ok -> if (ok) onDismiss() }
                    }
                },
            ) { Text("Change") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DeleteAccountDialog(
    onDismiss: () -> Unit,
    busy: Boolean,
    onDelete: (String) -> Unit,
) {
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete account?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("All your notes will be permanently deleted from the server.")
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    shape = AppShapes.field,
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && password.isNotEmpty(),
                onClick = { onDelete(password) },
            ) { Text("Delete forever", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
