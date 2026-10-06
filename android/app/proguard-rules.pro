# kotlinx.serialization：保留生成的 serializer
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class dev.amll.hub.android.data.remote.** {
    *** Companion;
}
-keepclasseswithmembers class dev.amll.hub.android.data.remote.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit：接口与 suspend 函数的泛型签名
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# OkHttp
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# CameraX + ML Kit 条码识别
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-dontwarn com.google.android.gms.internal.mlkit_vision_barcode.**
