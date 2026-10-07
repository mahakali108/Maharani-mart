package com.maharanitraders.feature.catalog

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.core.datastore.PreferenceStore
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A product the retailer has opened before, as the SERVER described it at the
 * time: identity, name, brand, pack label and artwork.
 *
 * PRICE AND STOCK ARE DELIBERATELY ABSENT. A price cached on the device would
 * be shown as if it were current, and the whole contract of this app is that
 * the server is the only authority on money and availability. The rail says
 * "tap to see today's price" instead, and the product detail fetches the real
 * one — so a recently viewed tile can never quote a stale rate.
 */
data class RecentlyViewedProduct(
  val id: String,
  val name: String,
  val brandName: String? = null,
  val packName: String? = null,
  val imageUrl: String? = null,
)

/**
 * The device-local shopping history: the terms this retailer searched for and
 * the products they opened.
 *
 * WHY LOCAL, AND WHY IT IS ALLOWED TO PERSIST
 * Neither list exists as a server table, and inventing one would be a new
 * backend. Both are ordinary shopping conveniences the web storefront also
 * offers, they belong to exactly one signed-in account, and they are cleared
 * the moment that account's session ends (the store is registered in the
 * session-scoped multibinding, so sign-out, a rejected token and a gate
 * rejection all empty it).
 *
 * WHAT IS NOT STORED: no token, no password, no phone number, no address, no
 * price, no stock, no order and no customer data. Only the product ids and the
 * public display strings the catalogue already showed on screen, plus the terms
 * the shopper typed into the search field. That is the same class of data the
 * app would put in a "recently used" list, and it is safe to lose.
 *
 * The storage is the existing [PreferenceStore] (DataStore, `maharani_preferences`),
 * encoded as delimited records. `kotlinx-serialization` is deliberately not used
 * here: it is a wire format for the API layer, and adding it to this module for
 * two short lists would be a dependency for no behaviour.
 */
@Singleton
class LocalHistoryStore @Inject constructor(
  private val store: PreferenceStore,
) : SessionScopedStore {

  private val loadMutex = Mutex()

  private val _recentSearches = MutableStateFlow<List<String>>(emptyList())
  val recentSearches: StateFlow<List<String>> = _recentSearches.asStateFlow()

  private val _recentlyViewed = MutableStateFlow<List<RecentlyViewedProduct>>(emptyList())
  val recentlyViewed: StateFlow<List<RecentlyViewedProduct>> = _recentlyViewed.asStateFlow()

  @Volatile
  private var loaded = false

  /** Read both lists once per process; safe to call from every screen. */
  suspend fun ensureLoaded() {
    if (loaded) return
    loadMutex.withLock {
      if (loaded) return
      _recentSearches.value = decodeSearches(store.getString(KEY_RECENT_SEARCHES))
      _recentlyViewed.value = decodeProducts(store.getString(KEY_RECENTLY_VIEWED))
      loaded = true
    }
  }

  /**
   * Remember a search term.
   *
   * The newest term leads, an existing occurrence is moved rather than
   * duplicated (case-insensitively — "atta" and "Atta" are one search), blank
   * input is ignored, and the list is capped so the search header never grows
   * into a menu.
   */
  suspend fun recordSearch(term: String) {
    val trimmed = term.trim().take(MAX_TERM_LENGTH)
    if (trimmed.isEmpty()) return
    ensureLoaded()
    val next = buildList {
      add(trimmed)
      _recentSearches.value.filterNot { it.equals(trimmed, ignoreCase = true) }.forEach { add(it) }
    }.take(MAX_SEARCHES)
    _recentSearches.value = next
    store.putString(KEY_RECENT_SEARCHES, encodeSearches(next))
  }

  suspend fun clearSearches() {
    ensureLoaded()
    _recentSearches.value = emptyList()
    store.remove(KEY_RECENT_SEARCHES)
  }

  /**
   * Remember a product view.
   *
   * Re-viewing a product moves it to the front instead of adding a second tile,
   * and the list is capped at [MAX_VIEWED] entries — the rail is a shortcut back
   * to the last few things the shopper was looking at, not a history page.
   */
  suspend fun recordView(product: RecentlyViewedProduct) {
    if (product.id.isBlank()) return
    ensureLoaded()
    val next = buildList {
      add(product.copy(name = product.name.take(MAX_NAME_LENGTH)))
      _recentlyViewed.value.filterNot { it.id == product.id }.forEach { add(it) }
    }.take(MAX_VIEWED)
    _recentlyViewed.value = next
    store.putString(KEY_RECENTLY_VIEWED, encodeProducts(next))
  }

  suspend fun clearRecentlyViewed() {
    ensureLoaded()
    _recentlyViewed.value = emptyList()
    store.remove(KEY_RECENTLY_VIEWED)
  }

  /**
   * The account that owned these lists has gone. Drop both, in memory and on
   * disk, so the next retailer on a shared shop phone cannot see what the
   * previous one searched for.
   */
  override suspend fun onSessionEnded() {
    loaded = false
    _recentSearches.value = emptyList()
    _recentlyViewed.value = emptyList()
    store.remove(KEY_RECENT_SEARCHES)
    store.remove(KEY_RECENTLY_VIEWED)
  }

  private fun encodeSearches(values: List<String>): String = values.joinToString(RECORD) { encode(it) }

  private fun decodeSearches(raw: String?): List<String> {
    if (raw.isNullOrEmpty()) return emptyList()
    return raw.split(RECORD).mapNotNull { decode(it).takeIf { value -> value.isNotEmpty() } }
  }

  private fun encodeProducts(values: List<RecentlyViewedProduct>): String =
    values.joinToString(RECORD) { product ->
      listOf(
        product.id,
        product.name,
        product.brandName.orEmpty(),
        product.packName.orEmpty(),
        product.imageUrl.orEmpty(),
      ).joinToString(FIELD) { encode(it) }
    }

  private fun decodeProducts(raw: String?): List<RecentlyViewedProduct> {
    if (raw.isNullOrEmpty()) return emptyList()
    return raw.split(RECORD).mapNotNull { record ->
      val fields = record.split(FIELD).map { decode(it) }
      val id = fields.elementAtOrNull(0).orEmpty()
      val name = fields.elementAtOrNull(1).orEmpty()
      if (id.isEmpty() || name.isEmpty()) return@mapNotNull null
      RecentlyViewedProduct(
        id = id,
        name = name,
        brandName = fields.elementAtOrNull(2)?.takeIf { it.isNotEmpty() },
        packName = fields.elementAtOrNull(3)?.takeIf { it.isNotEmpty() },
        imageUrl = fields.elementAtOrNull(4)?.takeIf { it.isNotEmpty() },
      )
    }
  }

  /** Percent-escape the two delimiters and `%` itself, so fields cannot merge. */
  private fun encode(value: String): String = value
    .replace("%", "%25")
    .replace(RECORD.toString(), "%1F")
    .replace(FIELD.toString(), "%1E")

  private fun decode(value: String): String = value
    .replace("%1F", RECORD.toString())
    .replace("%1E", FIELD.toString())
    .replace("%25", "%")

  private companion object {
    const val KEY_RECENT_SEARCHES = "recent_searches_v1"
    const val KEY_RECENTLY_VIEWED = "recently_viewed_v1"
    const val RECORD = '\u001F'
    const val FIELD = '\u001E'
    const val MAX_SEARCHES = 8
    const val MAX_VIEWED = 12
    const val MAX_TERM_LENGTH = 60
    const val MAX_NAME_LENGTH = 120
  }
}
