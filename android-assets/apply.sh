#!/usr/bin/env bash
#
# Applies Maharani Traders branding (launcher icons, splash screen) and
# versioning to a freshly generated Capacitor Android project.
#
# The android/ project is generated fresh on every CI run by `npx cap
# add android`, so it is never committed. This script is the single
# source of truth for the native-branding customizations that are not
# already expressed in capacitor.config.ts:
#
#   * launcher icons (legacy + adaptive) at all densities
#   * the splash screen layer-list + logo assets
#   * the Android versionCode / versionName
#
# It is idempotent and safe to run locally against `android/` too:
#     bash android-assets/apply.sh
#
set -euo pipefail

# ---- Config (kept in sync with capacitor.config.ts) -------------------------
APP_NAMESPACE="com.maharanitraders.app"
VERSION_NAME="1.0.0"
VERSION_CODE="1"
BRAND_BLUE="#1D4ED8"
LAUNCH_BACKGROUND="#FFFFFF"

# Locate the android project (repo-root/android).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID="$ROOT/android"
ASSETS="$ROOT/android-assets"

if [ ! -d "$ANDROID" ]; then
  echo "ERROR: android/ project not found. Run 'npx cap add android' first." >&2
  exit 1
fi

RES="$ANDROID/app/src/main/res"

# ---------------------------------------------------------------------------
# 1) Launcher icons
# ---------------------------------------------------------------------------
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  cp "$ASSETS/icon/ic_launcher_${d}.png"           "$RES/mipmap-$d/ic_launcher.png"
  cp "$ASSETS/icon/ic_launcher_round_${d}.png"     "$RES/mipmap-$d/ic_launcher_round.png"
  cp "$ASSETS/icon/ic_launcher_foreground_${d}.png" "$RES/mipmap-$d/ic_launcher_foreground.png"
done

# Adaptive-icon background colour (used by mipmap-anydpi-v26/*.xml).
cat > "$RES/values/ic_launcher_background.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1D4ED8</color>
</resources>
EOF

# ---------------------------------------------------------------------------
# 2) Splash screen — a layer-list so the logo stays centred (never stretched)
#    on any screen size. Replaces Capacitor's generated full-screen splash.png.
# ---------------------------------------------------------------------------
rm -f "$RES"/drawable/splash.png \
      "$RES"/drawable-port-*/splash.png \
      "$RES"/drawable-land-*/splash.png

cp "$ASSETS/splash/splash_logo.png"       "$RES/drawable/splash_logo.png"
cp "$ASSETS/splash/splash_logo_mark.png"  "$RES/drawable/splash_logo_mark.png"

cat > "$RES/drawable/splash.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/launch_background" />
    <item>
        <bitmap
            android:gravity="center"
            android:src="@drawable/splash_logo" />
    </item>
</layer-list>
EOF

# Launch background colour (white) used by the layer-list and the androidx
# splash theme.
cat > "$RES/values/colors.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#1D4ED8</color>
    <color name="colorPrimaryDark">#0B1F66</color>
    <color name="colorAccent">#F5A623</color>
    <color name="launch_background">#FFFFFF</color>
</resources>
EOF

# Launch theme: white window background + centred mark, no splash animation.
cat > "$RES/values/styles.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
    </style>

    <!-- Launch / splash theme. White background with the centred logo; on
         Android 12+ the androidx SplashScreen shows the circular mark. -->
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowSplashScreenBackground">@color/launch_background</item>
        <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_logo_mark</item>
        <item name="android:windowBackground">@drawable/splash</item>
    </style>
</resources>
EOF

# ---------------------------------------------------------------------------
# 3) Versioning
# ---------------------------------------------------------------------------
APP_GRADLE="$ANDROID/app/build.gradle"
if [ -f "$APP_GRADLE" ]; then
  sed -i -E "s/versionCode [0-9]+/versionCode $VERSION_CODE/" "$APP_GRADLE"
  sed -i -E "s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" "$APP_GRADLE"
fi

echo "Android branding applied: namespace=$APP_NAMESPACE version=$VERSION_NAME ($VERSION_CODE)"
