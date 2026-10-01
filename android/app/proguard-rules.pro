# R8 configuration for the Maharani Traders release build.
#
# Shrinking is hardening, never a security control: every authorization decision
# is made by the backend, and nothing here can make an unauthenticated request
# succeed. The rules below only keep the framework entry points R8 cannot infer.

# ---- Kotlin serialization -------------------------------------------------
# Keep the generated serializers for the API DTOs. Retrofit's kotlinx
# serialization converter resolves them reflectively at runtime.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.maharanitraders.core.network.dto.** {
    *** Companion;
}
-keepclasseswithmembers class com.maharanitraders.core.network.dto.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.maharanitraders.core.network.dto.**$$serializer { *; }

# ---- Retrofit / OkHttp ----------------------------------------------------
# Retrofit is interface-based and its annotations are read reflectively.
-keepattributes Signature, Exceptions
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-if interface * { @retrofit2.http.* public *** *(...); }
-keep,allowobfuscation interface <1>
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# ---- Hilt / Dagger --------------------------------------------------------
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }

# ---- Crash/log hygiene ----------------------------------------------------
# Never keep a token-bearing type name in a stack trace beyond the class itself;
# this is a no-op safety net for debugging, not a substitute for the rule that
# tokens are never logged.
-renamesourcefileattribute SourceFile
