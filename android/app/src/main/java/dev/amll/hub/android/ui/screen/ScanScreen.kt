package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.ErrorBanner
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.QrScannerView
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/**
 * 扫一扫：扫网页端登录弹窗的二维码，确认后网页自动登录。
 */
@Composable
fun ScanScreen(
    onBack: () -> Unit,
    onDone: () -> Unit,
    /** deep link 直接带入的 ticket，非空时跳过扫描器直接弹确认框 */
    initialTicket: String? = null,
    viewModel: ScanViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(initialTicket) {
        initialTicket?.takeIf { it.isNotBlank() }?.let(viewModel::onScanned)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AmllTopBar("扫一扫", onBack = onBack) {
            Text("授权网页登录", style = Font.caption, color = Amll.colors.ink3)
        }

        val current = state
        when (current) {
            is ScanState.AwaitingConfirm, is ScanState.Submitting, is ScanState.Success -> {
                // 授权流程中把取景框换成状态提示，避免相机常驻耗电
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(220.dp)
                        .clip(RoundedCornerShape(Radius.sheet))
                        .background(Amll.colors.surface2),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when (current) {
                            is ScanState.Success -> "已授权"
                            is ScanState.Submitting -> "正在确认…"
                            else -> "已扫码，等待确认"
                        },
                        style = Font.bodyMedium,
                        color = Amll.colors.ink2,
                    )
                }
            }

            else -> {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(Radius.sheet)),
                ) {
                    QrScannerView(onQrScanned = viewModel::onScanned)
                }
                Text(
                    "把网页端登录弹窗里的二维码放进取景框",
                    style = Font.caption,
                    color = Amll.colors.ink3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state is ScanState.Error) {
            ErrorBanner((state as ScanState.Error).message)
        }

        Spacer(Modifier.height(2.dp))
        GhostButton("返回", onClick = onBack)
    }

    // 扫码成功 → 确认授权
    val awaiting = state as? ScanState.AwaitingConfirm
    if (awaiting != null) {
        ScanDialog(title = "确认授权", description = "是否允许当前账号登录 AMLL Hub 网页端？确认后网页会自动完成登录。") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("取消", onClick = viewModel::cancel, modifier = Modifier.weight(1f))
                PrimaryButton("确认登录", onClick = viewModel::confirm, modifier = Modifier.weight(1f))
            }
        }
    }

    if (state is ScanState.Submitting) {
        Dialog(onDismissRequest = {}) {
            Column(
                Modifier
                    .clip(RoundedCornerShape(Radius.sheet))
                    .background(Amll.colors.surface)
                    .padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                    color = Amll.colors.primary,
                )
                Text("正在确认…", style = Font.caption, color = Amll.colors.ink3)
            }
        }
    }

    val success = state as? ScanState.Success
    if (success != null) {
        ScanDialog(title = "已授权", description = success.profile?.let {
            "已允许 ${it.displayName.ifBlank { it.name }} 登录网页端"
        } ?: "网页端登录成功") {
            PrimaryButton("完成", onClick = onDone)
        }
    }
}

@Composable
private fun ScanDialog(
    title: String,
    description: String,
    content: @Composable () -> Unit,
) {
    Dialog(onDismissRequest = {}) {
        Column(
            Modifier
                .clip(RoundedCornerShape(Radius.sheet))
                .background(Amll.colors.surface)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, style = Font.sheetTitle, color = Amll.colors.ink)
            Text(description, style = Font.caption, color = Amll.colors.ink3)
            Spacer(Modifier.height(2.dp))
            content()
        }
    }
}
