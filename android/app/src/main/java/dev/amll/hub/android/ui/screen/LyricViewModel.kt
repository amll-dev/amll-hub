package dev.amll.hub.android.ui.screen

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.lyric.LyricLine
import dev.amll.hub.android.data.repo.LyricRepository
import dev.amll.hub.android.data.repo.PlaybackRepository
import dev.amll.hub.android.playback.PlayerController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "LyricViewModel"

data class LyricUi(
    val loading: Boolean = false,
    val songId: String = "",
    val title: String = "",
    val artist: String = "",
    val cover: String? = null,
    val lines: List<LyricLine> = emptyList(),
    val ttml: String = "",
    val error: String? = null,
)

/** 打开一首歌：解析音源 + 按优先级找歌词，然后把曲目交给播放器 */
@HiltViewModel
class LyricViewModel @Inject constructor(
    private val playbackRepo: PlaybackRepository,
    private val lyricRepo: LyricRepository,
    private val player: PlayerController,
) : ViewModel() {

    val lyric = MutableStateFlow(LyricUi())

    fun openTrack(
        songId: String,
        title: String,
        artist: String,
        cover: String?,
        rawLyricFile: String? = null,
    ) {
        val id = songId.trim()
        if (id.isBlank()) {
            lyric.value = LyricUi(
                loading = false,
                title = title,
                artist = artist,
                cover = cover,
                error = "该歌曲没有关联的网易云 ID",
            )
            return
        }
        // 同一首歌已经加载过就不再重复请求
        if (lyric.value.songId == id &&
            lyric.value.lines.isNotEmpty() &&
            player.state.value.track?.songId == id
        ) {
            return
        }

        lyric.value = LyricUi(loading = true, songId = id, title = title, artist = artist, cover = cover)
        viewModelScope.launch {
            val resolved = playbackRepo.resolve(id)
            val music = resolved.music
            val parseError = resolved.error

            // 解析必须兜住：viewModelScope 里漏出去的异常会直接崩掉进程。
            // 后端偶尔会返回非 TTML 的内容（错误页等），解析器会抛
            val (lines, ttml) = runCatching {
                lyricRepo.load(id, rawLyricFile, music?.lyric.orEmpty(), music?.tlyric.orEmpty())
            }.getOrElse {
                Log.e(TAG, "openTrack id=$id lyric parse failed", it)
                emptyList<LyricLine>() to ""
            }
            Log.d(
                TAG,
                "openTrack id=$id lines=${lines.size} ttml=${ttml.length}B " +
                    "ncmLyric=${music?.lyric?.length ?: 0}B url=${!music?.displayUrl.isNullOrBlank()} " +
                    "parseError=$parseError",
            )

            val resolvedTitle = music?.displayName?.takeIf { it.isNotBlank() } ?: title
            val resolvedArtist = music?.displayArtist?.takeIf { it.isNotBlank() } ?: artist
            val resolvedCover = music?.displayCover?.takeIf { it.isNotBlank() } ?: cover

            lyric.update {
                it.copy(
                    loading = false,
                    songId = id,
                    title = resolvedTitle,
                    artist = resolvedArtist,
                    cover = resolvedCover,
                    ttml = ttml,
                    lines = lines,
                    error = null,
                )
            }
            val url = music?.displayUrl?.takeIf { it.isNotBlank() }
            player.play(
                PlayerController.Track(
                    songId = id,
                    title = resolvedTitle,
                    artist = resolvedArtist,
                    coverUrl = resolvedCover,
                    streamUrl = url,
                    lyricTtml = ttml,
                ),
                url,
                // 把解析失败的原因带给播放条，用户才知道为什么没声音
                errorHint = if (url == null) (parseError ?: "该歌曲暂无音源") else null,
            )
        }
    }

    /** 从播放条进歌词页前调用：当前曲目的歌词还没加载就补一次 */
    fun ensurePlayerLyric() {
        val track = player.state.value.track ?: return
        if (lyric.value.songId == track.songId && lyric.value.lines.isNotEmpty()) return
        openTrack(track.songId, track.title, track.artist, track.coverUrl)
    }
}
