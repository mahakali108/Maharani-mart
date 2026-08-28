import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Maharani Traders — Android app configuration.
 *
 * This is a REMOTE-URL Capacitor wrapper, not a bundled static-export
 * app. Reasoning (see AUDIT_ANDROID.md for the full write-up):
 *
 *   - next.config.mjs has no `output: 'export'`, and this project
 *     relies throughout on Server Components, Server Actions
 *     ('use server' files under lib/**), middleware.ts, and
 *     lib/supabase/server.ts (cookie-based sessions + a service-role
 *     admin client). None of that can run as static, bundled HTML/JS
 *     inside a WebView with no server behind it — it needs the real
 *     Next.js server that's already running on Vercel.
 *   - So instead of exporting/bundling the site, this points the
 *     native WebView at the already-deployed production URL. The
 *     website itself is completely unmodified. No business logic,
 *     pricing, GST, MOQ, credit, or authorization is duplicated in
 *     the Android layer — the server remains authoritative.
 *
 * PRODUCTION URL — single source of truth
 * ---------------------------------------
 * The URL below is the only place the Android app's target is
 * defined. To repoint the app (e.g. after adding a custom domain),
 * either edit PRODUCTION_URL or set the CAP_SERVER_URL environment
 * variable when running `npx cap sync` / the CI build.
 *
 * NOTE: the previous URL (maharani-mart-one.vercel.app) now returns
 * DEPLOYMENT_NOT_FOUND. The current Vercel production alias is the
 * team-scoped URL below. IMPORTANT: Vercel "Deployment Protection"
 * (Vercel Authentication) MUST be disabled for the Production
 * environment of this project, otherwise the WebView (and any
 * customer browser) is redirected to a Vercel SSO login instead of
 * the app. Vercel dashboard → Project → Settings → Deployment
 * Protection → set to "Only Preview Deployments" or "Disabled".
 *
 * `webDir` is required by the Capacitor CLI for `npx cap add android`
 * to run. At runtime it only serves `server.errorPath` (the offline
 * screen); `server.url` overrides everything else and the WebView
 * navigates straight to the production site on launch.
 */
const PRODUCTION_URL =
  process.env.CAP_SERVER_URL ?? 'https://maharani-mart-mahakali108s-projects.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.maharanitraders.app',
  appName: 'Maharani Traders',
  webDir: 'www',
  server: {
    url: PRODUCTION_URL,
    androidScheme: 'https',
    cleartext: false,
    // Shown from the local webDir when the remote URL cannot be
    // loaded (no internet / server unreachable). Provides a branded
    // "No internet connection" screen with a Retry button instead of
    // the stock WebView error page. No order/cart action is faked —
    // this is purely a connectivity screen.
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
