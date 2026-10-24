package dev.amll.hub.android.ui.component

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import dev.amll.hub.android.BuildConfig
import org.json.JSONObject

private const val TAG = "AmllLyricView"

/**
 * 歌词页实例跨导航保留。
 *
 * 之前 WebView 跟着 LyricScreen 的 composition 一起销毁，每次进歌词页都要
 * 重新加载页面、重新解析歌词，视觉上会闪一下。这里把实例缓存在进程级，
 * 重新进入时直接复用并在 composition 恢复后补推当前状态。
 */
private object LyricPageState {
    val webView = mutableStateOf<WebView?>(null)

    /** 页面 onPageFinished 之后才允许推数据 */
    val loaded = mutableStateOf(false)

    /** 渲染进程崩溃后换一个新实例，AndroidView 靠它重建 */
    val restart = mutableIntStateOf(0)

    /** 当前 composition 的命令处理器，页面 → 原生 都走这里 */
    val onCommand = mutableStateOf<((String, Double?) -> Unit)?>(null)
}

/**
 * 内置 AMLL 歌词页（assets/lyrics，AMLL core 构建产物）。
 *
 * 页面与网页端 LyricsPage 一致，只负责渲染与交互；时间轴由原生播放器驱动，
 * 页面上的播放/暂停、点歌词跳转、顶部拖动条退出、菜单按钮都通过 JS 接口回传。
 */
@Composable
fun AmllLyricView(
    /** 原始歌词文本，由页面用 AMLL 官方解析器解析（与网页端同款库） */
    rawLyric: String,
    /** "ttml" / "lrc" */
    lyricFormat: String,
    /** LRC 的翻译文本（tlyric） */
    lyricTranslation: String,
    positionMs: Long,
    playing: Boolean,
    title: String,
    artist: String,
    durationMs: Long,
    cover: String?,
    dark: Boolean,
    onTogglePlay: () -> Unit,
    onSeek: (Long) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val webView = LyricPageState.webView.value
    val loaded = LyricPageState.loaded.value
    val coverUrl = remember(cover) { cover.orEmpty() }
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    val dispatch: (String, Double?) -> Unit = remember(onTogglePlay, onSeek, onClose) {
        { command, value ->
            when (command) {
                "playPause" -> onTogglePlay()
                "seek" -> value?.let { onSeek(it.toLong()) }
                "close" -> onClose()
                // next / prev / shuffle / repeat / volume：当前播放器是单曲播放，暂不接
            }
        }
    }
    DisposableEffect(dispatch) {
        LyricPageState.onCommand.value = dispatch
        onDispose {
            if (LyricPageState.onCommand.value === dispatch) {
                LyricPageState.onCommand.value = null
            }
        }
    }

    LaunchedEffect(webView, loaded, rawLyric, lyricFormat, lyricTranslation) {
        if (loaded) {
            evalJs(webView, setRawLyricScript(rawLyric, lyricFormat, lyricTranslation))
        }
    }
    LaunchedEffect(webView, loaded, positionMs) {
        if (loaded) {
            webView?.evaluateJavascript(setTimeScript(positionMs), null)
        }
    }
    LaunchedEffect(webView, loaded, playing) {
        if (loaded) {
            evalJs(webView, "window.amllNative&&window.amllNative.setPlaying($playing)")
        }
    }
    LaunchedEffect(webView, loaded, title, artist, durationMs) {
        if (loaded) {
            evalJs(
                webView,
                "window.amllNative&&window.amllNative.setMeta(" +
                    "${jsStringLiteral(title)},${jsStringLiteral(artist)},${durationMs.coerceAtLeast(0)})",
            )
        }
    }
    LaunchedEffect(webView, loaded, coverUrl) {
        if (loaded) {
            evalJs(webView, "window.amllNative&&window.amllNative.setCover(${jsStringLiteral(coverUrl)})")
        }
    }
    LaunchedEffect(webView, loaded, dark) {
        if (loaded) {
            evalJs(webView, "window.amllNative&&window.amllNative.setTheme($dark)")
        }
    }

    Box(modifier = modifier) {
        key(LyricPageState.restart.intValue) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    if (BuildConfig.DEBUG) {
                        // 真机上可开 chrome://inspect 直接看页面
                        WebView.setWebContentsDebuggingEnabled(true)
                    }
                    LyricPageState.webView.value?.let { cached ->
                        // 重新进入歌词页：直接复用已加载好的页面
                        (cached.parent as? ViewGroup)?.removeView(cached)
                        cached
                    } ?: createPage(context.applicationContext, mainHandler).also { page ->
                        LyricPageState.webView.value = page
                        page.loadUrl(ASSET_URL)
                    }
                },
            )
        }
    }
}

