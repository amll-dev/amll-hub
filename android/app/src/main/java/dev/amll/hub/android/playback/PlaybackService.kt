package dev.amll.hub.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
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

        // 建 session 失败不应该把整个进程带走：没有系统播控也得能继续放歌
        val session = runCatching {
            MediaSession.Builder(this, playerController.player)
                .setSessionActivity(sessionActivity)
                .setCallback(SessionCallback())
                .build()
        }.onFailure {
            Log.e(TAG, "create MediaSession failed", it)
        }.getOrNull()

        if (session == null) {
            // 没有 session 这个服务没有任何意义，直接收掉，
            // 避免后续 bind 进来拿到 null
            stopSelf()
            return
        }
        mediaSession = session

        // 双播放器交叉淡化后会交换 active/standby，session 必须跟着换绑，
        // 否则通知栏/锁屏拿到的还是已经停掉的旧 Player
        playerController.onActivePlayerChanged = { newPlayer ->
            runCatching { mediaSession?.setPlayer(newPlayer) }
                .onFailure { Log.e(TAG, "switch media session player failed", it) }
        }

        // 默认实现会自己建渠道，这里显式指定渠道名与通知图标，
        // 让通知显示成「正在播放」而不是 media3 的默认英文渠道名
        runCatching {
            setMediaNotificationProvider(
                DefaultMediaNotificationProvider.Builder(this)
                    .setChannelId(CHANNEL_ID)
                    .setChannelName(R.string.playback_channel_name)
                    .setNotificationId(NOTIFICATION_ID)
                    .build()
                    .apply { setSmallIcon(R.drawable.ic_stat_music) },
            )
        }.onFailure {
            Log.e(TAG, "set media notification provider failed", it)
        }
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
        // 先断开换绑回调，避免 session 释放后仍被切歌调用
        playerController.onActivePlayerChanged = null
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
        const val TAG = "PlaybackService"
        const val CHANNEL_ID = "amll_playback"
        const val NOTIFICATION_ID = 1001
    }
}
