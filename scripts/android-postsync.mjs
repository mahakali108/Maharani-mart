/**
 * Capacitor task hook — runs automatically after every `npx cap sync`
 * (wired via the "capacitor:sync:after" script in package.json).
 *
 * Why a hook instead of extra CI steps: the Android finishing steps
 * below must behave identically for CI builds, local builds, and any
 * other workflow that runs `npx cap sync`. Keeping them here means
 * every environment gets, with zero duplication and zero extra
 * dependencies:
 *
 *   1. Real Maharani Traders launcher icons + splash screens. Every
 *      required density is pre-rendered and committed under
 *      resources/android-res/ (mirroring android/app/src/main/res/):
 *      mipmap-{m,h,xh,xxh,xxxh}dpi ic_launcher / _round / _foreground,
 *      adaptive-icon background color, and all drawable-land/-port[-night]
 *      splash densities. Directory names are validated against Android's
 *      canonical resource-qualifier order before anything is copied (see
 *      scripts/android-resource-validation.mjs, which is shared with the
 *      CI workflow), so an invalid name such as drawable-night-port-hdpi
 *      can never reach Gradle again. The hook is a plain recursive copy —
 *      deterministic, no network, no native image libraries, so it cannot
 *      silently fail in CI. No placeholder icon ships in any build.
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
import {
  INVALID_DIR_HELP,
  findInvalidResourceDirs,
} from './android-resource-validation.mjs';

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

/**
 * Android resource directories must list their qualifiers in ONE canonical
 * order — Table 2 of
 * https://developer.android.com/guide/topics/resources/providing-resources
 * (… → screen orientation `port`/`land` → UI mode → night mode `night`/
 * `notnight` → screen density `mdpi`…`xxxhdpi` → …). A directory such as
 * `drawable-night-port-hdpi` puts `night` before `port` and is rejected by
 * the Android resource merger with "Invalid resource directory name",
 * failing :app:mergeDebugResources. This bit us once
 * (resources committed as drawable-night-land/-port-*); validate the source
 * tree here so it can never reach Gradle again — the hook fails fast with
 * a clear message instead of a cryptic CI failure.
 *
 * Known qualifier tokens are checked for strictly-increasing precedence.
 * Tokens this validator cannot positively recognize (locale codes,
 * sw<N>dp/w<N>dp/h<N>dp, b+47 tags, …) cause that directory to be skipped,
 * so the check can never reject a valid directory it doesn't understand.
 */
const invalidDirs = findInvalidResourceDirs(resSrc);
if (invalidDirs.length > 0) {
  console.error('[android-postsync] ERROR: invalid Android resource directory name(s) in resources/android-res:');
  for (const dir of invalidDirs) console.error(`  - ${dir}`);
  console.error(INVALID_DIR_HELP);
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
