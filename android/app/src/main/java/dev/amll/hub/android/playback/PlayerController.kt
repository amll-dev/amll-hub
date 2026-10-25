package dev.amll.hub.android.playback

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.repo.PlaybackRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

private const val TAG = "PlayerController"

/** 自然播完续播的交叉淡化时长（与网页端一致） */
private const val CROSSFADE_NATURAL_MS = 6_000L

/** 手动切歌的快速淡化时长 */
private const val CROSSFADE_MANUAL_MS = 2_000L

/** 上一首自然结束后接预加载下一首的短淡化（旧轨已经没声了） */
private const val AUTO_ADVANCE_FADE_MS = 300L

/** 音量包络步进 */
private const val CROSSFADE_STEP_MS = 50L

/** 进度同步间隔 */
private const val TICKER_MS = 500L

/** 等待预加载曲目 ready 的最长时间 */
private const val READY_TIMEOUT_MS = 10_000L

/** 上一首的「回 0 而非切歌」阈值 */
private const val PREV_RESTART_MS = 3_000L

/**
 * 播放内核：双 ExoPlayer 交替播放，实现队列、随机/循环与等功率交叉淡化。
 *
 * active 播放当前曲目，standby 预加载下一首；交叉淡化时立即交换两者角色，
 * 旧曲继续在后台播放到音量为 0 再清空。对外状态与网页端 PlayerBoot 对齐。
 */
