package com.maharanitraders.core.common

/**
 * A store whose contents belong to exactly ONE signed-in account.
 *
 * WHY THIS EXISTS
 * Favourite ids, the cart badge count and the unread-notification count are all
 * read once per process and cached in memory. They are server data for
 * *whoever is signed in*, so when the session ends — sign-out, a rejected
 * token, a suspended shop — the cached copy must go with it. A store that keeps
 * the previous account's answer is how account A's favourites appear under
 * account B on a shared shop phone, which is exactly the leak the multi-account
 * rule in `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` forbids.
 *
 * The session layer (`core:auth`) is the only caller: on every session
 * transition that ends a session it asks each registered store to drop what it
 * holds. Nothing here touches the network or the token store, so a store can
 * never resurrect a signed-out session.
 *
 * Registered as a Hilt multibinding (`@IntoSet`), so a feature module can make
 * its own caches session-aware without `core:auth` depending on the feature.
 */
interface SessionScopedStore {

  /**
   * Drop everything this store cached for the account that was signed in.
   *
   * Implementations must be idempotent and must not throw for the ordinary
   * "nothing loaded yet" case; a failure is caught by the session layer, which
   * still completes the sign-out.
   */
  suspend fun onSessionEnded()
}
