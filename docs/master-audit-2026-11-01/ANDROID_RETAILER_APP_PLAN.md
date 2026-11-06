# Retailer Android plan

2026-11-01. Recommendation: continue the **existing** native Kotlin/Jetpack Compose code, subject to owner approval; do not create an APK/AAB, run the manual APK workflow or publish without a separate approved build/release plan. Seller/admin remain web-only. Flutter is not proposed.

## Evidence / comparison

`android/` is committed: Kotlin/Compose, Gradle multi-module `core/{auth,common,datastore,designsystem,model,network}`, `feature/{auth,catalog,engagement,orders}`. Source pins Kotlin 2.4.20, AGP 9.0.1, Gradle 9.1.0, compile/target 36, min 24, Retrofit/OkHttp/Hilt and Compose. Manifest requests INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, disables backup/cleartext; no App Link intent filter. The explicit production status is **unverified**: historical parity docs and comments disagree about whether native is actively delivered; source existence is not release evidence.

| Option | Fit | Maintenance/cost | Decision |
|---|---|---|---|
| Existing native Kotlin/Compose | Reuses implementation and `/api/mobile/v1`, OS lifecycle/security | Two UI codebases and Android expertise; Gradle/JDK/SDK development free, hosting/CI/device testing may cost | Recommend audit, repair and reuse |
| Existing PWA alone | Shares UI and backend, lowest duplication; not independently a native Android package | Requires browser and PWA support; device features differ | Preserve as independent experience, not substitute for requested native app |
| Cross-platform rewrite | Discards existing native investment; added ecosystem | New maintenance/migration burden | Not recommended; no Flutter without explicit consent |

## Feature matrix / gaps

Historical `docs/NATIVE_PWA_FEATURE_PARITY.md` maps real source screens/API to auth, catalog, cart, order, favorites, notifications and support, but dated rows and mock/JVM evidence are not live acceptance. Invoice display is not proof of a GST-compliant invoice. Membership source retired paid plans; requested upgrade/renewal/history absent as approved production functionality. Verify all requested features including profile/business data, search/filter, slabs, order/cancellation/returns, COD, rewards, banners, grievance, deletion and notifications individually in current code and staging. Account request is not proof of deletion. No current real-device result is claimed.

## Proposed implementation order

1. Reconcile target audience: verify server rejects non-retailer roles for every mobile route and all app navigation; don't merely hide admin UI. Map app/api compatibility and existing screens before changing.
2. Test secure Keystore-backed token storage, refresh race, logout/global logout, offline errors, account switching, app process death and device backup. Avoid hardcoded credentials. Use verified HTTPS domain and least permissions; confirm whether POST_NOTIFICATIONS is justified.
3. Prototype homepage first using approved berry/pink marketing tokens, accessible contrast and existing brand assets; preserve violet elsewhere. User test at 320–tablet widths and screen readers.
4. Inventory every requested feature and backend blocker. Offline catalog cache only with explicit TTL, no checkout or durable sensitive caching offline; online server revalidates prices, availability and order idempotency.
5. Secure verified App Links require owner-approved domain association and signing fingerprint; existing recovery opens web. Model untrusted link parameters, expiry, CSRF/token exchange; no unverified shortcut. Agree version/update mechanism and supported devices.
6. In isolated test environment run JVM and Compose/UI tests, instrumentation across supported OS/device sizes, network failure, accessibility, lifecycle, auth, checkout and permission audits. Validate dependency availability/compatibility on the build runner; current environment did not build.
7. Separate release plan: application ID, Play ownership, signing custody, target API requirements at release date, privacy/data-safety disclosures, reproducible CI, artifact retention and rollback. Play registration/paid provider costs need owner review. No sign, artifact, store account, build or deploy without explicit approval.

GitHub Free permits a modest Linux CI budget, but native build resource usage is variable; monitor limits. Default workflow is manually dispatched and would generate artifacts, so leave it untouched.
