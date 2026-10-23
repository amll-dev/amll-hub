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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import dev.amll.hub.android.BuildConfig
import dev.amll.hub.android.data.lyric.LyricLine
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val TAG = "AmllLyricView"

/** debug 包把诊断信息同时写到这个文件，方便没有 adb 时排查 */
private const val DEBUG_LOG_FILE = "lyric-debug.log"

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

    // debug 包：生命周期 / 页面报错 / 探针结果同时打到 logcat、屏幕和 filesDir/lyric-debug.log
    val appContext = LocalContext.current.applicationContext
    val traceLines = remember { mutableStateListOf<String>() }
    val trace: (String) -> Unit = remember(traceLines, appContext) {
        { message: String ->
            Log.i(TAG, message)
            if (BuildConfig.DEBUG) {
                val line = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date()) + " " + message
                traceLines += line
                if (traceLines.size > 16) traceLines.removeAt(0)
                runCatching { File(appContext.filesDir, DEBUG_LOG_FILE).appendText(line + "\n") }
            }
            Unit
        }
    }

    LaunchedEffect(webView, loaded, linesJson) {
        if (loaded && linesJson.isNotEmpty()) {
            evalJs(webView, "setLines(${linesJson.length}B)", setLinesScript(linesJson), trace)
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
            evalJs(webView, "setPlaying($playing)", "window.amllNative&&window.amllNative.setPlaying($playing)", trace)
        }
    }
    LaunchedEffect(webView, loaded, title, artist, durationMs) {
        if (loaded) {
            evalJs(
                webView,
                "setMeta($title / $artist / ${durationMs}ms)",
                "window.amllNative&&window.amllNative.setMeta(" +
                    "${jsString(title)},${jsString(artist)},${durationMs.coerceAtLeast(0)})",
                trace,
            )
        }
    }
    // 封面驱动 AMLL 的背景渐变，不传的话歌词页就是一片黑
    LaunchedEffect(webView, loaded, coverUrl) {
        if (loaded) {
            evalJs(webView, "setCover(${coverUrl.ifBlank { "空" }})", "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})", trace)
        }
    }
    LaunchedEffect(webView, loaded, dark) {
        if (loaded) {
            evalJs(webView, "setTheme(dark=$dark)", "window.amllNative&&window.amllNative.setTheme($dark)", trace)
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                trace("create WebView, lines=${lines.size}, cover=${coverUrl.ifBlank { "空" }}")
                if (BuildConfig.DEBUG) {
                    // 真机上可开 chrome://inspect 直接看页面
                    WebView.setWebContentsDebuggingEnabled(true)
                }
                val assetLoader = WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                    .build()
                WebView(context).apply {
                    // debug 下用深紫色，页面如果完全没画出来，一眼就能看出是 WebView 表层问题
                    setBackgroundColor(if (BuildConfig.DEBUG) 0xFF3B0A45.toInt() else AndroidColor.TRANSPARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                            trace(
                                "[web ${message.messageLevel()}] ${message.message()} " +
                                    "(${message.sourceId()}:${message.lineNumber()})",
                            )
                            return true
                        }

                        override fun onProgressChanged(view: WebView?, newProgress: Int) {
                            trace("progress $newProgress%")
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
                                trace("asset 404: $url")
                            }
                            return response
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                            trace("onPageStarted $url")
                        }

                        override fun onPageCommitVisible(view: WebView?, url: String?) {
                            trace("onPageCommitVisible $url")
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            trace("onPageFinished $url")
                            loaded = true
                            view?.evaluateJavascript(PROBE_JS) { result ->
                                trace("page probe: $result")
                            }
                            evalJs(view, "setCover(${coverUrl.ifBlank { "空" }})", "window.amllNative&&window.amllNative.setCover(${jsString(coverUrl)})", trace)
                            evalJs(view, "setTheme(dark=$dark)", "window.amllNative&&window.amllNative.setTheme($dark)", trace)
                            // 已加载好的歌词 / 播放态在 onPageFinished 后补一次，防止加载期间丢事件
                            if (linesJson.isNotEmpty()) {
                                evalJs(view, "setLines(${linesJson.length}B) after finish", setLinesScript(linesJson), trace)
                            }
                            evalJs(view, "setPlaying($playing) after finish", "window.amllNative&&window.amllNative.setPlaying($playing)", trace)
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?,
                        ) {
                            trace(
                                "onReceivedError ${request?.url} code=${error?.errorCode} " +
                                    "desc=${error?.description}",
                            )
                        }

                        override fun onReceivedHttpError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            errorResponse: WebResourceResponse?,
                        ) {
                            trace(
                                "onReceivedHttpError ${request?.url} " +
                                    "${errorResponse?.statusCode} ${errorResponse?.reasonPhrase}",
                            )
                        }

                        override fun onRenderProcessGone(
                            view: WebView?,
                            detail: RenderProcessGoneDetail?,
                        ): Boolean {
                            trace(
                                "onRenderProcessGone didCrash=${detail?.didCrash()} " +
                                    "priorityAtExit=${detail?.rendererPriorityAtExit()}",
                            )
                            return false
                        }
                    }
                    trace("loadUrl $ASSET_URL")
                    loadUrl(ASSET_URL)
                    webView = this
                }
            },
        )
        if (BuildConfig.DEBUG) {
            Column(
                Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(8.dp)
                    .background(Color(0xCC000000), RoundedCornerShape(8.dp))
                    .padding(8.dp),
            ) {
                Text("歌词页调试", color = Color(0xFFFFD54F), fontSize = 10.sp)
                Text(traceLines.joinToString("\n"), color = Color.White, fontSize = 9.sp)
            }
        }
    }
}

private const val ASSET_URL = "https://appassets.androidplatform.net/assets/lyrics/index.html"

private fun setLinesScript(linesJson: String) =
    "window.amllNative&&window.amllNative.setLines(${jsString(linesJson)})"

private fun setTimeScript(positionMs: Long) =
    "window.amllNative&&window.amllNative.setTime($positionMs)"

/** 执行 JS 并把返回值交给 trace，方便确认桥接是否真的生效 */
private fun evalJs(
    webView: WebView?,
    label: String,
    script: String,
    trace: (String) -> Unit = {},
) {
    webView ?: return
    webView.evaluateJavascript(script) { result ->
        trace("eval[$label] -> $result")
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
