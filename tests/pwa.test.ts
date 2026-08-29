import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../app/manifest';

const root = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('PWA manifest (app/manifest.ts)', () => {
  const m = manifest();

  it('has the required installable fields', () => {
    expect(m.name).toBe('Maharani Traders');
    expect(m.short_name).toBe('Maharani Traders');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.orientation).toBe('portrait');
    expect(m.theme_color).toBe('#c8102e');
    expect(m.background_color).toBe('#ffffff');
    expect(Array.isArray(m.categories)).toBe(true);
    expect(m.categories).toContain('business');
  });

  it('declares a 192 icon and a maskable 512 icon', () => {
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});

describe('PWA icons exist on disk', () => {
  const files = [
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'public/icons/icon-maskable-512.png',
    'public/favicon.ico',
    'public/apple-touch-icon.png',
  ];
  for (const f of files) {
    it(`exists and is non-empty: ${f}`, () => {
      expect(existsSync(join(root, f))).toBe(true);
      expect(statSync(join(root, f)).size).toBeGreaterThan(0);
    });
  }
});

describe('Service worker security (public/sw.js)', () => {
  const sw = read('public/sw.js');

  it('never caches non-GET (mutating) requests', () => {
    expect(sw).toContain("if (request.method !== 'GET') return;");
  });

  it('treats /api and Supabase as network-only (never cached)', () => {
    expect(sw).toContain('function isApi');
    expect(sw).toContain('function isSupabase');
    expect(sw).toContain('if (isApi(url) || isSupabase(url)) return;');
  });

  it('caches only static assets, never navigations or user data', () => {
    expect(sw).toContain("if (request.mode === 'navigate')");
    expect(sw).toContain('STATIC_CACHE');
    expect(sw).toContain('cache.put(request, res.clone())');
    // The static cache.put must come AFTER the network-only navigate branch,
    // so authenticated HTML is never written to cache.
    const navigateIdx = sw.indexOf("if (request.mode === 'navigate')");
    const putIdx = sw.indexOf('cache.put(request, res.clone())');
    expect(navigateIdx).toBeGreaterThan(-1);
    expect(putIdx).toBeGreaterThan(navigateIdx);
  });

  it('only writes to cache from the static-asset branch (after the network-only guards)', () => {
    // There must be exactly one cache.put, and it must come AFTER the
    // isApi/isSupabase early-return, so auth/session/user data is never stored.
    const putCount = (sw.match(/cache\.put\(/g) || []).length;
    expect(putCount).toBe(1);
    const apiReturn = sw.indexOf('if (isApi(url) || isSupabase(url)) return;');
    const putIdx = sw.indexOf('cache.put(');
    expect(apiReturn).toBeGreaterThan(-1);
    expect(putIdx).toBeGreaterThan(apiReturn);
  });
});

describe('Offline fallback (public/offline.html)', () => {
  it('exists and is an honest connectivity screen (no fake data)', () => {
    const html = read('public/offline.html');
    expect(html).toContain('No internet connection');
    const lower = html.toLowerCase();
    // It must not pretend to show any business data while offline.
    expect(lower).not.toContain('add to cart');
    expect(lower).not.toContain('your cart');
    expect(lower).not.toContain('your order');
    expect(lower).not.toContain('₹');
  });

  it('is referenced by the service worker', () => {
    const sw = read('public/sw.js');
    expect(sw).toContain("OFFLINE_URL = '/offline.html'");
  });
});

describe('Layout metadata wires up the PWA (app/layout.tsx)', () => {
  const layout = read('app/layout.tsx');

  it('links the web app manifest', () => {
    expect(layout).toContain("manifest: '/manifest.webmanifest'");
  });

  it('adds appleWebApp and applicationName metadata', () => {
    expect(layout).toContain('appleWebApp');
    expect(layout).toContain("applicationName: 'Maharani Traders'");
  });

  it('references the PWA favicon and apple-touch icon', () => {
    expect(layout).toContain("'/favicon.ico'");
    expect(layout).toContain("'/apple-touch-icon.png'");
  });

  it('mounts the SW registrar and install prompt', () => {
    expect(layout).toContain('ServiceWorkerRegister');
    expect(layout).toContain('InstallPrompt');
  });
});
