package com.deeparam.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.deeparam.wear.ui.DeepARAMWearApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val store: WatchStore by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContent { DeepARAMWearApp(store) }
        // Coming back to the app refreshes a copy older than an hour.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) { store.refreshIfStale() }
        }
    }
}
