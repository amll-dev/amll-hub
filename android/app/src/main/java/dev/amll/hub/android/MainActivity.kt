package dev.amll.hub.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.net.toUri
import dagger.hilt.android.AndroidEntryPoint
import dev.amll.hub.android.nav.AmllNavGraph
import dev.amll.hub.android.ui.theme.AmllHubTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    /** 扫码登录 deep link 携带的 ticket，null 表示无待处理请求 */
    private var pendingTicket by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingTicket = extractTicket(intent)

        setContent {
            AmllHubTheme {
                Surface(
                    color = MaterialTheme.colorScheme.background,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    AmllNavGraph(
                        pendingTicket = pendingTicket,
                        onTicketConsumed = { pendingTicket = null },
                    )
                }
            }
        }
    }

    /** 应用已在后台时再次扫码，走这里 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractTicket(intent)?.let { pendingTicket = it }
    }

    /** 从 amllhub://qrlogin?ticket=xxx 中取出 ticket */
    private fun extractTicket(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme != "amllhub") return null
        return data.getQueryParameter("ticket")?.takeIf { it.isNotBlank() }
            ?: data.toUri().lastPathSegment?.takeIf { it.isNotBlank() }
    }
}

