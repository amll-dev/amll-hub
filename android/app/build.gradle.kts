import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

// 从 local.properties 或环境变量读 API Base URL，缺失时回落到 beta 线上后端
val apiBaseUrl: String = run {
    val fromLocal = rootProject.file("local.properties")
        .takeIf { it.exists() }
        ?.let { file -> Properties().apply { file.inputStream().use(::load) }.getProperty("amll.api.baseUrl") }
    val fromEnv = System.getenv("AMLL_API_BASE_URL")
    fromLocal?.takeIf { it.isNotBlank() }
        ?: fromEnv?.takeIf { it.isNotBlank() }
        ?: "https://api.beta.amllhub.bikonoo.com"
}

android {
    namespace = "dev.amll.hub.android"
    // 依赖（Coil 3.6 / Compose 1.12 / Navigation 2.10 等）要求 compileSdk 37
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.amll.hub.android"
        minSdk = 26
        // targetSdk 与 compileSdk 独立：这里不跟随升级，
        // 避免在验证编译阶段同时引入 Android 17 的运行时行为变更
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 未配置签名时用debug key，保证 assembleRelease 也能跑通（CI 只出 debug 包）
            signingConfig = signingConfigs.getByName("debug")
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
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.kotlinx.coroutines.android)

    // Compose（版本由 BOM 统一管理）
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.navigation.compose)

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
