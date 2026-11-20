import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { BRAND } from '@/lib/brand';

// Poppins is self-hosted via @fontsource (imported in globals.css) and the
// `--font-sans` variable is defined there too — so this layout no longer
// needs next/font/google, which requires network access at build time.

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    `${BRAND.name} is a wholesale ordering PWA for approved retailers, trading as ${BRAND.tradingStyle}. Browse the catalogue and place orders at configured serviceable addresses.`,
  applicationName: BRAND.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: BRAND.name,
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Browser PWA: respect pinch zoom and text magnification for accessibility.
  // Keep safe-area padding for mobile browser chrome/notches.
  viewportFit: 'cover',
  themeColor: '#5142B8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <Analytics />
        {/* PWA: browser-only service worker and optional install prompt. */}
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
