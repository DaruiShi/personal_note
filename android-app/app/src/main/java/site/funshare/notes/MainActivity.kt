package site.funshare.notes

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import site.funshare.notes.ui.AdminScreen
import site.funshare.notes.ui.EditScreen
import site.funshare.notes.ui.FunshareTheme
import site.funshare.notes.ui.LoginScreen
import site.funshare.notes.ui.NotesScreen
import site.funshare.notes.ui.SettingsScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val vm: AppViewModel = viewModel(factory = AppViewModel.factory(application as NotesApp))
            FunshareTheme(vm.themeMode) {
                AppRoot(vm)
            }
        }
    }
}

@Composable
fun AppRoot(vm: AppViewModel) {
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(vm.message) {
        val msg = vm.message
        if (msg != null) {
            snackbar.showSnackbar(msg)
            vm.message = null
        }
    }

    MaterialTheme(colorScheme = MaterialTheme.colorScheme) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            containerColor = MaterialTheme.colorScheme.background,
        ) { padding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                AnimatedContent(
                    targetState = vm.backStack.lastOrNull(),
                    transitionSpec = {
                        (fadeIn(tween(220)) + slideInVertically(tween(220)) { it / 24 })
                            .togetherWith(fadeOut(tween(160)) + slideOutVertically(tween(160)) { it / 24 })
                    },
                    label = "screen",
                ) { screen ->
                    when (screen) {
                        null, Screen.Login -> LoginScreen(vm)
                        Screen.Notes -> NotesScreen(vm)
                        Screen.Edit -> EditScreen(vm)
                        Screen.Settings -> SettingsScreen(vm)
                        Screen.Admin -> AdminScreen(vm)
                    }
                }
                if (vm.booting) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
            }
        }
    }
}
