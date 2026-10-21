package dev.amll.hub.android.playback

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
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

    val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        repeatMode = Player.REPEAT_MODE_ALL
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
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                _state.update { it.copy(error = error.message, playing = false) }
            }
        })
    }

    /** 直接播放某首歌；url 为空时只更新曲目信息（歌词页可以独立浏览） */
    fun play(track: Track, url: String? = track.streamUrl) {
        _state.update {
            it.copy(
                track = track,
                positionMs = 0L,
                durationMs = 0L,
                error = null,
            )
        }
        if (url.isNullOrBlank()) return
        player.setMediaItem(MediaItem.fromUri(url))
        player.prepare()
        player.play()
        // 交给 MediaSessionService 接管通知栏与后台播放
        runCatching { context.startService(android.content.Intent(context, PlaybackService::class.java)) }
    }

    fun toggle() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun pause() {
        player.pause()
    }

    fun seekTo(positionMs: Long) {
        player.seekTo(positionMs.coerceAtLeast(0))
        _state.update { it.copy(positionMs = positionMs) }
    }

    fun seekBy(deltaMs: Long) = seekTo(player.currentPosition + deltaMs)

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                _state.update { it.copy(positionMs = player.currentPosition) }
                delay(120)
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
