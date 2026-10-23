package dev.amll.hub.android.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import dagger.hilt.android.AndroidEntryPoint
import dev.amll.hub.android.MainActivity
import dev.amll.hub.android.R
import javax.inject.Inject

/**
 * 后台播放 + 系统媒体播控。
 *
 * 通知栏、锁屏、蓝牙、耳机线控全部走 Media3 的 MediaSession：
 * 系统从 `player.mediaMetadata` 取标题 / 歌手 / 封面，从 `player.playbackState`
 * 取进度与播放态。所以 PlayerController 里必须给 MediaItem 带 metadata，
 * 否则通知栏只会显示「未知曲目」。
 *
 * 通知渠道定制（setMediaNotificationProvider / DefaultMediaNotificationProvider /
 * ConnectionResult.AcceptedResultBuilder）在 media3 里都还标着 @UnstableApi，
 * 这里整体 opt-in；类本身不标 @UnstableApi，避免把引用它的地方也带下水。
 */
@androidx.annotation.OptIn(UnstableApi::class)
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
            .setCallback(SessionCallback())
            .build()

        // 默认实现会自己建渠道，这里显式指定渠道名与通知图标，
        // 让通知显示成「正在播放」而不是 media3 的默认英文渠道名
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.playback_channel_name)
                .setNotificationId(NOTIFICATION_ID)
                .build()
                .apply { setSmallIcon(R.drawable.ic_stat_music) },
        )
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    /** 从最近任务里划掉：没在播就把服务收掉，还在播就继续留在通知栏 */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = playerController.player
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        // ExoPlayer 由 PlayerController 单例持有，session 只解绑不释放播放器
        mediaSession?.release()
        mediaSession = null
        playerController.onServiceDestroyed()
        super.onDestroy()
    }

    private inner class SessionCallback : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session).build()
    }

    private companion object {
        const val CHANNEL_ID = "amll_playback"
        const val NOTIFICATION_ID = 1001
    }
}
