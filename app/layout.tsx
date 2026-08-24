import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

// Poppins is self-hosted via @fontsource (imported in globals.css) and the
// `--font-sans` variable is defined there too — so this layout no longer
// needs next/font/google, which requires network access at build time.

export const metadata: Metadata = {
  title: 'Maa Kali B2B Ultra Platform',
  description: 'FMCG B2B Wholesale Distribution — Khagaria District',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#c8102e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
