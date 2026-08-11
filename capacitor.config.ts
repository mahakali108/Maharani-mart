import type { CapacitorConfig } from '@capacitor/cli';

/**
 * This is a REMOTE-URL Capacitor wrapper, not a bundled static-export
 * app. Reasoning (see AUDIT.md for the full write-up):
 *
 *   - next.config.mjs has no `output: 'export'`, and this project
 *     relies throughout on Server Components, Server Actions
 *     ('use server' files under lib/**), middleware.ts, and
 *     lib/supabase/server.ts (cookie-based sessions + a service-role
 *     admin client). None of that can run as static, bundled HTML/JS
 *     inside a WebView with no server behind it — it needs the real
 *     Next.js server that's already running on Vercel.
 *   - So instead of exporting/bundling the site, this just points the
 *     native WebView at the already-deployed, already-working
 *     production URL. The website itself is completely unmodified —
 *     this file has zero effect on https://maharani-mart-one.vercel.app
 *     itself, only on how the Android app's WebView is configured.
 *
 * `webDir` below is required by the Capacitor CLI for `npx cap add
 * android` to run, but its content is NOT what the app displays —
 * `server.url` overrides it and the WebView navigates straight to the
 * production site on launch. See www/index.html for why that file
 * exists and why it's unused at runtime.
 */
const config: CapacitorConfig = {
  appId: 'com.maharanitraders.app',
  appName: 'Maharani Traders',
  webDir: 'www',
  server: {
    url: 'https://maharani-mart-one.vercel.app',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
