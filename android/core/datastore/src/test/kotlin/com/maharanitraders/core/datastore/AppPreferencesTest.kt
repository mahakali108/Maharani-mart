package com.maharanitraders.core.datastore

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Preferences behaviour, tested against the [PreferenceStore] contract so the
 * logic is verified without a device (the DataStore adapter is a thin mapping).
 */
class AppPreferencesTest {

  private val store = InMemoryPreferenceStore()
  private val preferences = AppPreferences(store)

  @Test
  fun `session sync time is recorded and read back`() = runTest {
    assertNull(preferences.lastSessionSyncAt())
    preferences.recordSessionSync(1_700_000_000)
    assertEquals(1_700_000_000L, preferences.lastSessionSyncAt())
  }

  @Test
  fun `selected workspace round-trips`() = runTest {
    assertNull(preferences.selectedWorkspaceId())
    preferences.setSelectedWorkspace("retailer")
    assertEquals("retailer", preferences.selectedWorkspaceId())
  }

  @Test
  fun `pending order request key is stable until confirmed success clears it`() = runTest {
    val first = preferences.getOrCreatePendingOrderRequestKey()
    val retry = preferences.getOrCreatePendingOrderRequestKey()

    assertTrue(first.isNotBlank())
    assertEquals(first, retry)

    preferences.clearPendingOrderRequestKey()
    assertTrue(preferences.getOrCreatePendingOrderRequestKey() != first)
  }

  @Test
  fun `sign-out clears a pending order idempotency key`() = runTest {
    val pending = preferences.getOrCreatePendingOrderRequestKey()
    preferences.clearSessionScoped()

    assertTrue(preferences.getOrCreatePendingOrderRequestKey() != pending)
  }

  @Test
  fun `the notification prompt is offered exactly once`() = runTest {
    assertTrue(preferences.shouldOfferNotificationPrompt())
    preferences.markNotificationPromptShown()
    assertFalse(preferences.shouldOfferNotificationPrompt())
  }

  @Test
  fun `sign-out clears session-scoped preferences but keeps nothing sensitive`() = runTest {
    preferences.recordSessionSync(1)
    preferences.setSelectedWorkspace("retailer")

    preferences.clearSessionScoped()

    assertNull(preferences.lastSessionSyncAt())
    assertNull(preferences.selectedWorkspaceId())
    // The prompt flag is device-level, not session-level, and is retained.
    assertTrue(preferences.shouldOfferNotificationPrompt())
  }

  @Test
  fun `removing a key clears every typed representation`() = runTest {
    store.putString("mixed", "value")
    store.putBoolean("mixed", true)
    store.putLong("mixed", 5)

    store.remove("mixed")

    assertNull(store.getString("mixed"))
    assertNull(store.getBoolean("mixed"))
    assertNull(store.getLong("mixed"))
  }
}

/** Deterministic in-memory double for [PreferenceStore]. */
class InMemoryPreferenceStore : PreferenceStore {
  private val values = mutableMapOf<String, Any>()

  override suspend fun getString(key: String): String? = values[key] as? String

  override suspend fun putString(key: String, value: String) {
    values[key] = value
  }

  override suspend fun getBoolean(key: String): Boolean? = values[key] as? Boolean

  override suspend fun putBoolean(key: String, value: Boolean) {
    values[key] = value
  }

  override suspend fun getLong(key: String): Long? = values[key] as? Long

  override suspend fun putLong(key: String, value: Long) {
    values[key] = value
  }

  override suspend fun remove(key: String) {
    values.remove(key)
  }
}
