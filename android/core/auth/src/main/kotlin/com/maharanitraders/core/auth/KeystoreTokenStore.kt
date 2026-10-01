package com.maharanitraders.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.maharanitraders.core.common.di.IoDispatcher
import com.maharanitraders.core.model.SessionTokens
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Session tokens encrypted with an AES-256-GCM key held in the Android
 * Keystore. The ciphertext lives in app-private storage; the key material never
 * leaves the Keystore and is never exportable.
 *
 * Design choices:
 *  - GCM is authenticated: a tampered file fails to decrypt and the app treats
 *    it as "signed out" rather than crashing or trusting garbage.
 *  - No `setUserAuthenticationRequired(true)`: requiring a biometric prompt on
 *    every restore would be a product decision, not an implementation detail.
 *    It can be enabled later without changing the stored format.
 *  - If the Keystore is unavailable or the key was invalidated (device
 *    restore/app data copy), reads fail closed: the user signs in again.
 */
@Singleton
class KeystoreTokenStore @Inject constructor(
  @ApplicationContext private val context: Context,
  @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) : TokenStore {

  private val file: File get() = File(context.filesDir, FILE_NAME)

  override suspend fun read(): SessionTokens? = withContext(ioDispatcher) {
    if (!file.exists()) return@withContext null
    try {
      val bytes = file.readBytes()
      if (bytes.size <= IV_LENGTH) return@withContext null

      val iv = bytes.copyOfRange(0, IV_LENGTH)
      val cipherText = bytes.copyOfRange(IV_LENGTH, bytes.size)

      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
      val plain = cipher.doFinal(cipherText).toString(Charsets.UTF_8)
      TokenPayloadCodec.parse(plain)
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // Tampered, rotated or unreadable: fail closed.
      null
    }
  }

  override suspend fun write(tokens: SessionTokens) = withContext(ioDispatcher) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(TokenPayloadCodec.serialize(tokens).toByteArray(Charsets.UTF_8))
    file.writeBytes(cipher.iv + encrypted)
    Unit
  }

  override suspend fun clear() = withContext(ioDispatcher) {
    if (file.exists()) file.delete()
    Unit
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
    if (existing != null) return existing.secretKey

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(KEY_SIZE_BITS)
        .build()
    )
    return generator.generateKey()
  }

  private companion object {
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val KEY_ALIAS = "maharani.session.v1"
    const val FILE_NAME = "maharani.session.bin"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_LENGTH = 12
    const val TAG_LENGTH_BITS = 128
    const val KEY_SIZE_BITS = 256
  }
}
