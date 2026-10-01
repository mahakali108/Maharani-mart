package com.maharanitraders.core.network.di

import com.maharanitraders.core.network.AuthInterceptor
import com.maharanitraders.core.network.TokenProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared transport must not retry mutations, follow redirects, or log requests. */
class NetworkModuleSecurityTest {

  @Test
  fun `client disables automatic retries and redirects and has no logger`() {
    val client = NetworkModule.provideOkHttpClient(TokenProvider { null })

    assertFalse(client.retryOnConnectionFailure)
    assertFalse(client.followRedirects)
    assertFalse(client.followSslRedirects)
    assertEquals(1, client.interceptors.size)
    assertTrue(client.interceptors.single() is AuthInterceptor)
    assertTrue(client.networkInterceptors.isEmpty())
  }
}
