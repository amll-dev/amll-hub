package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.playback.NcmQuality
import dev.amll.hub.android.playback.PlayerController
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** 播放态与播放控制：迷你播放器 / 歌词页共用 */
@HiltViewModel
class PlaybackViewModel @Inject constructor(
    private val player: PlayerController,
) : ViewModel() {

    val playerState: StateFlow<PlayerController.State> = player.state

    fun togglePlay() {
        val state = player.state.value
        // 有曲目但播放器里没有可播内容（上次解析失败 / 无音源）时，
        // 点播放就重新走一遍解析，而不是毫无反应
        if (!state.playing && player.player.mediaItemCount == 0 && state.track != null) {
            player.replayCurrent()
            return
        }
        player.toggle()
    }

    fun seekTo(positionMs: Long) = player.seekTo(positionMs)

    fun next() = player.next()

    fun prev() = player.prev()

    fun toggleShuffle() = player.toggleShuffle()

    fun cycleRepeat() = player.cycleRepeatMode()

    fun playAt(index: Int) = player.playAt(index)

    fun removeAt(index: Int) = player.removeFromQueue(index)

    fun clearQueue() = player.clearQueue()

    fun playNcmSong(songId: String, meta: PlayerController.QueueItem) =
        player.playSong(songId, meta)

    fun playQueue(items: List<PlayerController.QueueItem>) = player.playQueue(items)

    fun setQuality(quality: NcmQuality) = player.setQuality(quality)

    fun replayCurrent() = player.replayCurrent()
}
