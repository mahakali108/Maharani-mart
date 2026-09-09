import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister';
import InstallPrompt from '@/components/pwa/InstallPrompt';

// Poppins is self-hosted via @fontsource (imported in globals.css) and the
// `--font-sans` variable is defined there too — so this layout no longer
// needs next/font/google, which requires network access at build time.

export const metadata: Metadata = {
  title: 'Maharani Traders — Order everyday products by the piece',
  description:
    'Maharani Traders is the simple, mobile-first ordering app for small retailers. Browse products, place orders and reorder essentials — all in pieces.',
  applicationName: 'Maharani Traders',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Maharani Traders',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Expose the notch/home-indicator insets so the sticky header and the
  // bottom navigation can pad with env(safe-area-inset-*) on Android /
  // Capacitor (no visual change on web where the insets are 0).
  viewportFit: 'cover',
  themeColor: '#c8102e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <Analytics />
        {/* PWA: registers the service worker (browser only) and shows an
            optional, dismissible install prompt. No effect on Capacitor. */}
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
