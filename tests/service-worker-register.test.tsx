/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister';

/**
 * Regression: the registrar used to wait ONLY for the window `load` event.
 * Next.js hydrates after `load` in practice, so the listener never fired and
 * /sw.js was never registered (confirmed in a real Chromium session: zero
 * registrations on /login). These tests pin both orderings.
 */

let register: ReturnType<typeof vi.fn>;

/** A browser without service-worker support has no `serviceWorker` property at all. */
function removeServiceWorker() {
  const nav = navigator as Navigator & { serviceWorker?: unknown };
  Reflect.deleteProperty(nav, 'serviceWorker');
}

function stubServiceWorker() {
  // Service workers require a secure context (HTTPS or localhost). jsdom does
  // not model that, so declare it explicitly for these tests.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  register = vi.fn().mockResolvedValue({});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  });
}

describe('ServiceWorkerRegister', () => {
  beforeEach(() => {
    stubServiceWorker();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    removeServiceWorker();
  });

  it('registers /sw.js immediately when the document has already loaded', () => {
    expect(document.readyState).toBe('complete');
    render(<ServiceWorkerRegister />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('waits for the load event while the document is still loading', () => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<ServiceWorkerRegister />);
    expect(register).not.toHaveBeenCalled();

    readyState.mockReturnValue('complete');
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does nothing when service workers are unsupported', () => {
    removeServiceWorker();
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing inside the Capacitor WebView', () => {
    (window as Window & { Capacitor?: unknown }).Capacitor = {};
    try {
      render(<ServiceWorkerRegister />);
      expect(register).not.toHaveBeenCalled();
    } finally {
      delete (window as Window & { Capacitor?: unknown }).Capacitor;
    }
  });
});
