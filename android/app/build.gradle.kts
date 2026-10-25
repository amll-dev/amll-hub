import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

// local.properties 不进版本库（CI 用环境变量），两项都缺时才回落到 beta 后端
val localProperties: Properties = rootProject.file("local.properties")
    .takeIf { it.exists() }
    ?.let { file -> Properties().apply { file.inputStream().use(::load) } }
    ?: Properties()

fun localOrEnv(key: String, env: String): String? =
    localProperties.getProperty(key)?.takeIf { it.isNotBlank() }
        ?: System.getenv(env)?.takeIf { it.isNotBlank() }

val apiBaseUrl: String = localOrEnv("amll.api.baseUrl", "AMLL_API_BASE_URL")
    ?: "https://api.beta.amllhub.bikonoo.com"

// 发布签名：四项齐全才启用正式 keystore，否则 release 继续用 debug key 兜底
val releaseStoreFile = localOrEnv("amll.release.storeFile", "AMLL_RELEASE_STORE_FILE")
val releaseStorePassword = localOrEnv("amll.release.storePassword", "AMLL_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = localOrEnv("amll.release.keyAlias", "AMLL_RELEASE_KEY_ALIAS")
val releaseKeyPassword = localOrEnv("amll.release.keyPassword", "AMLL_RELEASE_KEY_PASSWORD")
val hasReleaseSigning = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword)
    .all { !it.isNullOrBlank() }

android {
    // namespace 是代码包名（R / BuildConfig 的包路径），与安装包标识无关，
    // 这里保持不动；对外显示的包名是下面的 applicationId
    namespace = "dev.amll.hub.android"
    // 依赖（Coil 3.6 / Compose 1.12 / Navigation 2.10 等）要求 compileSdk 37
    compileSdk = 37

    defaultConfig {
        applicationId = "com.amlldev.amllhub"
        minSdk = 26
        // targetSdk 与 compileSdk 独立：这里不跟随升级，
        // 避免在验证编译阶段同时引入 Android 17 的运行时行为变更
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            // 不加 applicationIdSuffix：debug 包也用 com.amlldev.amllhub，
            // 免得装出来的包名和 release 不一致
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 配置齐全时用正式 keystore；否则用 debug key 兜底，保证 assembleRelease 也能跑通
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        // CI 以 lint 为门禁，warning 不阻断
        warningsAsErrors = false
        abortOnError = true
    }
}

// AGP 9 移除了 android.kotlinOptions{}，改用 KGP 顶层 kotlin.compilerOptions{}
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    // XML 主题（Theme.Material3.DayNight.NoActionBar）
    implementation(libs.material)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.kotlinx.coroutines.android)

    // Compose（版本由 BOM 统一管理）
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.animation)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.navigation.compose)

    // 播放（Media3）与内嵌歌词页
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.session)
    implementation(libs.androidx.webkit)

    // 下载标签：MP3（mp3agic）/ FLAC（jaudiotagger）
    implementation(libs.mp3agic)
    implementation(libs.jaudiotagger)
    implementation(libs.slf4j.nop)

    // DI
    implementation(libs.hilt.android)
    implementation(libs.androidx.hilt.navigation.compose)
    ksp(libs.hilt.compiler)

    // 网络
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)

    // 本地存储
    implementation(libs.androidx.datastore.preferences)

    // 图片
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    // 底栏 / 播放条的实时背景模糊
    implementation(libs.haze.core)
    implementation(libs.haze.blur)

    // 扫码
    implementation(libs.mlkit.barcode.scanning)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.concurrent.futures.ktx)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
