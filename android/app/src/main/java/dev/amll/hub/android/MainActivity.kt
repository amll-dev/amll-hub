package dev.amll.hub.android

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import dev.amll.hub.android.nav.AmllNavGraph
import dev.amll.hub.android.ui.theme.AmllHubTheme
import java.io.File

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    /** 扫码登录 deep link 携带的 ticket，null 表示无待处理请求 */
    private var pendingTicket by mutableStateOf<String?>(null)

    /** 上次崩溃的堆栈，非空时启动后弹窗显示 */
    private var crashReport by mutableStateOf<String?>(null)

    /** Android 13+ 媒体通知需要运行时授权，否则系统播控看不到 */
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* 拒绝也不影响播放，只是没有通知栏 */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingTicket = extractTicket(intent)
        crashReport = readCrashReport()
        requestNotificationPermission()

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
                    crashReport?.let { text ->
                        CrashReportDialog(text) {
                            crashReport = null
                            File(filesDir, AmllHubApp.CRASH_FILE).delete()
                        }
                    }
                }
            }
        }
    }

    private fun readCrashReport(): String? = runCatching {
        File(filesDir, AmllHubApp.CRASH_FILE).takeIf { it.exists() }?.readText()?.takeIf { it.isNotBlank() }
    }.getOrNull()

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
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
            ?: data.lastPathSegment?.takeIf { it.isNotBlank() }
    }
}

/** 崩溃堆栈弹窗：可长按选中，也可以一键复制 */
@Composable
private fun CrashReportDialog(text: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(16.dp),
        ) {
            Text("上次崩溃的堆栈", style = MaterialTheme.typography.titleMedium)
            SelectionContainer {
                Text(
                    text,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 400.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(vertical = 8.dp),
                )
            }
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                TextButton(onClick = {
                    runCatching {
                        context.getSystemService(Context.CLIPBOARD_SERVICE)
                            .let { it as? ClipboardManager }
                            ?.setPrimaryClip(ClipData.newPlainText("crash", text))
                    }
                    onDismiss()
                }) { Text("复制并关闭") }
            }
        }
    }
}

