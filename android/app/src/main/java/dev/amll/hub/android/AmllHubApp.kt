package dev.amll.hub.android

import android.app.Application
import android.util.Log
import dagger.hilt.android.HiltAndroidApp
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@HiltAndroidApp
class AmllHubApp : Application() {

    override fun onCreate() {
        super.onCreate()
        installCrashLogger()
    }

    /**
     * 把未捕获异常落到 filesDir，下次启动时由 MainActivity 弹出来。
     *
     * 纯调试用途：没有 adb 也能把堆栈拿出来。
     */
    private fun installCrashLogger() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
                val text = buildString {
                    appendLine("time: $stamp")
                    appendLine("thread: ${thread.name}")
                    appendLine(Log.getStackTraceString(error))
                }
                File(filesDir, CRASH_FILE).writeText(text)
            }
            // 交回系统默认处理器，保证进程照常退出
            previous?.uncaughtException(thread, error)
        }
    }

    companion object {
        const val CRASH_FILE = "last_crash.txt"
    }
}
