package dev.amll.hub.android.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import dagger.hilt.android.AndroidEntryPoint
import dev.amll.hub.android.MainActivity
import javax.inject.Inject

/**
 * 后台播放：把 [PlayerController] 的 ExoPlayer 挂到 MediaSession 上。
 *
 * 作用：
 * - 退到后台 / 锁屏后继续播放（前台服务 + 媒体通知）
 * - 通知栏、耳机线控、蓝牙控制走 Media3 默认实现
 */
@AndroidEntryPoint
class PlaybackService : MediaSessionService() {

    @Inject
    lateinit var playerController: PlayerController

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        mediaSession = MediaSession.Builder(this, playerController.player)
            .setSessionActivity(sessionActivity)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = playerController.player
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        // ExoPlayer 由 PlayerController 单例持有，这里只释放 session
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }
}
