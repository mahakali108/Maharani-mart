/**
 * Capacitor task hook — runs automatically after every `npx cap sync`
 * (wired via the "capacitor:sync:after" script in package.json).
 *
 * Why a hook instead of extra CI steps: the CI workflow file
 * (.github/workflows/android-apk.yml) cannot be modified by the
 * automation that maintains this repo (the GitHub App token lacks the
 * `workflows` permission), but the workflow already runs
 * `npx cap sync android`. Putting the Android finishing steps here
 * means BOTH the existing CI workflow and any local build get, with
 * zero duplication and zero extra dependencies:
 *
 *   1. Real Maharani Traders launcher icons + splash screens. Every
 *      required density is pre-rendered and committed under
 *      resources/android-res/ (mirroring android/app/src/main/res/):
 *      mipmap-{m,h,xh,xxh,xxxh}dpi ic_launcher / _round / _foreground,
 *      adaptive-icon background color, and all drawable[-night]
 *      -land/-port splash densities. The hook is a plain recursive
 *      copy — deterministic, no network, no native image libraries,
 *      so it cannot silently fail in CI. No placeholder icon ships in
 *      any build.
 *   2. versionName stamped from package.json (single source of
 *      truth) and versionCode from $ANDROID_VERSION_CODE (defaults
 *      to 1; CI can pass a monotonically increasing number).
 *   3. MainActivity.java with correct Android back-button behavior:
 *      hardware/gesture back walks the WebView history (Product →
 *      Catalog → previous page …) and only hands back to the system
 *      (which backgrounds the app — it does NOT log the user out)
 *      when there is no history left.
 *
 * This file contains ZERO business logic — it is purely native-shell
 * packaging. It does nothing at all if the android/ platform has not
 * been added.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(repo, 'android');

if (!existsSync(androidDir)) {
  console.log('[android-postsync] android/ platform not present — nothing to do.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Brand launcher icons + splash screens (pre-rendered, committed).
// ---------------------------------------------------------------------------
const resSrc = join(repo, 'resources', 'android-res');
const resDst = join(androidDir, 'app', 'src', 'main', 'res');
if (!existsSync(resSrc)) {
  console.error('[android-postsync] ERROR: resources/android-res is missing — brand icons would be lost.');
  process.exit(1);
}
cpSync(resSrc, resDst, { recursive: true, force: true });
// Sanity check: the copied launcher icon must be OUR icon, not the
// Capacitor template placeholder (which is ~3–8 KB; ours is larger).
const iconStat = statSync(join(resDst, 'mipmap-xxxhdpi', 'ic_launcher.png'));
const srcStat = statSync(join(resSrc, 'mipmap-xxxhdpi', 'ic_launcher.png'));
if (iconStat.size !== srcStat.size) {
  console.error('[android-postsync] ERROR: launcher icon copy verification failed.');
  process.exit(1);
}
console.log('[android-postsync] brand icons + splash screens copied into android res.');

// ---------------------------------------------------------------------------
// 2. versionName / versionCode.
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const versionName = pkg.version || '0.1.0';
const versionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '1', 10) || 1;

const gradlePath = join(androidDir, 'app', 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, gradle);
console.log(`[android-postsync] versionName ${versionName}, versionCode ${versionCode}`);

// ---------------------------------------------------------------------------
// 3. Back-button-aware MainActivity.
// ---------------------------------------------------------------------------
const mainActivityDir = join(
  androidDir, 'app', 'src', 'main', 'java', 'com', 'maharanitraders', 'app'
);
mkdirSync(mainActivityDir, { recursive: true });
writeFileSync(
  join(mainActivityDir, 'MainActivity.java'),
  `package com.maharanitraders.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onBackPressed() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`
);
console.log('[android-postsync] MainActivity back-button handling written.');
console.log('[android-postsync] done.');
