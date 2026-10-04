package com.maharanitraders.core.datastore

import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Narrow key/value contract so preferences logic stays pure and testable.
 * The production implementation is DataStore ([DataStorePreferenceStore]).
 */
interface PreferenceStore {
  suspend fun getString(key: String): String?

  suspend fun putString(key: String, value: String)

  suspend fun getBoolean(key: String): Boolean?

  suspend fun putBoolean(key: String, value: Boolean)

  suspend fun getLong(key: String): Long?

  suspend fun putLong(key: String, value: Long)

  suspend fun remove(key: String)
}

/**
 * NON-SENSITIVE preferences only.
 *
 * Hard rule from the migration contract: tokens, credentials, phone numbers or
 * any customer/payment data never live here — tokens are Keystore-encrypted
 * (`core:auth`) and everything else belongs on the server. The keys below are
 * deliberately boring, and anything added must be equally safe to leak to a
 * device backup or a bug report.
 */
@Singleton
class AppPreferences @Inject constructor(
  private val store: PreferenceStore,
) {
  private val pendingOrderRequestKeyMutex = Mutex()

  /** Epoch seconds of the last successful session bootstrap. */
  suspend fun lastSessionSyncAt(): Long? = store.getLong(KEY_LAST_SESSION_SYNC_AT)

  suspend fun recordSessionSync(atEpochSeconds: Long) {
    store.putLong(KEY_LAST_SESSION_SYNC_AT, atEpochSeconds)
  }

  /** Which workspace the user last entered (a route id, never a tenant id). */
  suspend fun selectedWorkspaceId(): String? = store.getString(KEY_SELECTED_WORKSPACE)

  suspend fun setSelectedWorkspace(workspaceId: String) {
    store.putString(KEY_SELECTED_WORKSPACE, workspaceId)
  }

  /**
   * Stable idempotency key for an order submission. It is persisted before the
   * first request and deliberately survives timeouts/process death so an
   * uncertain response can only replay the same logical order.
   */
  suspend fun pendingOrderRequestKey(): String? =
    store.getString(KEY_PENDING_ORDER_REQUEST)?.takeIf { it.isNotBlank() }

  suspend fun getOrCreatePendingOrderRequestKey(): String = pendingOrderRequestKeyMutex.withLock {
    store.getString(KEY_PENDING_ORDER_REQUEST)?.takeIf { it.isNotBlank() }
      ?: UUID.randomUUID().toString().also { store.putString(KEY_PENDING_ORDER_REQUEST, it) }
  }

  /** Called only after the server confirms success or the account signs out. */
  suspend fun clearPendingOrderRequestKey() {
    pendingOrderRequestKeyMutex.withLock { store.remove(KEY_PENDING_ORDER_REQUEST) }
  }

  /**
   * The notification permission prompt is offered once; after that the app only
   * links to system settings. (Push delivery itself needs provider credentials
   * — see docs/NATIVE_ANDROID_MIGRATION_AUDIT.md §8 — so this flag only tracks
   * whether the user has been asked.)
   */
  suspend fun shouldOfferNotificationPrompt(): Boolean =
    store.getBoolean(KEY_NOTIFICATION_PROMPT_SHOWN) != true

  suspend fun markNotificationPromptShown() {
    store.putBoolean(KEY_NOTIFICATION_PROMPT_SHOWN, true)
  }

  /** Clears session-scoped state on sign-out or before accepting a fresh login. */
  suspend fun clearSessionScoped() {
    store.remove(KEY_LAST_SESSION_SYNC_AT)
    store.remove(KEY_SELECTED_WORKSPACE)
    clearPendingOrderRequestKey()
  }

  private companion object {
    const val KEY_LAST_SESSION_SYNC_AT = "last_session_sync_at"
    const val KEY_SELECTED_WORKSPACE = "selected_workspace"
    const val KEY_NOTIFICATION_PROMPT_SHOWN = "notification_prompt_shown"
    const val KEY_PENDING_ORDER_REQUEST = "pending_order_request"
  }
}
