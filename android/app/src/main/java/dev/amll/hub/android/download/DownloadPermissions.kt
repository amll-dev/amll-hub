package dev.amll.hub.android.download

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** API 28 及以下写公共下载目录需要 WRITE_EXTERNAL_STORAGE；29+ 走 MediaStore。 */
fun needsLegacyWritePermission(): Boolean =
    Build.VERSION.SDK_INT <= Build.VERSION_CODES.P

/**
 * API 33+ 的通知权限。拒绝只影响通知展示，不阻塞下载；
 * 低版本没有这个运行时权限，恒为 true。
 */
fun hasNotificationPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

fun hasLegacyWritePermission(context: Context): Boolean =
    !needsLegacyWritePermission() ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
