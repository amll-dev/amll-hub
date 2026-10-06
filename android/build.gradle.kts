plugins {
    alias(libs.plugins.android.application) apply false
    // KSP 不兼容 AGP 9 内置 Kotlin，这里仍用传统 kotlin-android 插件
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ksp) apply false
}
