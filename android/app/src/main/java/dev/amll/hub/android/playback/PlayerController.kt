package dev.amll.hub.android.playback

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "PlayerController"

/**
 * 播放内核：Media3 ExoPlayer。
 *
 * 网页端的播放器是 PlayerBoot + <audio>，这里换成 ExoPlayer，
 * 对外的「曲目 / 播放态 / 进度」状态与网页端一致，歌词页只订阅进度。
 */
@Singleton
class PlayerController @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    data class Track(
        val songId: String,
        val title: String,
        val artist: String,
        val coverUrl: String? = null,
        val streamUrl: String? = null,
        val lyricTtml: String? = null,
        val albumName: String = "",
    )

    data class State(
        val track: Track? = null,
        val playing: Boolean = false,
        val positionMs: Long = 0L,
        val durationMs: Long = 0L,
        val buffering: Boolean = false,
        val error: String? = null,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var ticker: Job? = null

    /**
     * 进度同步间隔。歌词页会在两次 setTime 之间自行插值，
     * 这里只负责校正漂移，不需要 120ms 那么频繁。
     */
    private val tickIntervalMs = 1_000L

    val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        repeatMode = Player.REPEAT_MODE_ALL
        // 拔耳机自动暂停，交给系统播控统一处理
        setHandleAudioBecomingNoisy(true)
        // 息屏后保持 CPU 和网络唤醒：只靠前台服务不足以阻止设备进入
        // Doze，一段时间后音频流会被挂起，媒体通知也随之消失
        setWakeMode(C.WAKE_MODE_NETWORK)
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.update { it.copy(playing = isPlaying) }
                if (isPlaying) startTicker() else stopTicker()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                _state.update { it.copy(buffering = playbackState == Player.STATE_BUFFERING) }
                if (playbackState == Player.STATE_READY) {
                    val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
                    _state.update { it.copy(durationMs = duration) }
                }
                syncPosition()
            }

            /** seek / 跳转 / 变速都通过这里同步，避免进度只在 ticker 里更新 */
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                syncPosition()
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                _state.update { it.copy(error = error.message, playing = false) }
            }
        })
    }

    /** 直接播放某首歌；url 为空时只更新曲目信息（歌词页可以独立浏览） */
    fun play(track: Track, url: String? = track.streamUrl, errorHint: String? = null) {
        val playable = url?.takeIf { it.isNotBlank() }
        _state.update {
            it.copy(
                track = track,
                positionMs = 0L,
                durationMs = 0L,
                error = if (playable == null) (errorHint ?: "该歌曲暂无音源") else null,
            )
        }
        if (playable == null) {
            // 绝对不能把「没有 URI 的 MediaItem」塞给 ExoPlayer：
            // 它的 localConfiguration 为 null，setMediaItem 会在
            // DefaultMediaSourceFactory.createMediaSource 里 NPE 把进程带走
            player.stop()
            player.clearMediaItems()
            return
        }
        // 先把 MediaSessionService 拉起来，再开始播：
        // 服务起来后 Media3 才会把 session 暴露给系统，通知栏/锁屏/蓝牙才拿得到控制权
        startPlaybackService()
        player.setMediaItem(buildMediaItem(track, Uri.parse(playable)))
        player.prepare()
        player.play()
    }

    private var serviceStarted = false

    /**
     * 拉起播放服务。
     *
     * 用 startService 而不是 startForegroundService：前台化由 Media3 在真正开始播放时
     * 自己做，这样 prepare 卡住也不会触发「5 秒内没 startForeground」的 ANR。
     *
     * Android 12+ 禁止从后台启动服务，调用点都在界面操作里（应用处于前台），
     * 失败时保留 serviceStarted=false，下次从界面恢复播放会再试一次。
     */
    private fun startPlaybackService() {
        if (serviceStarted) return
        val intent = Intent(context, PlaybackService::class.java)
        try {
            context.startService(intent)
            serviceStarted = true
        } catch (e: IllegalStateException) {
            Log.w(TAG, "startService rejected, playback continues without media session", e)
        }
    }

    /**
     * 通知栏 / 锁屏 / 蓝牙显示的信息都来自 MediaItem 的 metadata，
     * 不设置的话系统播控只有一句「未知曲目」。
     *
     * uri 不接受 null：见 [play] 里的注释，无 URI 的 MediaItem 会让 ExoPlayer 崩。
     */
    private fun buildMediaItem(track: Track, uri: Uri): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title.ifBlank { "未知歌曲" })
            .setArtist(track.artist.ifBlank { "未知歌手" })
            .setAlbumTitle(track.albumName.ifBlank { "AMLL Hub" })
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .apply {
                track.coverUrl?.takeIf { it.isNotBlank() }?.let {
                    runCatching { setArtworkUri(Uri.parse(it)) }
                }
            }
            .build()

        return MediaItem.Builder()
            .setMediaId(track.songId)
            .setUri(uri)
            .setMediaMetadata(metadata)
            .build()
    }

    fun toggle() {
        if (player.isPlaying) {
            player.pause()
        } else {
            // 服务可能被系统回收过，恢复播放前先确保它还在
            if (player.mediaItemCount > 0) startPlaybackService()
            player.play()
        }
    }

    /** PlaybackService 销毁时回调，下次播放要重新拉起服务 */
    fun onServiceDestroyed() {
        serviceStarted = false
    }

    fun pause() {
        player.pause()
    }

    fun seekTo(positionMs: Long) {
        player.seekTo(positionMs.coerceAtLeast(0))
        // 立即回写，不等 onPositionDiscontinuity，拖动条松手时无延迟
        syncPosition()
    }

    private fun syncPosition() {
        _state.update { it.copy(positionMs = player.currentPosition.coerceAtLeast(0)) }
    }

    fun seekBy(deltaMs: Long) = seekTo(player.currentPosition + deltaMs)

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                syncPosition()
                delay(tickIntervalMs)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    fun release() {
        stopTicker()
        player.release()
    }
}
