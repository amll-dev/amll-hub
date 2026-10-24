package dev.amll.hub.android.ui.component

import android.graphics.Color as AndroidColor
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import dev.amll.hub.android.BuildConfig
import dev.amll.hub.android.data.remote.CaptchaConfig
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/**
 * 人机验证弹层。
 *
 * 阿里云验证码只接过网页端，这里用 WebView 加载 assets/captcha 里的桥接页，
 * 页面内跑官方 SDK，验证通过后把 verifyParam 回传原生，再与网页端一样带 token 发码。
 *
 * 注意：阿里云场景要求在控制台配置域名白名单，所以页面用站点域名作为 baseUrl 加载，
 * 而不是 appassets 的本地域，避免「非法域名」。
 */
@Composable
fun CaptchaDialog(
    config: CaptchaConfig,
    verified: Boolean?,
    sending: Boolean,
    error: String?,
    onToken: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val html = remember {
        runCatching {
            context.assets.open("captcha/index.html").bufferedReader().use { it.readText() }
        }.getOrElse { "" }
    }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(webView, loaded, verified) {
        if (loaded && verified != null) {
            webView?.evaluateJavascript("window.setCaptchaResult&&window.setCaptchaResult($verified)", null)
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
        shape = RoundedCornerShape(Radius.sheet),
        containerColor = Amll.colors.surface,
        modifier = Modifier.padding(horizontal = 12.dp),
        title = { Text("安全验证", style = Font.sheetTitle, color = Amll.colors.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "完成滑块验证后会自动发送验证码",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )

                Box(
                    Modifier
                        .fillMaxWidth()
                        // 阿里云 embed 模式拖动时会弹出拼图面板，高度留够才不会截断
                        .height(360.dp),
                ) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { ctx ->
                            WebView(ctx).apply {
                                setBackgroundColor(AndroidColor.TRANSPARENT)
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.useWideViewPort = false
                                settings.loadWithOverviewMode = false
                                webViewClient = object : WebViewClient() {
                                    override fun onPageFinished(view: WebView?, url: String?) {
                                        loaded = true
                                        // 页面脚本就绪后再下发场景配置，避免依赖 query 参数
                                        view?.evaluateJavascript(
                                            "window.startCaptcha&&window.startCaptcha(" +
                                                "${jsStringLiteral(config.sceneId)},${jsStringLiteral(config.prefix)})",
                                            null,
                                        )
                                    }
                                }
                                addJavascriptInterface(
                                    object {
                                        @JavascriptInterface
                                        fun onVerify(param: String) {
                                            onToken(param)
                                        }
                                    },
                                    "AmllCaptcha",
                                )
                                if (html.isBlank()) {
                                    loaded = true
                                } else {
                                    loadDataWithBaseURL(siteOrigin, html, "text/html", "utf-8", null)
                                }
                                webView = this
                            }
                        },
                    )
                    if (!loaded) {
                        CircularProgressIndicator(
                            modifier = Modifier.align(Alignment.Center).size(24.dp),
                            strokeWidth = 2.dp,
                            color = Amll.colors.primary,
                        )
                    }
                }

                if (sending) {
                    Text("验证已通过，正在发送验证码…", style = Font.micro, color = Amll.colors.ink3)
                } else if (error != null) {
                    Text(error, style = Font.micro, color = Amll.colors.warning)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭", style = Font.caption, color = Amll.colors.ink3)
            }
        },
    )
}

/** 站点根域：https://api.beta.example.com → https://beta.example.com/ */
private val siteOrigin: String
    get() {
        val base = BuildConfig.API_BASE_URL.trimEnd('/')
        // 先保住原始 scheme，避免把 http 调试地址误升成 https
        val scheme = when {
            base.startsWith("https://") -> "https://"
            base.startsWith("http://") -> "http://"
            else -> "https://"
        }
        val host = base.removePrefix("https://").removePrefix("http://")
        // api. 前缀是 Api 域名，验证码要求配置的是站点域名
        return scheme + host.removePrefix("api.") + "/"
    }

