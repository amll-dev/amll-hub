package dev.amll.hub.android.ui.component

import android.os.Handler
import android.os.Looper
import android.util.Log
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import dev.amll.hub.android.BuildConfig
import dev.amll.hub.android.data.lyric.LyricLine
import dev.amll.hub.android.data.lyric.Word
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.json.JSONObject

private const val TAG = "AmllLyricView"

/** AMLL core 的歌词结构，直接由 kotlinx.serialization 产出，避免手拼 JSON */
@Serializable
private data class AmllWordDto(
    val word: String,
    val startTime: Long,
    val endTime: Long,
)

@Serializable
private data class AmllLineDto(
    val startTime: Long,
    val endTime: Long,
    val translatedLyric: String,
    val romanLyric: String,
    val isBG: Boolean,
    val words: List<AmllWordDto>,
)

private val lyricJson = Json.Default

/**
 * 内置 AMLL 歌词页（assets/lyrics，AMLL core 构建产物）。
 *
 * 页面与网页端 LyricsPage 一致，只负责渲染与交互；时间轴由原生播放器驱动，
 * 页面上的播放/暂停、点歌词跳转、顶部拖动条退出、菜单按钮都通过 JS 接口回传。
 */
@Composable
fun AmllLyricView(
    lines: List<LyricLine>,
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
    onOpenMenu: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var loaded by remember { mutableStateOf(false) }
    // 渲染进程崩溃后原 WebView 不可复用，递增一次就换一个新实例
    var rendererRestart by remember { mutableIntStateOf(0) }
    val linesJson = remember(lines) { lyricLinesToJson(lines) }
    val coverUrl = remember(cover) { cover.orEmpty() }
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    val dispatch: (String, Double?) -> Unit = remember(onTogglePlay, onSeek, onClose, onOpenMenu) {
        { command, value ->
            when (command) {
                "playPause" -> onTogglePlay()
                "seek" -> value?.let { onSeek(it.toLong()) }
                "close" -> onClose()
                "menu" -> onOpenMenu()
                // next / prev / shuffle / repeat / volume：当前播放器是单曲播放，暂不接
            }
        }
    }

    LaunchedEffect(webView, loaded, linesJson) {
        if (loaded && linesJson.isNotEmpty()) {
            evalJs(webView, setLinesScript(linesJson))
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
        key(rendererRestart) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    if (BuildConfig.DEBUG) {
                        // 真机上可开 chrome://inspect 直接看页面
                        WebView.setWebContentsDebuggingEnabled(true)
                    }
                    val assetLoader = WebViewAssetLoader.Builder()
                        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                        .build()
                    WebView(context).apply {
                        val self = this
                        // 透明底，加载期间透出 Compose 的深色背景，避免白闪
                        setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
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
                                            dispatch(command, value)
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
                                            dispatch(
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
                                loaded = true
                                // 已加载好的歌词 / 播放态在 onPageFinished 后补一次，防止加载期间丢事件
                                evalJs(view, "window.amllNative&&window.amllNative.setCover(${jsStringLiteral(coverUrl)})")
                                evalJs(view, "window.amllNative&&window.amllNative.setTheme($dark)")
                                if (linesJson.isNotEmpty()) {
                                    evalJs(view, setLinesScript(linesJson))
                                }
                                evalJs(view, "window.amllNative&&window.amllNative.setPlaying($playing)")
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
                                loaded = false
                                webView = null
                                view?.let { dead ->
                                    (dead.parent as? android.view.ViewGroup)?.removeView(dead)
                                    dead.destroy()
                                }
                                rendererRestart++
                                return true
                            }
                        }
                        loadUrl(ASSET_URL)
                        webView = this
                    }
                },
            )
        }
    }
}

private val WHITESPACE = Regex("\\s+")

private const val ASSET_ORIGIN = "https://appassets.androidplatform.net/assets/lyrics/"

private const val ASSET_URL = ASSET_ORIGIN + "index.html"

private fun setLinesScript(linesJson: String) =
    "window.amllNative&&window.amllNative.setLines(${jsStringLiteral(linesJson)})"

private fun setTimeScript(positionMs: Long) =
    "window.amllNative&&window.amllNative.setTime($positionMs)"

private fun evalJs(webView: WebView?, script: String) {
    webView?.evaluateJavascript(script, null)
}

/** 转成 AMLL core 需要的 LyricLine 结构 */
fun lyricLinesToJson(lines: List<LyricLine>): String {
    if (lines.isEmpty()) return ""
    val payload = lines.map { line ->
        // 没有逐字信息时补一个覆盖整行的 word，否则 AMLL 会渲染成空行
        val source = line.words.ifEmpty {
            listOf(Word(text = line.text, startMs = line.startMs, endMs = line.endMs))
        }
        AmllLineDto(
            startTime = line.startMs,
            endTime = line.endMs,
            translatedLyric = line.translation,
            romanLyric = line.romanization,
            isBG = line.isBackground,
            words = source.map { word ->
                AmllWordDto(word = word.text, startTime = word.startMs, endTime = word.endMs)
            },
        )
    }
    return lyricJson.encodeToString(payload)
}
