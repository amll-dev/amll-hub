package dev.amll.hub.android.ui.component

import android.graphics.Color as AndroidColor
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import dev.amll.hub.android.data.lyric.LyricLine

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
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setLines(${jsString(linesJson)})",
                null,
            )
        }
    }
    LaunchedEffect(webView, loaded, positionMs) {
        if (loaded) {
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setTime($positionMs)",
                null,
            )
        }
    }
    LaunchedEffect(webView, loaded, playing) {
        if (loaded) {
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setPlaying($playing)",
                null,
            )
        }
    }
    LaunchedEffect(webView, loaded, title, artist, durationMs) {
        if (loaded) {
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setMeta(" +
                    "${jsString(title)},${jsString(artist)},${durationMs.coerceAtLeast(0)})",
                null,
            )
        }
    }
    // 封面驱动 AMLL 的背景渐变，不传的话歌词页就是一片黑
    LaunchedEffect(webView, loaded, coverUrl) {
        if (loaded) {
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})",
                null,
            )
        }
    }
    LaunchedEffect(webView, loaded, dark) {
        if (loaded) {
            webView?.evaluateJavascript(
                "window.amllNative&&window.amllNative.setTheme($dark)",
                null,
            )
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()
            WebView(context).apply {
                setBackgroundColor(AndroidColor.TRANSPARENT)
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
                        view?.evaluateJavascript(
                            "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})",
                            null,
                        )
                        view?.evaluateJavascript(
                            "window.amllNative&&window.amllNative.setTheme($dark)",
                            null,
                        )
                    }
                }
                loadUrl("https://appassets.androidplatform.net/assets/lyrics/index.html")
                webView = this
            }
        },
    )
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
