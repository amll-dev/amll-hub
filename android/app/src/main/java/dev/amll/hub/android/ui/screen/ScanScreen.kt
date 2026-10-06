package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.component.ErrorBanner
import dev.amll.hub.android.ui.component.QrScannerView

/**
 * 扫码登录页：内嵌 CameraX + ML Kit 扫描器。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    onBack: () -> Unit,
    onDone: () -> Unit,
    /** deep link 直接带入的 ticket，非空时跳过扫描器直接弹确认框 */
    initialTicket: String? = null,
    viewModel: ScanViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // deep link 场景：已经拿到 ticket，直接进入确认态
    LaunchedEffect(initialTicket) {
        initialTicket?.takeIf { it.isNotBlank() }?.let(viewModel::onScanned)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫码登录") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Surface(
            color = MaterialTheme.colorScheme.background,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // state是by 委托属性，when 分支内无法 smart cast，先落到局部变量
            when (val current = state) {
                // 扫描器只在「等待扫码 / 出错重扫」时显示
                is ScanState.Idle -> ScannerPane(
                    errorMessage = null,
                    onQrScanned = viewModel::onScanned,
                    onDismissError = null,
                    onBack = onBack,
                )

                is ScanState.Error -> ScannerPane(
                    errorMessage = current.message,
                    onQrScanned = viewModel::onScanned,
                    onDismissError = viewModel::reset,
                    onBack = onBack,
                )

                // 确认 / 提交 / 成功都由弹窗接管，背景留空
                else -> Unit
            }
        }
    }

    // 扫码成功 → 确认授权
    val awaiting = state as? ScanState.AwaitingConfirm
    if (awaiting != null) {
        AlertDialog(
            onDismissRequest = viewModel::cancel,
            title = { Text("确认授权") },
            text = { Text("是否允许当前账号登录 AMLl Hub 网页端？确认后网页会自动完成登录。") },
            confirmButton = {
                TextButton(onClick = viewModel::confirm) { Text("确认登录") }
            },
            dismissButton = {
                TextButton(onClick = viewModel::cancel) { Text("取消") }
            },
        )
    }

    // 提交中
    if (state is ScanState.Submitting) {
        AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text("正在确认…")
                }
            },
        )
    }

    // 成功
    val success = state as? ScanState.Success
    if (success != null) {
        AlertDialog(
            onDismissRequest = {},
            confirmButton = { TextButton(onClick = onDone) { Text("完成") } },
            icon = {
                Icon(
                    imageVector = Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
            },
            title = { Text("已授权") },
            text = {
                Text(
                    success.profile
                        ?.let { "已允许 ${it.displayName.ifBlank { it.name }} 登录网页端" }
                        ?: "网页端登录成功"
                )
            },
        )
    }
}

@Composable
private fun ScannerPane(
    errorMessage: String?,
    onQrScanned: (String) -> Unit,
    onDismissError: (() -> Unit)?,
    onBack: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        if (errorMessage != null) {
            ErrorBanner(
                message = errorMessage,
                modifier = Modifier.padding(16.dp),
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f),
        ) {
            QrScannerView(onQrScanned = onQrScanned)
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
        ) {
            Text(
                text = "将 AMLl Hub 网页端登录弹窗的二维码放入框内",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            if (onDismissError != null) {
                Button(onClick = onDismissError, modifier = Modifier.fillMaxWidth()) {
                    Text("继续扫描")
                }
            }
            OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text("返回")
            }
        }
    }
}