@Singleton
class PlayerController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: PlaybackRepository,
) {
    data class Track(
        val songId: String,
        val title: String,
        val artist: String,
        val coverUrl: String? = null,
        val streamUrl: String? = null,
        val albumName: String = "",
        val lyricLrc: String = "",
        val lyricTranslation: String = "",
        val quality: NcmQuality = NcmQuality.EXHIGH,
        val actualQuality: NcmQuality? = null,
    )

    data class QueueItem(
        val songId: String,
        val name: String,
        val artists: String,
        val coverUrl: String? = null,
        val albumName: String = "",
    )

    enum class RepeatMode { OFF, ALL, ONE }

    data class State(
        val track: Track? = null,
        val playing: Boolean = false,
        val positionMs: Long = 0L,
        val durationMs: Long = 0L,
        val buffering: Boolean = false,
        val error: String? = null,
        val resolving: Boolean = false,
        val crossfading: Boolean = false,
        val queue: List<QueueItem> = emptyList(),
        val currentIndex: Int = -1,
        val shuffle: Boolean = false,
        val repeatMode: RepeatMode = RepeatMode.OFF,
        val quality: NcmQuality = NcmQuality.EXHIGH,
        val actualQuality: NcmQuality? = null,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var ticker: Job? = null

    private val playerA: ExoPlayer = buildPlayer()
    private val playerB: ExoPlayer = buildPlayer()

    @Volatile
    private var active: ExoPlayer = playerA
    private var standby: ExoPlayer = playerB

    /** 对外暴露当前 active 播放器；MediaSession 与 ViewModel 始终拿到正在响的那个 */
    val player: ExoPlayer get() = active

    /** active 切换后通知 MediaSession 换绑，必须在主线程调用 */
    var onActivePlayerChanged: ((Player) -> Unit)? = null

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var serviceStarted = false

    private var playRequestId = 0L

    private var plannedNextIndex = -1
    private var preloadedIndex = -1
    private var preloadedTrack: Track? = null
    private var preloadToken = 0L

    private var crossfadeJob: Job? = null
    private var outgoingPlayer: ExoPlayer? = null

    init {
        playerA.addListener(listenerFor(playerA))
        playerB.addListener(listenerFor(playerB))
    }

    private fun buildPlayer(): ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        // 拔耳机自动暂停，交给系统播控统一处理
        setHandleAudioBecomingNoisy(true)
        // 息屏后保持 CPU 和网络唤醒，避免 Doze 挂起音频流
        setWakeMode(C.WAKE_MODE_NETWORK)
    }

    /**
     * Player.Listener 不带来源参数，这里按播放器各建一个实例，
     * 所有回调统一 `if (p !== active) return`，避免 standby 的事件污染状态。
     */
    private fun listenerFor(p: ExoPlayer): Player.Listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (p !== active) return
            _state.update { it.copy(playing = isPlaying) }
            if (isPlaying) startTicker() else stopTicker()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (p !== active) return
            _state.update { it.copy(buffering = playbackState == Player.STATE_BUFFERING) }
            if (playbackState == Player.STATE_READY) {
                val duration = p.duration.takeIf { it != C.TIME_UNSET } ?: 0L
                _state.update { it.copy(durationMs = duration) }
            }
            if (playbackState == Player.STATE_ENDED) handleEnded()
            syncPosition()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            if (p !== active) return
            syncPosition()
        }

        override fun onPlayerError(error: PlaybackException) {
            if (p !== active) return
            Log.w(TAG, "playback error: ${error.message}", error)
            _state.update { it.copy(error = error.message, playing = false) }
        }
    }

    /* ===== 对外播放入口 ===== */

    /** 已有解析结果的曲目直接播放；URL 为空时只更新信息并记录错误 */
    fun playResolved(track: Track, startPositionMs: Long = 0) {
        abortCrossfade()
        playRequestId++

        val queue = _state.value.queue
        val index = queue.indexOfFirst { it.songId == track.songId }
        val playable = track.streamUrl?.takeIf { it.isNotBlank() }

        if (track.quality == NcmQuality.DOLBY) {
            _state.update {
                it.copy(
                    track = track,
                    currentIndex = index,
                    playing = false,
                    positionMs = 0L,
                    durationMs = 0L,
                    buffering = false,
                    error = DOLBY_UNSUPPORTED_HINT,
                    resolving = false,
                    crossfading = false,
                    actualQuality = track.actualQuality,
                )
            }
            stopAndClear(active)
            clearPreload()
            plannedNextIndex = -1
            return
        }

        if (playable == null) {
            _state.update {
                it.copy(
                    track = track,
                    currentIndex = index,
                    playing = false,
                    positionMs = 0L,
                    durationMs = 0L,
                    buffering = false,
                    error = "该歌曲暂无音源",
                    resolving = false,
                    crossfading = false,
                    actualQuality = track.actualQuality,
                )
            }
            stopAndClear(active)
            clearPreload()
            plannedNextIndex = -1
            return
        }

        startPlaybackService()
        _state.update {
            it.copy(
                track = track,
                currentIndex = index,
                playing = true,
                positionMs = startPositionMs,
                durationMs = 0L,
                buffering = true,
                error = null,
                resolving = false,
                crossfading = false,
                actualQuality = track.actualQuality,
            )
        }

        clearPreload()
        active.setMediaItem(buildMediaItem(track, Uri.parse(playable)))
        active.prepare()
        active.seekTo(startPositionMs)
        active.play()
        startTicker()
        schedulePreload()
    }

    /** 解析并播放单曲，不改变当前队列 */
    fun playSong(
        songId: String,
        meta: QueueItem,
        quality: NcmQuality = _state.value.quality,
    ) {
        if (songId.isBlank()) return
        abortCrossfade()
        clearPreload()
        plannedNextIndex = -1

        if (quality == NcmQuality.DOLBY) {
            _state.update {
                it.copy(
                    playing = false,
                    error = DOLBY_UNSUPPORTED_HINT,
                    resolving = false,
                    quality = quality,
                )
            }
            stopAndClear(active)
            return
        }

        val requestId = ++playRequestId
        _state.update { it.copy(resolving = true, error = null, quality = quality) }
        scope.launch {
            val resolved = repository.resolve(songId, quality.key)
            if (requestId != playRequestId) return@launch
            val music = resolved.music
            val track = Track(
                songId = songId,
                title = music?.displayName?.takeIf { it.isNotBlank() }
                    ?: meta.name.ifBlank { "未知歌曲" },
                artist = music?.displayArtist?.takeIf { it.isNotBlank() }
                    ?: meta.artists.ifBlank { "未知歌手" },
                coverUrl = music?.displayCover?.takeIf { it.isNotBlank() } ?: meta.coverUrl,
                streamUrl = music?.displayUrl?.takeIf { it.isNotBlank() },
                albumName = music?.albumName?.takeIf { it.isNotBlank() } ?: meta.albumName,
                lyricLrc = music?.lyric.orEmpty(),
                lyricTranslation = music?.tlyric.orEmpty(),
                quality = quality,
                actualQuality = resolved.actual,
            )
            if (track.streamUrl == null) {
                Log.w(TAG, "playSong $songId no url: ${resolved.error}")
            }
            playResolved(track)
        }
    }

    /** 替换队列并从指定项开始播放 */
    fun playQueue(
        items: List<QueueItem>,
        startIndex: Int = 0,
        quality: NcmQuality = _state.value.quality,
    ) {
        if (items.isEmpty()) return
        val index = startIndex.coerceIn(0, items.lastIndex)
        abortCrossfade()
        _state.update {
            it.copy(queue = items, currentIndex = index, quality = quality, error = null)
        }
        playIndex(index)
    }

    fun playAt(index: Int) {
        if (index !in _state.value.queue.indices) return
        playIndex(index)
    }

    fun next(auto: Boolean = false) {
        if (crossfadeJob != null) abortCrossfade()
        val snapshot = _state.value
        val queue = snapshot.queue
        if (queue.isEmpty()) {
            if (auto) _state.update { it.copy(playing = false) }
            return
        }

        if (queue.size == 1) {
            if (snapshot.repeatMode == RepeatMode.ALL) {
                active.seekTo(0)
                active.play()
                startTicker()
            } else if (auto) {
                _state.update { it.copy(playing = false) }
            }
            return
        }

        val current = snapshot.currentIndex
        var nextIndex: Int
        if (plannedNextIndex in queue.indices) {
            nextIndex = plannedNextIndex
        } else if (snapshot.shuffle) {
            nextIndex = randomOther(queue.size, current)
        } else {
            var candidate = if (current in queue.indices) current + 1 else 0
            if (candidate >= queue.size) {
                if (snapshot.repeatMode == RepeatMode.ALL) {
                    candidate = 0
                } else {
                    if (auto) _state.update { it.copy(playing = false) }
                    return
                }
            }
            nextIndex = candidate
        }
        val preloadedReady = auto &&
            preloadedTrack != null &&
            preloadedIndex == nextIndex &&
            plannedNextIndex == nextIndex &&
            standby.mediaItemCount > 0 &&
            standby.playbackState == Player.STATE_READY
        if (preloadedReady) {
            // 一曲自然播完时旧轨已经结束，用短淡化直接接到预加载好的下一首，
            // 不再重新走一次网络解析
            startCrossfade(nextIndex, AUTO_ADVANCE_FADE_MS)
            return
        }
        playIndex(nextIndex, crossfadeMs = CROSSFADE_MANUAL_MS, allowCrossfade = !auto)
    }

    fun prev() {
        if (crossfadeJob != null) abortCrossfade()
        val snapshot = _state.value
        val queue = snapshot.queue
        if (queue.isEmpty()) return
        if (snapshot.positionMs > PREV_RESTART_MS || queue.size == 1) {
            active.seekTo(0)
            return
        }
        val current = snapshot.currentIndex
        val prevIndex = if (snapshot.shuffle) {
            randomOther(queue.size, current)
        } else {
            var candidate = if (current in queue.indices) current - 1 else 0
            if (candidate < 0) {
                candidate = if (snapshot.repeatMode == RepeatMode.ALL) queue.lastIndex else 0
            }
            candidate
        }
        playIndex(prevIndex)
    }

    fun toggle() {
        if (crossfadeJob != null) abortCrossfade()
        if (player.isPlaying) {
            player.pause()
        } else {
            // 循环 OFF 播到队尾后停在 ENDED，再按播放要从头重播
            if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
            if (player.mediaItemCount > 0) startPlaybackService()
            player.play()
            startTicker()
        }
    }

    fun pause() {
        player.pause()
    }

    fun seekTo(positionMs: Long) {
        if (crossfadeJob != null) abortCrossfade()
        player.seekTo(positionMs.coerceAtLeast(0))
        // 立即回写，不等 onPositionDiscontinuity，拖动条松手时无延迟
        syncPosition()
    }

    fun seekBy(deltaMs: Long) = seekTo(player.currentPosition + deltaMs)

    fun toggleShuffle() {
        _state.update { it.copy(shuffle = !it.shuffle) }
        clearPreload()
        schedulePreload()
    }

    fun cycleRepeatMode() {
        _state.update {
            val next = when (it.repeatMode) {
                RepeatMode.OFF -> RepeatMode.ALL
                RepeatMode.ALL -> RepeatMode.ONE
                RepeatMode.ONE -> RepeatMode.OFF
            }
            it.copy(repeatMode = next)
        }
        clearPreload()
        schedulePreload()
    }

    /** 只更新后续播放使用的音质，不重载当前曲目 */
    fun setQuality(quality: NcmQuality) {
        if (_state.value.quality == quality) return
        _state.update { it.copy(quality = quality) }
        clearPreload()
        schedulePreload()
    }

    fun removeFromQueue(index: Int) {
        val snapshot = _state.value
        if (index !in snapshot.queue.indices) return
        val queue = snapshot.queue.toMutableList().apply { removeAt(index) }
        val current = snapshot.currentIndex
        val newIndex = when {
            index == current -> -1
            index < current -> current - 1
            else -> current
        }
        _state.update { it.copy(queue = queue, currentIndex = newIndex) }
        clearPreload()
        schedulePreload()
    }

    fun clearQueue() {
        _state.update { it.copy(queue = emptyList(), currentIndex = -1) }
        clearPreload()
        plannedNextIndex = -1
    }

    /** 当前曲目无可用流时用其原音质重新解析 */
    fun replayCurrent() {
        val track = _state.value.track ?: return
        abortCrossfade()
        clearPreload()
        plannedNextIndex = -1
        val requestId = ++playRequestId
        _state.update { it.copy(resolving = true, error = null) }
        scope.launch {
            val resolved = repository.resolve(track.songId, track.quality.key)
            if (requestId != playRequestId) return@launch
            val music = resolved.music
            val newTrack = track.copy(
                title = music?.displayName?.takeIf { it.isNotBlank() } ?: track.title,
                artist = music?.displayArtist?.takeIf { it.isNotBlank() } ?: track.artist,
                coverUrl = music?.displayCover?.takeIf { it.isNotBlank() } ?: track.coverUrl,
                streamUrl = music?.displayUrl?.takeIf { it.isNotBlank() },
                albumName = music?.albumName?.takeIf { it.isNotBlank() } ?: track.albumName,
                lyricLrc = music?.lyric.orEmpty().ifBlank { track.lyricLrc },
                lyricTranslation = music?.tlyric.orEmpty().ifBlank { track.lyricTranslation },
                actualQuality = resolved.actual,
            )
            if (newTrack.streamUrl == null) {
                Log.w(TAG, "replayCurrent ${track.songId} no url: ${resolved.error}")
            }
            playResolved(newTrack)
        }
    }

    /** PlaybackService 销毁时回调，下次播放要重新拉起服务 */
    fun onServiceDestroyed() {
        serviceStarted = false
    }

    fun release() {
        abortCrossfade()
        stopTicker()
        preloadToken++
        onActivePlayerChanged = null
        scope.cancel()
        playerA.release()
        playerB.release()
    }

    /* ===== 队列内切歌与交叉淡化 ===== */

    /**
     * 播放队列中指定项。目标若是已预加载的下一首且 standby 就绪，
     * 直接淡化切换；否则解析到 standby 等 READY 再淡化，失败回退硬切。
     */
    private fun playIndex(
        index: Int,
        crossfadeMs: Long = CROSSFADE_MANUAL_MS,
        allowCrossfade: Boolean = true,
    ) {
        val snapshot = _state.value
        if (index !in snapshot.queue.indices) return
        if (crossfadeJob != null) abortCrossfade()

        val target = snapshot.queue[index]
        val preloadedReady = preloadedTrack != null &&
            preloadedIndex == index &&
            plannedNextIndex == index &&
            preloadedTrack?.songId == target.songId &&
            standby.mediaItemCount > 0 &&
            standby.playbackState == Player.STATE_READY
        if (allowCrossfade && preloadedReady) {
            startCrossfade(index, crossfadeMs)
            return
        }

        val quality = snapshot.quality
        if (quality == NcmQuality.DOLBY) {
            _state.update {
                it.copy(
                    currentIndex = index,
                    playing = false,
                    error = DOLBY_UNSUPPORTED_HINT,
                    resolving = false,
                )
            }
            stopAndClear(active)
            clearPreload()
            plannedNextIndex = -1
            return
        }

        val requestId = ++playRequestId
        clearPreload()
        plannedNextIndex = -1
        _state.update { it.copy(currentIndex = index, resolving = true, error = null) }
        scope.launch {
            val resolved = repository.resolve(target.songId, quality.key)
            if (requestId != playRequestId) return@launch
            val music = resolved.music
            val url = music?.displayUrl?.takeIf { it.isNotBlank() }
            if (url == null) {
                Log.w(TAG, "playIndex ${target.songId} no url: ${resolved.error}")
                _state.update {
                    it.copy(
                        currentIndex = index,
                        playing = false,
                        resolving = false,
                        error = resolved.error ?: "该歌曲暂无音源",
                    )
                }
                stopAndClear(active)
                return@launch
            }

            val track = toTrack(target, music, quality, resolved.actual)
            // 当前没有任何可播内容（首次播放/上次失败）时没有旧轨可淡化，直接开始
            if (!allowCrossfade || active.mediaItemCount == 0) {
                playResolved(track)
                return@launch
            }

            standby.volume = 0f
            standby.setMediaItem(buildMediaItem(track, Uri.parse(url)))
            standby.prepare()
            val ready = waitForReady(standby, READY_TIMEOUT_MS)
            if (requestId != playRequestId) return@launch
            if (!ready || crossfadeJob != null) {
                stopAndClear(standby)
                playResolved(track)
                return@launch
            }
            preloadedIndex = index
            preloadedTrack = track
            startCrossfade(index, crossfadeMs)
        }
    }

    /**
     * 等功率交叉淡化：旧轨 cos(t·π/2)、新轨 sin(t·π/2)，
     * 开始时立即把 UI 与 MediaSession 切到新曲，结束时清空旧轨。
     */
    private fun startCrossfade(index: Int, durationMs: Long) {
        if (crossfadeJob != null) abortCrossfade()
        val track = preloadedTrack ?: return
        if (standby.playbackState != Player.STATE_READY) return
        // 服务可能被系统回收过，换绑 session 前先确保它还在
        startPlaybackService()

        val outgoing = active
        val incoming = standby
        preloadedIndex = -1
        preloadedTrack = null
        // 旧曲的「下一首」就是正在淡入的这首，不能再作为下一次切歌目标
        plannedNextIndex = -1
        preloadToken++

        incoming.volume = 0f
        incoming.play()
        active = incoming
        standby = outgoing
        outgoingPlayer = outgoing
        onActivePlayerChanged?.invoke(active)

        val duration = incoming.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        _state.update {
            it.copy(
                track = track,
                currentIndex = index,
                playing = true,
                positionMs = incoming.currentPosition.coerceAtLeast(0L),
                durationMs = duration,
                buffering = false,
                error = null,
                resolving = false,
                crossfading = true,
                actualQuality = track.actualQuality,
            )
        }
        startTicker()

        val steps = (durationMs / CROSSFADE_STEP_MS).toInt().coerceAtLeast(1)
        crossfadeJob = scope.launch {
            for (step in 0..steps) {
                val t = step.toFloat() / steps
                val angle = t * (Math.PI.toFloat() / 2)
                outgoing.volume = cos(angle)
                incoming.volume = sin(angle)
                delay(CROSSFADE_STEP_MS)
            }
            outgoing.pause()
            outgoing.clearMediaItems()
            outgoing.volume = 1f
            incoming.volume = 1f
            outgoingPlayer = null
            crossfadeJob = null
            _state.update { it.copy(crossfading = false) }
            schedulePreload()
        }
    }

    /** 立即中止淡化：取消协程、停掉旧轨并复位音量 */
    private fun abortCrossfade() {
        val job = crossfadeJob
        crossfadeJob = null
        job?.cancel()
        val outgoing = outgoingPlayer
        outgoingPlayer = null
        if (outgoing != null && outgoing !== active) {
            outgoing.pause()
            outgoing.clearMediaItems()
            outgoing.volume = 1f
        }
        active.volume = 1f
        if (_state.value.crossfading) _state.update { it.copy(crossfading = false) }
    }

    /* ===== 下一首预加载 ===== */

    /** 重算预定下一首并把结果缓冲到 standby（不播放） */
    private fun schedulePreload() {
        if (crossfadeJob != null) return
        val snapshot = _state.value
        plannedNextIndex = computePlannedNext(snapshot)
        preloadToken++
        preloadedIndex = -1
        preloadedTrack = null

        val index = plannedNextIndex
        if (index !in snapshot.queue.indices) return
        if (snapshot.repeatMode == RepeatMode.ONE) return
        if (snapshot.quality == NcmQuality.DOLBY) return

        val target = snapshot.queue[index]
        val quality = snapshot.quality
        val token = preloadToken
        scope.launch {
            val resolved = repository.resolve(target.songId, quality.key)
            if (token != preloadToken) return@launch
            val music = resolved.music
            val url = music?.displayUrl?.takeIf { it.isNotBlank() }
            if (url == null) return@launch
            if (crossfadeJob != null) return@launch
            val track = toTrack(target, music, quality, resolved.actual)
            standby.volume = 0f
            standby.setMediaItem(buildMediaItem(track, Uri.parse(url)))
            standby.prepare()
            preloadedIndex = index
            preloadedTrack = track
        }
    }

    private fun computePlannedNext(snapshot: State): Int {
        val queue = snapshot.queue
        val current = snapshot.currentIndex
        if (queue.size <= 1 || current !in queue.indices) return -1
        if (snapshot.repeatMode == RepeatMode.ONE) return -1
        if (snapshot.quality == NcmQuality.DOLBY) return -1
        return if (snapshot.shuffle) {
            randomOther(queue.size, current)
        } else {
            val candidate = current + 1
            if (candidate >= queue.size) {
                if (snapshot.repeatMode == RepeatMode.ALL) 0 else -1
            } else {
                candidate
            }
        }
    }

    private fun clearPreload() {
        preloadToken++
        preloadedIndex = -1
        preloadedTrack = null
        if (crossfadeJob != null) return
        stopAndClear(standby)
    }

    private fun randomOther(size: Int, current: Int): Int {
        if (size <= 1) return 0
        var index: Int
        do {
            index = Random.nextInt(size)
        } while (index == current)
        return index
    }

    /* ===== 播放器事件与进度 ===== */

    private fun handleEnded() {
        if (crossfadeJob != null) return
        if (_state.value.repeatMode == RepeatMode.ONE) {
            // 单曲循环：不淡化，原地重播
            active.seekTo(0)
            active.play()
            startTicker()
            return
        }
        next(auto = true)
    }

    /** ticker 每 500ms 校正进度，并在临近结尾时触发自然交叉淡化 */
    private fun checkNaturalCrossfade() {
        if (crossfadeJob != null) return
        val snapshot = _state.value
        if (snapshot.repeatMode == RepeatMode.ONE) return
        val planned = plannedNextIndex
        if (planned < 0 || planned != preloadedIndex) return
        if (preloadedTrack == null) return
        if (snapshot.durationMs <= 0L) return
        if (snapshot.durationMs - snapshot.positionMs > CROSSFADE_NATURAL_MS) return
        if (standby.mediaItemCount == 0) return
        if (standby.playbackState != Player.STATE_READY) return
        startCrossfade(planned, CROSSFADE_NATURAL_MS)
    }

    private fun syncPosition() {
        _state.update { it.copy(positionMs = active.currentPosition.coerceAtLeast(0)) }
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                syncPosition()
                checkNaturalCrossfade()
                delay(TICKER_MS)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    /* ===== 工具 ===== */

    private fun stopAndClear(target: ExoPlayer) {
        target.stop()
        target.clearMediaItems()
        target.volume = 1f
    }

    private fun toTrack(
        item: QueueItem,
        music: NcmMusicDto?,
        quality: NcmQuality,
        actual: NcmQuality?,
    ): Track = Track(
        songId = item.songId,
        title = music?.displayName?.takeIf { it.isNotBlank() }
            ?: item.name.ifBlank { "未知歌曲" },
        artist = music?.displayArtist?.takeIf { it.isNotBlank() }
            ?: item.artists.ifBlank { "未知歌手" },
        coverUrl = music?.displayCover?.takeIf { it.isNotBlank() } ?: item.coverUrl,
        streamUrl = music?.displayUrl?.takeIf { it.isNotBlank() },
        albumName = music?.albumName?.takeIf { it.isNotBlank() } ?: item.albumName,
        lyricLrc = music?.lyric.orEmpty(),
        lyricTranslation = music?.tlyric.orEmpty(),
        quality = quality,
        actualQuality = actual,
    )

    private suspend fun waitForReady(target: ExoPlayer, timeoutMs: Long): Boolean =
        withTimeoutOrNull(timeoutMs) {
            if (target.playbackState == Player.STATE_READY) return@withTimeoutOrNull true
            suspendCancellableCoroutine { continuation ->
                val listener = object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_READY && continuation.isActive) {
                            target.removeListener(this)
                            continuation.resume(true)
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        if (continuation.isActive) {
                            target.removeListener(this)
                            continuation.resume(false)
                        }
                    }
                }
                target.addListener(listener)
                continuation.invokeOnCancellation { target.removeListener(listener) }
            }
        } ?: false

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
     * 通知栏 / 锁屏 / 蓝牙显示的信息都来自 MediaItem 的 metadata。
     * uri 不允许 null：无 URI 的 MediaItem 会让 ExoPlayer 在创建 MediaSource 时崩溃。
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
}
