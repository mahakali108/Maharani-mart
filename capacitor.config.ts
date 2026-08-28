import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Maharani Traders — Capacitor (remote-URL WebView wrapper).
 *
 * The Maharani Traders platform is a Next.js + Supabase B2B application
 * that is deployed on Vercel and depends on Server Components, Server
 * Actions, middleware.ts and cookie-based Supabase sessions. None of that
 * can run as static, bundled HTML/JS inside a WebView with no server
 * behind it — so this wrapper points the native Android WebView at the
 * live, already-working production deployment. The website itself is
 * completely unmodified; this file only configures the native shell.
 *
 * PRODUCTION URL
 * --------------
 * The verified production domain (the project's auto-generated Vercel
 * production alias) is:
 *     https://maharani-mart-mahakali108s-projects.vercel.app
 *
 * If the production domain ever changes, update ONLY `server.url` here
 * and re-run the Android build — no other code changes are needed.
 *
 * NOTE: As of this build the Vercel deployment is configured with
 * "Deployment Protection" (Authentication) enabled, so anonymous
 * requests (including this WebView) receive a Vercel login challenge
 * rather than the app. Production Deployments Protection must be
 * disabled in the Vercel project settings for the Android app to load
 * the site. See docs/android.md.
 *
 * `webDir` is required by the Capacitor CLI for `npx cap add android`,
 * but its content is NOT what the app displays — `server.url` overrides
 * it and the WebView navigates straight to the production site on
 * launch. See www/index.html for why that file exists.
 */
const config: CapacitorConfig = {
  appId: 'com.maharanitraders.app',
  appName: 'Maharani Traders',
  webDir: 'www',
  server: {
    url: 'https://maharani-mart-mahakali108s-projects.vercel.app',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      // The launch "splash" is the themed window background (white with a
      // centred Maharani Traders logo) drawn by android-assets/apply.sh.
      // It appears immediately on cold start and is dismissed as soon as
      // the WebView paints the production site — fast, no fake progress.
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
  },
};

export default config;
