package dev.amll.hub.android.ui.screen

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import dev.amll.hub.android.ui.component.QrScannerView
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/**
 * 扫一扫：整屏取景 + 中间扫描窗 + 底部两个圆形入口。
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
    val context = LocalContext.current
    var galleryError by remember { mutableStateOf<String?>(null) }
    var showCard by remember { mutableStateOf(false) }
    val profile by viewModel.profile.collectAsStateWithLifecycle()

    LaunchedEffect(initialTicket) {
        initialTicket?.takeIf { it.isNotBlank() }?.let(viewModel::onScanned)
    }
    LaunchedEffect(Unit) { viewModel.loadProfile() }

    // 相册识别：选一张图丢给 ML Kit，识别到二维码就当成扫到处理
    val galleryPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val image = runCatching { InputImage.fromFilePath(context, uri) }.getOrNull()
        if (image == null) {
            galleryError = "这张图片读不出来"
            return@rememberLauncherForActivityResult
        }
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
        scanner.process(image)
            .addOnSuccessListener { codes ->
                val value = codes.firstOrNull()?.rawValue
                if (value.isNullOrBlank()) galleryError = "图里没有识别到二维码" else viewModel.onScanned(value)
            }
            .addOnFailureListener { galleryError = "识别失败，换张图试试" }
            .addOnCompleteListener { scanner.close() }
    }

    // 授权流程中关掉取景框，避免相机常驻
    val showCamera = state !is ScanState.AwaitingConfirm &&
        state !is ScanState.Submitting &&
        state !is ScanState.Success

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (showCamera) {
            QrScannerView(
                onQrScanned = viewModel::onScanned,
                modifier = Modifier.fillMaxSize(),
            )
        }

        // 顶部：返回 + 标题
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(56.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Rounded.ChevronLeft,
                "返回",
                tint = Color.White,
                modifier = Modifier.size(28.dp).clickable(onClick = onBack),
            )
            Text(
                "扫描二维码",
                style = Font.navTitle.copy(fontSize = 19.sp, fontWeight = FontWeight.SemiBold),
                color = Color.White,
                modifier = Modifier.weight(1f),
            )
            // 与返回键等宽，标题才真正居中
            Spacer(Modifier.size(28.dp))
        }

        // 中间：上下扫动的高亮线，颜色跟随站点主题色
        if (showCamera) {
            val transition = rememberInfiniteTransition(label = "scan")
            val progress by transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(2400, easing = LinearEasing),
                    repeatMode = RepeatMode.Restart,
                ),
                label = "scanProgress",
            )
            // 颜色取主题色再往白里调，避免饱和度过高
            val base = Amll.colors.primary
            val lineColor = lerp(base, Color.White, 0.55f)
            val glowCore = lerp(base, Color.White, 0.42f)
            val glowMid = lerp(base, Color.White, 0.15f)

            Box(
                Modifier
                    .fillMaxSize()
                    // 扫描线跑在「顶栏下沿 → 底部按钮上沿」之间
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .navigationBarsPadding()
                    .padding(top = 56.dp, bottom = 140.dp)
                    // 光带会溢出节点边界，裁掉才不会糊到标题和按钮上
                    .clipToBounds()
                    .drawBehind {
                        val y = size.height * progress
                        val radius = size.width * 0.55f

                        // 还原设计稿：一条横贯屏幕的椭圆光晕，
                        // 做法是把圆形径向渐变纵向压扁（1 : 0.16）
                        scale(scaleX = 1f, scaleY = 0.16f, pivot = Offset(size.width / 2f, y)) {
                            drawRect(
                                brush = Brush.radialGradient(
                                    colors = listOf(
                                        glowCore.copy(alpha = 0.75f),
                                        glowMid.copy(alpha = 0.30f),
                                        Color.Transparent,
                                    ),
                                    center = Offset(size.width / 2f, y),
                                    radius = radius,
                                ),
                                topLeft = Offset(0f, y - radius),
                                size = Size(size.width, radius * 2f),
                            )
                        }

                        // 中心的细亮线
                        drawRect(
                            color = lineColor.copy(alpha = 0.9f),
                            topLeft = Offset(0f, y - 0.6.dp.toPx()),
                            size = Size(size.width, 1.2.dp.toPx()),
                        )
                    },
            )
        }

        // 状态提示（授权 / 错误）
        val hint = when (val s = state) {
            is ScanState.AwaitingConfirm -> "已扫码，等待确认"
            is ScanState.Submitting -> "正在确认…"
            is ScanState.Success -> "已授权"
            is ScanState.Error -> s.message
            else -> galleryError
        }
        if (hint != null) {
            Text(
                hint,
                style = Font.caption,
                color = if (state is ScanState.Error || galleryError != null) Amll.colors.warning else Color.White.copy(alpha = 0.8f),
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 40.dp),
            )
        }

        // 底部两个圆形入口
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(start = 56.dp, end = 56.dp, bottom = 56.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            ScanAction(
                label = "我的名片",
                icon = { tint ->
                    Icon(Icons.Rounded.Badge, null, tint = tint, modifier = Modifier.size(24.dp))
                },
                onClick = { showCard = true },
            )
            ScanAction(
                label = "相册",
                icon = { tint ->
                    Icon(Icons.Rounded.PhotoLibrary, null, tint = tint, modifier = Modifier.size(24.dp))
                },
                onClick = {
                    galleryError = null
                    galleryPicker.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                },
            )
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
    }

    // 扫码成功 → 确认授权
    val awaiting = state as? ScanState.AwaitingConfirm
    if (awaiting != null) {
        ScanDialog(
            title = "确认授权",
            description = "是否允许当前账号登录 AMLL Hub 网页端？确认后网页会自动完成登录。",
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ScanDialogButton(
                    text = "取消",
                    primary = false,
                    onClick = viewModel::cancel,
                    modifier = Modifier.weight(1f),
                )
                ScanDialogButton(
                    text = "确认登录",
                    primary = true,
                    onClick = viewModel::confirm,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }

    val success = state as? ScanState.Success
    if (success != null) {
        ScanDialog(
            title = "已授权",
            description = success.profile?.let {
                "已允许 ${it.displayName.ifBlank { it.name }} 登录网页端"
            } ?: "网页端登录成功",
        ) {
            ScanDialogButton(
                text = "完成",
                primary = true,
                onClick = onDone,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    // 我的名片：先展示当前账号信息，二维码功能还没接
    if (showCard) {
        ScanDialog(title = "我的名片", description = "当前登录的 AMLL Hub 账号") {
            Text(
                profile?.displayName?.ifBlank { profile?.name.orEmpty() } ?: "未登录",
                style = Font.sheetTitle,
                color = Amll.colors.ink,
            )
            Text(
                profile?.name?.takeIf { it.isNotBlank() }?.let { "@$it" } ?: "—",
                style = Font.caption,
                color = Amll.colors.ink3,
            )
            ScanDialogButton(
                text = "关闭",
                primary = false,
                onClick = { showCard = false },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** 底部圆形入口：深灰圆 + 白色图标 + 小字 */
@Composable
private fun ScanAction(
    label: String,
    icon: @Composable (Color) -> Unit,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Box(
            Modifier
                .size(58.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            icon(Color.White)
        }
        Text(label, style = Font.micro.copy(fontSize = 11.sp), color = Color.White)
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

@Composable
private fun ScanDialogButton(
    text: String,
    primary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .height(46.dp)
            .clip(RoundedCornerShape(Radius.chip))
            .background(if (primary) Amll.colors.primary else Amll.colors.surface2)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = Font.bodyMedium,
            color = if (primary) Amll.colors.onPrimary else Amll.colors.ink2,
        )
    }
}
