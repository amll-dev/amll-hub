package dev.amll.hub.android.ui.component

import android.graphics.Color as AndroidColor
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
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
import dev.amll.hub.android.BuildConfig
import dev.amll.hub.android.data.lyric.LyricLine

private const val TAG = "AmllLyricView"

/** 页面加载完成后探测：桥是否注入、根节点是否渲染、WebGL2 是否可用、视口尺寸 */
private const val PROBE_JS =
    "(function(){try{return JSON.stringify({" +
        "bridge:typeof window.amllNative," +
        "rootChildren:(document.getElementById('root')||{}).childElementCount||0," +
        "player:!!document.getElementById('amll-lyric-player')," +
        "webgl2:!!document.createElement('canvas').getContext('webgl2')," +
        "size:[window.innerWidth,window.innerHeight]" +
        "})}catch(e){return 'probe error: '+e}})()"

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
            evalJs(webView, "setLines(${linesJson.length}B)", setLinesScript(linesJson))
        }
    }
    LaunchedEffect(webView, loaded, positionMs) {
        if (loaded) {
            // 进度 120ms 一次，只调不打印，避免刷屏
            webView?.evaluateJavascript(setTimeScript(positionMs), null)
        }
    }
    LaunchedEffect(webView, loaded, playing) {
        if (loaded) {
            evalJs(webView, "setPlaying($playing)", "window.amllNative&&window.amllNative.setPlaying($playing)")
        }
    }
    LaunchedEffect(webView, loaded, title, artist, durationMs) {
        if (loaded) {
            evalJs(
                webView,
                "setMeta($title / $artist / ${durationMs}ms)",
                "window.amllNative&&window.amllNative.setMeta(" +
                    "${jsString(title)},${jsString(artist)},${durationMs.coerceAtLeast(0)})",
            )
        }
    }
    // 封面驱动 AMLL 的背景渐变，不传的话歌词页就是一片黑
    LaunchedEffect(webView, loaded, coverUrl) {
        if (loaded) {
            evalJs(webView, "setCover(${coverUrl.ifBlank { "空" }})", "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})")
        }
    }
    LaunchedEffect(webView, loaded, dark) {
        if (loaded) {
            evalJs(webView, "setTheme(dark=$dark)", "window.amllNative&&window.amllNative.setTheme($dark)")
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            Log.d(TAG, "create WebView, lines=${lines.size}, cover=${coverUrl.ifBlank { "空" }}")
            if (BuildConfig.DEBUG) {
                // 真机上可开 chrome://inspect 直接看页面
                WebView.setWebContentsDebuggingEnabled(true)
            }
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()
            WebView(context).apply {
                setBackgroundColor(AndroidColor.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                        Log.d(
                            TAG,
                            "[web ${message.level()}] ${message.message()} " +
                                "(${message.sourceId()}:${message.lineNumber()})",
                        )
                        return true
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): WebResourceResponse? {
                        val url = request?.url ?: return null
                        val response = assetLoader.shouldInterceptRequest(url)
                        if (response == null && url.host == "appassets.androidplatform.net") {
                            Log.e(TAG, "asset 404: $url")
                        }
                        return response
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                        Log.d(TAG, "onPageStarted $url")
                    }

                    override fun onPageCommitVisible(view: WebView?, url: String?) {
                        Log.d(TAG, "onPageCommitVisible $url")
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        Log.d(TAG, "onPageFinished $url")
                        loaded = true
                        view?.evaluateJavascript(PROBE_JS) { result ->
                            Log.d(TAG, "page probe: $result")
                        }
                        evalJs(view, "setCover(${coverUrl.ifBlank { "空" }})", "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})")
                        evalJs(view, "setTheme(dark=$dark)", "window.amllNative&&window.amllNative.setTheme($dark)")
                        // 已加载好的歌词 / 播放态在 onPageFinished 后补一次，防止加载期间丢事件
                        if (linesJson.isNotEmpty()) {
                            evalJs(view, "setLines(${linesJson.length}B) after finish", setLinesScript(linesJson))
                        }
                        evalJs(view, "setPlaying($playing) after finish", "window.amllNative&&window.amllNative.setPlaying($playing)")
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?,
                    ) {
                        Log.e(
                            TAG,
                            "onReceivedError ${request?.url} code=${error?.errorCode} " +
                                "desc=${error?.description}",
                        )
                    }

                    override fun onReceivedHttpError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        errorResponse: WebResourceResponse?,
                    ) {
                        Log.e(
                            TAG,
                            "onReceivedHttpError ${request?.url} " +
                                "${errorResponse?.statusCode} ${errorResponse?.reasonPhrase}",
                        )
                    }

                    override fun onRenderProcessGone(
                        view: WebView?,
                        detail: RenderProcessGoneDetail?,
                    ): Boolean {
                        Log.e(
                            TAG,
                            "onRenderProcessGone didCrash=${detail?.didCrash()} " +
                                "priorityAtExit=${detail?.rendererPriorityAtExit()}",
                        )
                        return false
                    }
                }
                loadUrl(ASSET_URL)
                webView = this
            }
        },
    )
}

private const val ASSET_URL = "https://appassets.androidplatform.net/assets/lyrics/index.html"

private fun setLinesScript(linesJson: String) =
    "window.amllNative&&window.amllNative.setLines(${jsString(linesJson)})"

private fun setTimeScript(positionMs: Long) =
    "window.amllNative&&window.amllNative.setTime($positionMs)"

/** 执行 JS 并把返回值打到日志，方便确认桥接是否真的生效 */
private fun evalJs(webView: WebView?, label: String, script: String) {
    webView ?: return
    webView.evaluateJavascript(script) { result ->
        Log.d(TAG, "eval[$label] -> $result")
    }
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
