package dev.amll.hub.android.download

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.mpatric.mp3agic.ID3v24Tag
import com.mpatric.mp3agic.Mp3File
import dagger.hilt.android.AndroidEntryPoint
import dev.amll.hub.android.R
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.audio.flac.metadatablock.MetadataBlockDataPicture
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.reference.PictureTypes
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.inject.Inject

/**
 * 前台下载服务：单曲直接写系统下载目录，歌单（批量）先下到缓存、
 * 写完标签后打包成 ZIP 再写入下载目录。
 *
 * 下载失败只计入 failed，不中断其余曲目；通知权限被拒绝也不影响执行。
 */
@AndroidEntryPoint
class DownloadService : Service() {

    @Inject
    lateinit var repository: ContentRepository

    @Inject
    lateinit var store: DownloadStore

    @Inject
    lateinit var client: OkHttpClient

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 每次 startForegroundService 都要尽快进入前台态
        startForeground(NOTIFICATION_ID, buildNotification("下载", "准备中…", 0, indeterminate = true))

        // 已有任务在跑时不叠加第二个任务，避免两个进度条互相覆盖
        if (job?.isActive == true) return START_NOT_STICKY

        val requests = intent?.getStringExtra(EXTRA_REQUESTS)
            ?.let { raw -> runCatching { json.decodeFromString<List<DownloadRequest>>(raw) }.getOrNull() }
            .orEmpty()
        if (requests.isEmpty()) {
            finishWith("没有可下载的曲目", success = false)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val zip = intent?.action == ACTION_ZIP
        val zipName = intent?.getStringExtra(EXTRA_ZIP_NAME).orEmpty().ifBlank { DEFAULT_ZIP_NAME }
        job = scope.launch { download(requests, zip, zipName) }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun download(requests: List<DownloadRequest>, zip: Boolean, zipName: String) {
        store.start(requests.size, zip)
        notifyProgress(0, 0, requests.size, "")
        val dir = File(cacheDir, CACHE_DIR).apply {
            deleteRecursively()
            mkdirs()
        }
        try {
            if (zip) {
                downloadBatch(requests, zipName, dir)
            } else {
                downloadSingle(requests.first(), dir)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "download task failed", e)
            finishWith("下载失败：${e.message ?: "未知错误"}", success = false)
        } finally {
            dir.deleteRecursively()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private suspend fun downloadSingle(request: DownloadRequest, dir: File) {
        val result = downloadOneOrNull(request, dir)
        if (result == null) {
            store.progress(0, 1, request.name)
            notifyProgress(0, 1, 1, request.name)
            finishWith("下载失败：${request.name}", success = false)
            return
        }
        store.progress(1, 0, request.name)
        notifyProgress(1, 0, 1, request.name)

        val displayName = uniqueDownloadName(result.baseName, result.extension)
        val saved = writeToDownloads(result.file, displayName, result.format.mime)
        if (saved) {
            val tagSuffix = if (result.tagged) "" else "（标签写入失败）"
            finishWith("已保存到 下载/AMLL Hub/$displayName$tagSuffix", success = true)
        } else {
            finishWith("写入下载目录失败：$displayName（API 28 及以下请授予存储权限）", success = false)
        }
    }

    private suspend fun downloadBatch(requests: List<DownloadRequest>, zipName: String, dir: File) {
        val total = requests.size
        val done = AtomicInteger()
        val failed = AtomicInteger()
        val semaphore = Semaphore(MAX_CONCURRENT)
        val results = coroutineScope {
            requests.map { request ->
                async {
                    semaphore.withPermit {
                        val result = downloadOneOrNull(request, dir)
                        val finishedDone: Int
                        val finishedFailed: Int
                        if (result == null) {
                            finishedFailed = failed.incrementAndGet()
                            finishedDone = done.get()
                        } else {
                            finishedDone = done.incrementAndGet()
                            finishedFailed = failed.get()
                        }
                        store.progress(finishedDone, finishedFailed, request.name)
                        notifyProgress(finishedDone, finishedFailed, total, request.name)
                        result
                    }
                }
            }.awaitAll()
        }

        val files = results.filterNotNull()
        if (files.isEmpty()) {
            finishWith("下载失败：没有可用的曲目", success = false)
            return
        }

        val zipFile = File(dir, "${UUID.randomUUID()}.zip")
        val zipResult = runCatching {
            ZipOutputStream(zipFile.outputStream().buffered()).use { out ->
                val usedNames = HashSet<String>()
                for (item in files) {
                    out.putNextEntry(ZipEntry(uniqueNameInZip(item.baseName, item.extension, usedNames)))
                    item.file.inputStream().use { it.copyTo(out) }
                    out.closeEntry()
                }
            }
        }
        if (zipResult.isFailure) {
            finishWith("打包失败：${zipResult.exceptionOrNull()?.message ?: "未知错误"}", success = false)
            return
        }

        val zipBase = sanitize(zipName).ifBlank { DEFAULT_ZIP_NAME }
        val displayName = uniqueDownloadName(zipBase, "zip")
        if (!writeToDownloads(zipFile, displayName, ZIP_MIME)) {
            finishWith("写入下载目录失败：$displayName（API 28 及以下请授予存储权限）", success = false)
            return
        }
        val tagWarning = if (files.any { !it.tagged }) "，部分标签写入失败" else ""
        finishWith(
            "已保存到 下载/AMLL Hub/$displayName（成功 ${files.size} 首，失败 ${failed.get()} 首$tagWarning）",
            success = true,
        )
    }

    /**
     * 解析 → 下载到缓存 → 写完标签。任何一步失败都返回 null，
     * 由调用方计入失败数；取消异常照常上抛。
     */
    private suspend fun downloadOneOrNull(request: DownloadRequest, dir: File): DownloadResult? = try {
        downloadOne(request, dir)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "download failed: songId=${request.songId}", e)
        null
    }

    private suspend fun downloadOne(request: DownloadRequest, dir: File): DownloadResult {
        val music = resolveMusic(request)
        val part = File(dir, "${UUID.randomUUID()}.part")
        val contentType = fetchInto(music.displayUrl, part)

        val format = detectFormat(contentType, music.displayUrl)
        val extension = extensionFor(format, music.displayUrl)
        val audio = File(dir, "${part.nameWithoutExtension}.$extension")
        if (!part.renameTo(audio)) {
            part.copyTo(audio, overwrite = true)
            part.delete()
        }

        val title = music.displayName.ifBlank { request.name }.ifBlank { "未知歌曲" }
        val artist = music.displayArtist.ifBlank { request.artists }.ifBlank { "未知歌手" }
        val album = music.albumName.ifBlank { request.albumName }
        val cover = fetchCover(music.displayCover.ifBlank { request.coverUrl.orEmpty() })
        val tagged = applyTags(audio, format, Metadata(title, artist, album), cover)
        return DownloadResult(
            file = tagged.file,
            baseName = sanitize("$title - $artist"),
            extension = extension,
            format = format,
            tagged = tagged.tagged,
        )
    }

    /** 按请求音质解析；无 URL 且不是 standard 时用 standard 重试一次。 */
    private suspend fun resolveMusic(request: DownloadRequest): NcmMusicDto {
        val first = repository.parseMusic(request.songId, request.level).getOrNull()
        if (first != null && first.displayUrl.isNotBlank()) return first
        if (request.level != QUALITY_STANDARD) {
            val fallback = repository.parseMusic(request.songId, QUALITY_STANDARD).getOrNull()
            if (fallback != null && fallback.displayUrl.isNotBlank()) return fallback
        }
        throw IOException("无可用下载链接")
    }

    /** 下载音频，返回响应 Content-Type。调用方已处于 IO 线程。 */
    private fun fetchInto(url: String, dest: File): String? {
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            response.body.byteStream().use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            return response.header("Content-Type")
        }
    }

    /** 封面拿不到（非 2xx、超大、网络异常）就跳过，不影响音频与文本标签。 */
    private fun fetchCover(url: String): Cover? {
        if (url.isBlank()) return null
        return try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) return null
                val bytes = response.body.bytes()
                if (bytes.isEmpty() || bytes.size > MAX_COVER_BYTES) return null
                val mime = response.header("Content-Type")
                    ?.substringBefore(';')
                    ?.trim()
                    ?.takeIf { it.startsWith("image/") }
                    ?: "image/jpeg"
                Cover(bytes, mime)
            }
        } catch (e: Exception) {
            Log.w(TAG, "cover download failed: $url", e)
            null
        }
    }

    private fun applyTags(file: File, format: AudioFormat, meta: Metadata, cover: Cover?): TaggedFile =
        when (format) {
            AudioFormat.MP3 -> tagMp3(file, meta, cover)
            AudioFormat.FLAC -> tagFlac(file, meta, cover)
            AudioFormat.OTHER -> TaggedFile(file, true)
        }

    /** mp3agic 不能覆盖原文件，先另存再删原文件。 */
    private fun tagMp3(file: File, meta: Metadata, cover: Cover?): TaggedFile {
        val tagged = File(file.parentFile, "${file.nameWithoutExtension}_tagged.mp3")
        return runCatching {
            val mp3 = Mp3File(file.absolutePath)
            val id3 = ID3v24Tag()
            id3.setTitle(meta.title)
            id3.setArtist(meta.artist)
            if (meta.album.isNotBlank()) id3.setAlbum(meta.album)
            cover?.let { id3.setAlbumImage(it.bytes, it.mime) }
            mp3.setId3v2Tag(id3)
            mp3.save(tagged.absolutePath)
            file.delete()
            TaggedFile(tagged, true)
        }.getOrElse { e ->
            Log.w(TAG, "mp3 tag failed: ${file.name}", e)
            tagged.delete()
            TaggedFile(file, false)
        }
    }

    /**
     * FLAC 走 jaudiotagger。封面直接用 MetadataBlockDataPicture：
     * Artwork 的 setImageFromData() 依赖 javax.imageio，Android 上没有实现。
     */
    private fun tagFlac(file: File, meta: Metadata, cover: Cover?): TaggedFile =
        runCatching {
            val audio = AudioFileIO.read(file)
            val tag = audio.tagOrCreateAndSetDefault
            tag.setField(FieldKey.TITLE, meta.title)
            tag.setField(FieldKey.ARTIST, meta.artist)
            if (meta.album.isNotBlank()) tag.setField(FieldKey.ALBUM, meta.album)
            cover?.let {
                tag.setField(
                    MetadataBlockDataPicture(
                        it.bytes,
                        PictureTypes.DEFAULT_ID,
                        it.mime,
                        "",
                        0,
                        0,
                        0,
                        0,
                    ),
                )
            }
            AudioFileIO.write(audio)
            TaggedFile(file, true)
        }.getOrElse { e ->
            Log.w(TAG, "flac tag failed: ${file.name}", e)
            TaggedFile(file, false)
        }

    /* ===== 格式识别 ===== */

    private fun detectFormat(contentType: String?, url: String): AudioFormat {
        val type = contentType?.lowercase().orEmpty()
        val path = url.substringBefore('?').substringBefore('#').lowercase()
        return when {
            "mpeg" in type || "mp3" in type || path.endsWith(".mp3") -> AudioFormat.MP3
            "flac" in type || path.endsWith(".flac") -> AudioFormat.FLAC
            else -> AudioFormat.OTHER
        }
    }

    private fun extensionFor(format: AudioFormat, url: String): String = when (format) {
        AudioFormat.MP3 -> "mp3"
        AudioFormat.FLAC -> "flac"
        AudioFormat.OTHER -> {
            val name = url.substringBefore('?').substringBefore('#').substringAfterLast('/')
            val ext = name.substringAfterLast('.', "").lowercase()
            ext.takeIf { it.length in 2..5 && it.all { c -> c.isLetterOrDigit() } } ?: "bin"
        }
    }

    /* ===== 写入系统下载目录 ===== */

    private fun writeToDownloads(file: File, displayName: String, mime: String): Boolean =
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeViaMediaStore(file, displayName, mime)
            } else {
                writeViaLegacyDir(file, displayName)
            }
        }.onFailure {
            Log.e(TAG, "save to downloads failed: $displayName", it)
        }.isSuccess

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun writeViaMediaStore(file: File, displayName: String, mime: String) {
        val resolver = contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_RELATIVE_PATH)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("MediaStore 插入失败")
        try {
            resolver.openOutputStream(uri)?.use { output ->
                file.inputStream().use { it.copyTo(output) }
            } ?: throw IOException("无法打开下载目录输出流")
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            if (resolver.update(uri, values, null, null) <= 0) {
                throw IOException("MediaStore 更新失败")
            }
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }
    }

    private fun writeViaLegacyDir(file: File, displayName: String) {
        if (!hasLegacyWritePermission(this)) throw IOException("缺少存储写权限")
        val dir = legacyDownloadDir()
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("无法创建下载目录")
        file.copyTo(File(dir, displayName), overwrite = false)
    }

    private fun legacyDownloadDir(): File =
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), DOWNLOAD_FOLDER)

    private fun uniqueDownloadName(base: String, extension: String): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            uniqueMediaStoreName(base, extension)
        } else {
            uniqueLegacyName(base, extension)
        }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun uniqueMediaStoreName(base: String, extension: String): String {
        var index = 0
        while (true) {
            val candidate = if (index == 0) "$base.$extension" else "$base ($index).$extension"
            val exists = runCatching {
                contentResolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.MediaColumns._ID),
                    "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND " +
                        "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?",
                    arrayOf(candidate, "$DOWNLOAD_RELATIVE_PATH%"),
                    null,
                )?.use { it.moveToFirst() } == true
            }.getOrDefault(false)
            if (!exists) return candidate
            index++
        }
    }

    private fun uniqueLegacyName(base: String, extension: String): String {
        val dir = legacyDownloadDir()
        var index = 0
        while (true) {
            val candidate = if (index == 0) "$base.$extension" else "$base ($index).$extension"
            if (!File(dir, candidate).exists()) return candidate
            index++
        }
    }

    private fun uniqueNameInZip(base: String, extension: String, used: MutableSet<String>): String {
        var index = 0
        while (true) {
            val candidate = if (index == 0) "$base.$extension" else "$base ($index).$extension"
            if (used.add(candidate)) return candidate
            index++
        }
    }

    private fun sanitize(raw: String): String =
        raw.replace(ILLEGAL_CHARS, "_")
            .replace(CONTROL_CHARS, "_")
            .trim()
            .trimEnd('.')
            .take(MAX_NAME_LENGTH)
            .ifBlank { "未命名" }

    /* ===== 通知 ===== */

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(CHANNEL_ID, "下载", NotificationManager.IMPORTANCE_LOW).apply {
            description = "网易云歌曲下载进度"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(
        title: String,
        text: String,
        progress: Int?,
        indeterminate: Boolean = false,
    ): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(progress != null)
            .setSilent(true)
        if (progress != null) {
            builder.setProgress(100, progress.coerceIn(0, 100), indeterminate)
        } else {
            builder.setProgress(0, 0, false)
        }
        return builder.build()
    }

    private fun notifyProgress(done: Int, failed: Int, total: Int, currentName: String) {
        val finished = done + failed
        val pct = if (total <= 0) 0 else finished * 100 / total
        val text = buildString {
            if (currentName.isNotBlank()) append(currentName).append(" · ")
            append("$finished/$total")
            if (failed > 0) append("，失败 $failed")
        }
        updateNotification(buildNotification("下载中", text, pct))
    }

    private fun finishWith(message: String, success: Boolean) {
        store.finish(message)
        updateNotification(
            buildNotification(
                title = if (success) "下载完成" else "下载失败",
                text = message,
                progress = null,
            ),
        )
    }

    @SuppressLint("MissingPermission", "NotificationPermission")
    private fun updateNotification(notification: Notification) {
        // 没授予 POST_NOTIFICATIONS 时 notify 会被系统静默丢弃，不影响下载本身
        runCatching { NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification) }
            .onFailure { Log.w(TAG, "update notification failed", it) }
    }

    private data class DownloadResult(
        val file: File,
        val baseName: String,
        val extension: String,
        val format: AudioFormat,
        val tagged: Boolean,
    )

    private data class TaggedFile(val file: File, val tagged: Boolean)

    private data class Metadata(val title: String, val artist: String, val album: String)

    private data class Cover(val bytes: ByteArray, val mime: String)

    private enum class AudioFormat(val mime: String) {
        MP3("audio/mpeg"),
        FLAC("audio/flac"),
        OTHER("application/octet-stream"),
    }

    companion object {
        const val ACTION_SINGLE = "dev.amll.hub.android.download.action.SINGLE"
        const val ACTION_ZIP = "dev.amll.hub.android.download.action.ZIP"
        const val EXTRA_REQUESTS = "requests"
        const val EXTRA_ZIP_NAME = "zipName"

        private const val TAG = "DownloadService"
        private const val CHANNEL_ID = "amll_download"
        private const val NOTIFICATION_ID = 1002
        private const val CACHE_DIR = "download_tmp"
        private const val MAX_CONCURRENT = 3
        private const val MAX_COVER_BYTES = 5 * 1024 * 1024
        private const val MAX_NAME_LENGTH = 120
        private const val DEFAULT_ZIP_NAME = "歌单"
        private const val QUALITY_STANDARD = "standard"
        private const val DOWNLOAD_FOLDER = "AMLL Hub"
        private const val DOWNLOAD_RELATIVE_PATH = "Download/AMLL Hub"
        private const val ZIP_MIME = "application/zip"

        private val ILLEGAL_CHARS = Regex("""[<>:"/\\|?*]""")
        private val CONTROL_CHARS = Regex("[\\x00-\\x1F]")

        private val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            coerceInputValues = true
        }

        fun start(
            context: Context,
            requests: List<DownloadRequest>,
            zip: Boolean,
            zipName: String = DEFAULT_ZIP_NAME,
        ) {
            if (requests.isEmpty()) return
            val intent = Intent(context, DownloadService::class.java).apply {
                action = if (zip) ACTION_ZIP else ACTION_SINGLE
                putExtra(EXTRA_REQUESTS, json.encodeToString(requests))
                putExtra(EXTRA_ZIP_NAME, zipName)
            }
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
