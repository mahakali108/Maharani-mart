package com.maharanitraders.feature.orders.di

import com.maharanitraders.feature.orders.CommerceRepository
import com.maharanitraders.feature.orders.NetworkCommerceRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class OrdersFeatureModule {
  @Binds
  @Singleton
  abstract fun bindCommerceRepository(impl: NetworkCommerceRepository): CommerceRepository
}
