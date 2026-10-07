package com.maharanitraders.feature.catalog.di

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.feature.catalog.CatalogRepository
import com.maharanitraders.feature.catalog.FavoritesStore
import com.maharanitraders.feature.catalog.LocalHistoryStore
import com.maharanitraders.feature.catalog.NetworkCatalogRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import javax.inject.Singleton

/**
 * Phase D wiring.
 *
 * The only binding is [CatalogRepository] to [NetworkCatalogRepository]. There
 * is deliberately no offline or sample implementation to bind: the migration
 * contract forbids mock products in production UI, and a binding that could
 * return them would be the easiest way to break that promise by accident.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class CatalogFeatureModule {

  @Binds
  @Singleton
  abstract fun bindCatalogRepository(impl: NetworkCatalogRepository): CatalogRepository

  /**
   * The favourite set is per-account, so it joins the session-scoped set the
   * session layer clears on sign-out. Bound (rather than provided) because the
   * store is already `@Inject`-constructible and a singleton.
   */
  @Binds
  @IntoSet
  abstract fun bindFavoritesSessionScoped(impl: FavoritesStore): SessionScopedStore

  /**
   * The search/recently-viewed history is device-local state for ONE account, so
   * it joins the same set: sign-out (or a rejected token) empties it before the
   * next retailer can use the phone, and the lists are dropped from disk as well
   * as from memory.
   */
  @Binds
  @IntoSet
  abstract fun bindLocalHistorySessionScoped(impl: LocalHistoryStore): SessionScopedStore
}
