package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.SessionDto
import retrofit2.http.GET

/**
 * The versioned mobile API surface.
 *
 * Phase B exposes only the two endpoints that exist on the backend today;
 * every later phase adds its calls here together with the server route and its
 * tests (`docs/NATIVE_ANDROID_API_CONTRACT.md` §2).
 *
 * Authorization is applied by [AuthInterceptor] from the in-memory token held by
 * the session layer — no call site passes a token, so a token cannot end up in
 * a URL, a log line or a crash report.
 */
interface MaharaniApi {

  @GET("api/mobile/v1/health")
  suspend fun health(): ApiEnvelope<HealthDto>

  @GET("api/mobile/v1/session")
  suspend fun session(): ApiEnvelope<SessionDto>
}
