package dev.amll.hub.android

import android.app.Application
import android.os.Build
import android.util.Log
import androidx.core.content.pm.PackageInfoCompat
import dagger.hilt.android.HiltAndroidApp
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

@HiltAndroidApp
class AmllHubApp : Application() {

    override fun onCreate() {
        super.onCreate()
        installCrashLogger()
    }

    /**
     * 未捕获异常的 last-resort 记录。
     *
     * 正式环境应接入 Crashlytics / Bugly / ACRA 做聚合与崩溃率统计；
     * 这里只保留最小可用信息（版本 / 机型 / 系统 / 堆栈），并对凭证做脱敏、限制文件大小，
     * 供没有 adb 时排查问题。
     */
    private fun installCrashLogger() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                File(filesDir, CRASH_FILE).writeText(buildReport(thread, error))
            }
            // 交回系统默认处理器，保证进程照常退出
            previous?.uncaughtException(thread, error)
        }
    }

    private fun buildReport(thread: Thread, error: Throwable): String {
        val packageInfo = runCatching {
            packageManager.getPackageInfo(packageName, 0)
        }.getOrNull()
        val raw = buildString {
            appendLine("time: ${LocalDateTime.now().format(STAMP_FORMAT)}")
            appendLine(
                "app: ${packageInfo?.versionName ?: "?"} " +
                    "(${packageInfo?.let { PackageInfoCompat.getLongVersionCode(it) } ?: 0})",
            )
            appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("os: Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("abi: ${Build.SUPPORTED_ABIS.joinToString()}")
            appendLine("thread: ${thread.name}")
            appendLine(Log.getStackTraceString(error))
        }
        // 堆栈里可能带出请求头、token、cookie，落盘前先抹掉
        return SECRET_PATTERN.replace(raw) { "${it.groupValues[1]}=<redacted>" }
            .take(MAX_REPORT_CHARS)
    }

    companion object {
        const val CRASH_FILE = "last_crash.txt"

        /** 报告上限 64 KB，避免异常循环反复写入撑爆 filesDir */
        private const val MAX_REPORT_CHARS = 64 * 1024

        private val STAMP_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.US)

        private val SECRET_PATTERN = Regex(
            "(?i)\\b(token|access_token|refresh_token|authorization|cookie|password|secret)\\b\\s*[=:]\\s*\\S+",
        )
    }
}
