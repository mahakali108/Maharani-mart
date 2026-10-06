package com.maharanitraders.feature.orders.di

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.feature.orders.CartCountStore
import com.maharanitraders.feature.orders.CommerceRepository
import com.maharanitraders.feature.orders.NetworkCommerceRepository
import com.maharanitraders.feature.orders.NetworkQuickOrderRepository
import com.maharanitraders.feature.orders.QuickOrderRepository
import com.maharanitraders.feature.orders.NetworkSavedCartsRepository
import com.maharanitraders.feature.orders.SavedCartsRepository
import com.maharanitraders.feature.orders.NetworkRetailerOrderActionsRepository
import com.maharanitraders.feature.orders.RetailerOrderActionsRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class OrdersFeatureModule {
  @Binds
  @Singleton
  abstract fun bindCommerceRepository(impl: NetworkCommerceRepository): CommerceRepository

  // QuickOrderViewModel asks for the interface; NetworkQuickOrderRepository is
  // itself @Inject-constructible, but only this binding makes it answerable.
  @Binds
  @Singleton
  abstract fun bindQuickOrderRepository(impl: NetworkQuickOrderRepository): QuickOrderRepository

  @Binds
  @Singleton
  abstract fun bindSavedCartsRepository(impl: NetworkSavedCartsRepository): SavedCartsRepository

  @Binds
  @Singleton
  abstract fun bindOrderActionsRepository(impl: NetworkRetailerOrderActionsRepository): RetailerOrderActionsRepository

  /** The cart badge count is the signed-in account's cart, so it goes with the session. */
  @Binds
  @IntoSet
  abstract fun bindCartCountSessionScoped(impl: CartCountStore): SessionScopedStore
}
