package dev.amll.hub.android.ui.screen

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.remote.NcmPlaylistDto
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.NcmTrackDto
import dev.amll.hub.android.data.repo.ContentRepository
import dev.amll.hub.android.data.repo.LyricRepository
import dev.amll.hub.android.data.repo.LyricSource
import dev.amll.hub.android.data.repo.PlaybackRepository
import dev.amll.hub.android.download.DownloadRequest
import dev.amll.hub.android.download.DownloadService
import dev.amll.hub.android.download.DownloadStore
import dev.amll.hub.android.playback.NcmQuality
import dev.amll.hub.android.playback.PlayerController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 网易云解析页的状态：三种入口共用一份，切换模式不清空彼此的结果，
 * 来回切不用重新请求。
 */
@HiltViewModel
class NcmParseViewModel @Inject constructor(
    private val repo: ContentRepository,
    private val playbackRepo: PlaybackRepository,
    private val lyricRepo: LyricRepository,
    private val player: PlayerController,
    private val downloadStore: DownloadStore,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    /** 解析成功的单曲：音频信息 + 歌词预览原文 + 实际拿到的音质 */
    data class Parsed(
        val songId: String,
        val music: NcmMusicDto,
        val source: LyricSource,
        val actual: NcmQuality?,
    )

    data class UiState(
        /** 0 关键词搜索 / 1 单曲 ID / 2 歌单 ID */
        val mode: Int = 0,
        val query: String = "",
        val searching: Boolean = false,
        val results: List<NcmSongDto> = emptyList(),
        val songInput: String = "",
        val parsing: Boolean = false,
        val parsed: Parsed? = null,
        val lyricLoading: Boolean = false,
        val playlistInput: String = "",
        val playlistLoading: Boolean = false,
        val playlist: NcmPlaylistDto? = null,
        val error: String? = null,
        val quality: NcmQuality = NcmQuality.EXHIGH,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** 下载进度由前台服务写入，全部页面入口共用这份状态 */
    val downloadState: StateFlow<DownloadStore.State> = downloadStore.state

    /** 页面音质只影响后续解析 / 播放 / 下载，不重载正在播放的曲目 */
    fun setQuality(quality: NcmQuality) = _state.update { it.copy(quality = quality) }

    fun setMode(mode: Int) = _state.update { it.copy(mode = mode, error = null) }

    fun setQuery(value: String) = _state.update { it.copy(query = value, error = null) }

    fun setSongInput(value: String) = _state.update { it.copy(songInput = value, error = null) }

    fun setPlaylistInput(value: String) =
        _state.update { it.copy(playlistInput = value, error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun notifyError(message: String) = _state.update { it.copy(error = message) }

    /** 关键词搜索：相当于网页端「搜索」输入框 */
    fun search() {
        val keyword = _state.value.query.trim()
        if (keyword.isBlank()) return
        _state.update { it.copy(searching = true, error = null) }
        viewModelScope.launch {
            repo.ncmSearch(keyword, limit = 30)
                .onSuccess { songs ->
                    _state.update {
                        it.copy(
                            searching = false,
                            results = songs,
                            error = if (songs.isEmpty()) "没搜到结果，换个关键词试试" else null,
                        )
                    }
                }
                .onFailure { e ->
                    // 把后端/网络的真实原因显示出来，不然「用不了」查不到原因
                    _state.update { it.copy(searching = false, error = e.message ?: "搜索失败") }
                }
        }
    }

    /**
     * 单曲解析：输入可以是纯 ID、带 id 参数的链接，或者整段分享文案。
     * 音源走 PlaybackRepository（含 standard 兜底），歌词原文交给歌词页解析。
     */
    fun parseSong() {
        val raw = _state.value.songInput.trim()
        if (raw.isBlank()) return
        val id = extractSongId(raw)
        val quality = _state.value.quality
        _state.update {
            it.copy(parsing = true, parsed = null, lyricLoading = false, error = null)
        }
        viewModelScope.launch {
            val resolved = playbackRepo.resolve(id, quality.key)
            val music = resolved.music
            if (music == null) {
                _state.update {
                    it.copy(
                        parsing = false,
                        lyricLoading = false,
                        error = resolved.error ?: "解析失败",
                    )
                }
                return@launch
            }

            // 歌词拿不到不影响播放与下载，兜底成空歌词；先把结果卡亮出来，
            // 歌词区域在加载期间显示骨架
            _state.update {
                it.copy(
                    parsing = false,
                    parsed = Parsed(id, music, LyricSource(), resolved.actual),
                    lyricLoading = true,
                )
            }

            val source = try {
                lyricRepo.load(id, null, music.lyric, music.tlyric)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LyricSource()
            }

            _state.update {
                it.copy(
                    parsing = false,
                    lyricLoading = false,
                    parsed = Parsed(id, music, source, resolved.actual),
                    error = if (music.displayUrl.isBlank()) {
                        "解析到了曲目，但没拿到播放地址（可能无版权）"
                    } else {
                        null
                    },
                )
            }
        }
    }

    /** 直接播放已解析的单曲，停留解析页；全局音质同步为页面选择 */
    fun playParsed() {
        val parsed = _state.value.parsed ?: return
        val quality = _state.value.quality
        val music = parsed.music
        player.setQuality(quality)
        player.playResolved(
            PlayerController.Track(
                songId = parsed.songId,
                title = music.displayName,
                artist = music.displayArtist,
                coverUrl = music.displayCover.ifBlank { null },
                streamUrl = music.displayUrl.takeIf { it.isNotBlank() },
                albumName = music.albumName,
                lyricLrc = if (parsed.source.format == "lrc") parsed.source.text else "",
                lyricTranslation = parsed.source.translation,
                quality = quality,
                actualQuality = parsed.actual,
            ),
        )
    }

    /** 搜索结果就地播放，不改变当前队列 */
    fun playSearch(song: NcmSongDto) {
        val id = song.displayId
        if (id.isBlank()) {
            notifyError("没有拿到这首歌的 ID")
            return
        }
        player.playSong(id, song.toQueueItem(), _state.value.quality)
    }

    /** 播放全部：把歌单曲目换成一个新队列 */
    fun playPlaylistAll() {
        val items = _state.value.playlist?.tracks.orEmpty().mapNotNull { it.toQueueItemOrNull() }
        if (items.isEmpty()) {
            notifyError("歌单里没有可播放的曲目")
            return
        }
        player.playQueue(items, 0, _state.value.quality)
    }

    /** 从歌单某一行开始播放：索引要映射到跳过空 ID 之后的队列下标 */
    fun playPlaylistTrack(index: Int) {
        val tracks = _state.value.playlist?.tracks.orEmpty()
        if (index !in tracks.indices) return

        val items = ArrayList<PlayerController.QueueItem>(tracks.size)
        var target = -1
        tracks.forEachIndexed { original, track ->
            val item = track.toQueueItemOrNull() ?: return@forEachIndexed
            if (original == index) target = items.size
            items += item
        }
        if (target < 0) {
            notifyError("这首歌没有可播放的 ID")
            return
        }
        player.playQueue(items, target, _state.value.quality)
    }

    fun parsePlaylist() {
        val raw = _state.value.playlistInput.trim()
        if (raw.isBlank()) return
        _state.update { it.copy(playlistLoading = true, playlist = null, error = null) }
        viewModelScope.launch {
            repo.ncmPlaylist(raw)
                .onSuccess { detail ->
                    _state.update {
                        it.copy(
                            playlistLoading = false,
                            playlist = detail,
                            error = null,
                        )
                    }
                }
                .onFailure { e ->
                    _state.update { it.copy(playlistLoading = false, error = e.message ?: "歌单解析失败") }
                }
        }
    }

    /* ===== 下载 ===== */

    fun downloadParsed() {
        val parsed = _state.value.parsed
        if (parsed == null || parsed.songId.isBlank()) {
            notifyError("先解析一首歌再下载")
            return
        }
        val music = parsed.music
        val request = DownloadRequest(
            songId = parsed.songId,
            name = music.displayName,
            artists = music.displayArtist,
            coverUrl = music.displayCover.ifBlank { null },
            albumName = music.albumName,
            level = _state.value.quality.key,
        )
        DownloadService.start(context, listOf(request), zip = false)
    }

    fun downloadSearch(song: NcmSongDto) {
        val id = song.displayId
        if (id.isBlank()) {
            notifyError("没有拿到这首歌的 ID")
            return
        }
        val request = DownloadRequest(
            songId = id,
            name = song.displayName,
            artists = song.displayArtist,
            coverUrl = song.displayCover.ifBlank { null },
            albumName = song.displayAlbum,
            level = _state.value.quality.key,
        )
        DownloadService.start(context, listOf(request), zip = false)
    }

    /** 歌单里单曲下载：按页面当前音质请求 */
    fun downloadPlaylistTrack(index: Int) {
        val track = _state.value.playlist?.tracks?.getOrNull(index)
        val request = track?.toDownloadRequest(_state.value.quality.key)
        if (request == null) {
            notifyError("这首歌没有可下载的 ID")
            return
        }
        DownloadService.start(context, listOf(request), zip = false)
    }

    fun downloadPlaylist() {
        val detail = _state.value.playlist
        val level = _state.value.quality.key
        val requests = detail?.tracks.orEmpty().mapNotNull { it.toDownloadRequest(level) }
        if (requests.isEmpty()) {
            notifyError("歌单里没有可下载的曲目")
            return
        }
        DownloadService.start(
            context,
            requests,
            zip = true,
            zipName = detail?.name.orEmpty().ifBlank { "歌单" },
        )
    }
}

private fun NcmSongDto.toQueueItem(): PlayerController.QueueItem =
    PlayerController.QueueItem(
        songId = displayId,
        name = displayName,
        artists = displayArtist,
        coverUrl = displayCover.ifBlank { null },
        albumName = displayAlbum,
    )

/** 没有 ID 的曲目不能播放 / 下载，统一返回 null 由调用方跳过 */
private fun NcmTrackDto.toQueueItemOrNull(): PlayerController.QueueItem? {
    val id = displayId
    if (id.isBlank()) return null
    return PlayerController.QueueItem(
        songId = id,
        name = name.ifBlank { "未知歌曲" },
        artists = displayArtist,
        coverUrl = displayCover.ifBlank { null },
        albumName = al?.name.orEmpty(),
    )
}

private fun NcmTrackDto.toDownloadRequest(level: String): DownloadRequest? {
    val id = displayId
    if (id.isBlank()) return null
    return DownloadRequest(
        songId = id,
        name = name.ifBlank { "未知歌曲" },
        artists = displayArtist,
        coverUrl = displayCover.ifBlank { null },
        albumName = al?.name.orEmpty(),
        level = level,
    )
}

/**
 * 从链接或分享文案里抠出纯数字 ID。
 * 纯数字直接返回；否则取 `id=xxx`，再退化为最长的一串数字。
 */
internal fun extractSongId(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.all { it.isDigit() } && trimmed.isNotEmpty()) return trimmed
    val idParam = Regex("[?&]id=(\\d+)").find(trimmed)
    if (idParam != null) return idParam.groupValues[1]
    val longest = Regex("\\d{5,}").findAll(trimmed).maxByOrNull { it.value.length }
    return longest?.value ?: trimmed
}
