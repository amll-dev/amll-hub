package dev.amll.hub.android.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 用 Android Keystore 里的 AES-GCM 密钥加密登录 token。
 *
 * 密文格式：`v1:` + Base64(IV(12B) + ciphertext)。
 * 密钥不出 Keystore，卸载重装后旧密文自然失效。
 */
internal class TokenCipher {

    private val keyStore: KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.encodeToString(iv + encrypted, Base64.NO_WRAP)
    }

    /** 解密失败（密钥被清除、数据损坏、旧版本明文）时返回 null */
    fun decrypt(stored: String): String? = runCatching {
        if (!stored.startsWith(PREFIX)) return@runCatching null
        val raw = Base64.decode(stored.removePrefix(PREFIX), Base64.NO_WRAP)
        if (raw.size <= IV_SIZE) return@runCatching null
        val iv = raw.copyOfRange(0, IV_SIZE)
        val payload = raw.copyOfRange(IV_SIZE, raw.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
        cipher.doFinal(payload).toString(Charsets.UTF_8).takeIf { it.isNotBlank() }
    }.onFailure {
        Log.w(TAG, "token decrypt failed", it)
    }.getOrNull()

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val TAG = "TokenCipher"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "amll_hub_token_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PREFIX = "v1:"
        const val IV_SIZE = 12
        const val TAG_BITS = 128
    }
}
