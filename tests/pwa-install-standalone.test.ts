import { describe, it, expect, vi, afterEach } from 'vitest';
import manifest from '../app/manifest';
import { isRunningStandalone } from '../components/pwa/InstallPrompt';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindow(opts: { standalone?: boolean; iosStandalone?: boolean; matchMediaThrows?: boolean }) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => {
      if (opts.matchMediaThrows) throw new Error('unsupported');
      return { matches: query === '(display-mode: standalone)' && !!opts.standalone };
    },
    navigator: { standalone: opts.iosStandalone },
  });
}

describe('isRunningStandalone (install banner suppression)', () => {
  it('is false in a normal browser tab', () => {
    stubWindow({ standalone: false });
    expect(isRunningStandalone()).toBe(false);
  });

  it('is true when launched from the installed app (display-mode: standalone)', () => {
    stubWindow({ standalone: true });
    expect(isRunningStandalone()).toBe(true);
  });

  it('is true for an iOS home-screen web app (navigator.standalone)', () => {
    stubWindow({ standalone: false, iosStandalone: true });
    expect(isRunningStandalone()).toBe(true);
  });

  it('falls back to navigator.standalone when matchMedia throws', () => {
    stubWindow({ matchMediaThrows: true, iosStandalone: false });
    expect(isRunningStandalone()).toBe(false);
  });

  it('is false during server rendering (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(isRunningStandalone()).toBe(false);
  });
});

describe('manifest identity', () => {
  it('declares a stable id equal to the start URL', () => {
    const m = manifest();
    expect(m.id).toBe('/');
    expect(m.id).toBe(m.start_url);
  });
});
