package dev.amll.hub.android.ui.component

import android.util.Log
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import dev.amll.hub.android.BuildConfig
import dev.amll.hub.android.data.lyric.LyricLine

private const val TAG = "AmllLyricView"

/**
 * 内置 AMLL 歌词页（assets/lyrics，AMLL core 构建产物）。
 *
 * 页面只负责渲染与滚动，时间轴全部由原生播放器驱动：
 * setLines / setTime / setPlaying / setMeta / setTheme 是页面暴露的全局方法。
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
    modifier: Modifier = Modifier,
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var loaded by remember { mutableStateOf(false) }
    val linesJson = remember(lines) { lyricLinesToJson(lines) }
    val coverUrl = remember(cover) { cover.orEmpty() }

    LaunchedEffect(webView, loaded, linesJson) {
        if (loaded && linesJson.isNotEmpty()) {
            evalJs(webView, setLinesScript(linesJson))
        }
    }
    LaunchedEffect(webView, loaded, positionMs) {
        if (loaded) {
            // 进度 120ms 一次，高频调用，失败也不影响展示
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
                    "${jsString(title)},${jsString(artist)},${durationMs.coerceAtLeast(0)})",
            )
        }
    }
    // 封面作为歌词页的压暗底图，不传的话背景就是纯色
    LaunchedEffect(webView, loaded, coverUrl) {
        if (loaded) {
            evalJs(webView, "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})")
        }
    }
    LaunchedEffect(webView, loaded, dark) {
        if (loaded) {
            evalJs(webView, "window.amllNative&&window.amllNative.setTheme($dark)")
        }
    }

    Box(modifier = modifier) {
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
                    // 透明底，加载期间透出 Compose 的深色背景，避免白闪
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {
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
                            evalJs(view, "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})")
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
                    }
                    loadUrl(ASSET_URL)
                    webView = this
                }
            },
        )
    }
}

private const val ASSET_URL = "https://appassets.androidplatform.net/assets/lyrics/index.html"

private fun setLinesScript(linesJson: String) =
    "window.amllNative&&window.amllNative.setLines(${jsString(linesJson)})"

private fun setTimeScript(positionMs: Long) =
    "window.amllNative&&window.amllNative.setTime($positionMs)"

private fun evalJs(webView: WebView?, script: String) {
    webView?.evaluateJavascript(script, null)
}

private fun jsString(raw: String): String {
    val escaped = raw
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", " ")
        .replace("\r", "")
    return "'$escaped'"
}

/** 转成 AMLL core 需要的 LyricLine 结构 */
fun lyricLinesToJson(lines: List<LyricLine>): String {
    if (lines.isEmpty()) return ""
    return lines.joinToString(prefix = "[", postfix = "]") { line ->
        // 没有逐字信息时补一个覆盖整行的 word，否则 AMLL 会渲染成空行
        val source = line.words.ifEmpty {
            listOf(
                dev.amll.hub.android.data.lyric.Word(
                    text = line.text,
                    startMs = line.startMs,
                    endMs = line.endMs,
                ),
            )
        }
        val words = source.joinToString(prefix = "[", postfix = "]") { word ->
            """{"word":"${escapeJson(word.text)}","startTime":${word.startMs},"endTime":${word.endMs}}"""
        }
        """{"startTime":${line.startMs},"endTime":${line.endMs},"translatedLyric":"${escapeJson(line.translation)}","romanLyric":"${escapeJson(line.romanization)}","isBG":${line.isBackground},"words":$words}"""
    }
}

private fun escapeJson(value: String): String = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\n", " ")
