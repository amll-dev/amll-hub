package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.repo.PlaybackRepository
import dev.amll.hub.android.playback.PlayerController
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 播放态与播放控制：迷你播放器 / 歌词页共用 */
@HiltViewModel
class PlaybackViewModel @Inject constructor(
    private val player: PlayerController,
    private val playbackRepo: PlaybackRepository,
) : ViewModel() {

    val playerState: StateFlow<PlayerController.State> = player.state

    fun togglePlay() {
        val state = player.state.value
        // 有曲目但播放器里没有可播内容（上次解析失败 / 无音源）时，
        // 点播放就重新走一遍解析，而不是毫无反应
        if (!state.playing && player.player.mediaItemCount == 0 && state.track != null) {
            val track = state.track
            viewModelScope.launch {
                val resolved = playbackRepo.resolve(track.songId)
                val url = resolved.music?.displayUrl?.takeIf { it.isNotBlank() }
                player.play(
                    track,
                    url,
                    errorHint = if (url == null) (resolved.error ?: "该歌曲暂无音源") else null,
                )
            }
            return
        }
        player.toggle()
    }

    fun seekTo(positionMs: Long) = player.seekTo(positionMs)
}