/** 创建一个只有歌词页用得到的 WebView（只在首次进入时执行） */
private fun createPage(context: Context, mainHandler: Handler): WebView {
    val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()
    return WebView(context).apply {
        val self = this
        // 透明底，加载期间透出 Compose 的深色背景，避免白闪
        setBackgroundColor(android.graphics.Color.TRANSPARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // 让页面按设备宽度布局。不开这个的话 WebView 会按 980px 桌面宽度排版，
        // AMLL 面向移动端的尺寸/媒体查询全部失效，底部播控等会显示异常。
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.displayZoomControls = false
        settings.builtInZoomControls = false
        // 页面只从 assets 加载：禁掉本地文件访问与弹窗，缩小 JS 桥的可达面
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        // 页面上的操作回传（在 JS 线程回调，切回主线程再执行）
        addJavascriptInterface(
            object {
                @JavascriptInterface
                fun postMessage(json: String) {
                    val obj = runCatching { JSONObject(json) }.getOrNull() ?: return
                    val command = obj.optString("command")
                    val value = if (obj.has("value")) obj.optDouble("value") else null
                    mainHandler.post {
                        // 桥只服务资产页，外部页面即便混进来也调不动
                        if (self.url?.startsWith(ASSET_ORIGIN) == true) {
                            LyricPageState.onCommand.value?.invoke(command, value)
                        }
                    }
                }
            },
            "amllHost",
        )
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                // JS 接口不可用时的兜底：页面会退化成 "[amll-host] 命令 参数"
                val text = message.message()
                if (text.startsWith("[amll-host]")) {
                    val parts = text.removePrefix("[amll-host]").trim().split(WHITESPACE)
                    mainHandler.post {
                        if (self.url?.startsWith(ASSET_ORIGIN) == true) {
                            LyricPageState.onCommand.value?.invoke(
                                parts.firstOrNull().orEmpty(),
                                parts.getOrNull(1)?.toDoubleOrNull(),
                            )
                        }
                    }
                }
                return true
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                // 只放行资产页内部的跳转，外部链接一律拦掉
                return request?.url?.toString()?.startsWith(ASSET_ORIGIN) != true
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // 数据不在这里推：composition 里按 loaded 触发的 effect 会补推当前值，
                // 这样复用一个已加载的页面时也能立刻同步上。
                LyricPageState.loaded.value = true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame == true) {
                    Log.w(TAG, "load failed: ${request.url} ${error?.errorCode} ${error?.description}")
                }
            }

            /**
             * 渲染进程崩溃（OOM / 沙箱异常）时 WebViewClient 默认返回 false，
             * 系统会连同宿主 App 一起杀掉。这里返回 true 表示已自行处理，
             * 随后销毁坏实例并重建一个，歌词页只降级为一次重新加载。
             */
            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?,
            ): Boolean {
                Log.w(TAG, "render process gone, didCrash=${detail?.didCrash()}")
                LyricPageState.loaded.value = false
                LyricPageState.webView.value = null
                view?.let { dead ->
                    (dead.parent as? ViewGroup)?.removeView(dead)
                    dead.destroy()
                }
                LyricPageState.restart.intValue++
                return true
            }
        }
    }
}

private val WHITESPACE = Regex("\\s+")

private const val ASSET_ORIGIN = "https://appassets.androidplatform.net/assets/lyrics/"

private const val ASSET_URL = ASSET_ORIGIN + "index.html"

private fun setRawLyricScript(raw: String, format: String, translation: String) =
    "window.amllNative&&window.amllNative.setRawLyric(" +
        "${jsStringLiteral(raw)},${jsStringLiteral(format)},${jsStringLiteral(translation)})"

private fun setTimeScript(positionMs: Long) =
    "window.amllNative&&window.amllNative.setTime($positionMs)"

private fun evalJs(webView: WebView?, script: String) {
    webView?.evaluateJavascript(script, null)
}
