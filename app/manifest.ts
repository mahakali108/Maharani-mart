import type { MetadataRoute } from 'next';

/**
 * Web app manifest for Maharani Traders.
 *
 * Served by Next.js at /manifest.webmanifest. This is what makes the site
 * installable as a PWA on Android Chrome / other browsers.
 *
 * Security note: the service worker (public/sw.js) deliberately does NOT
 * cache any authenticated HTML or user-specific data, so nothing here
 * exposes private information. The icons reuse the existing brand art in
 * resources/icon-only.png (generated into public/icons).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Maharani Traders',
    short_name: 'Maharani Traders',
    description:
      'Maharani Traders — FMCG B2B Wholesale Distribution for Khagaria District. Browse the wholesale catalog, place orders, and track credit.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#c8102e',
    categories: ['business', 'shopping', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Catalog',
        short_name: 'Catalog',
        description: 'Browse the wholesale product catalog',
        url: '/retailer/catalog',
      },
      {
        name: 'My Orders',
        short_name: 'Orders',
        description: 'View your past and current orders',
        url: '/retailer/orders',
      },
    ],
  };
}
