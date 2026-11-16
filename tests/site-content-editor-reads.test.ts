import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The website content editor must not turn an unreadable table into empty data.
 *
 * A failed read reported as `null`/`[]` would tell an operator "this page has no
 * sections", "no review recorded" or "nothing has been published yet" — and the
 * next click would overwrite real content or republish an incomplete page. The
 * loaders therefore throw, and the admin error boundary offers a retry;
 * `app/admin/content/[id]/**` only calls `notFound()` for a genuinely missing id.
 */

const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as null | { message: string; code?: string } },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => state.result,
        returns: async () => state.result,
      };
      return builder;
    },
  })),
}));

import {
  loadAdminPage,
  loadAdminNotes,
  loadAdminSections,
  loadPageRevisions,
} from '@/lib/site-content/queries';

const PAGE_ID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  state.result = { data: null, error: null };
});

describe('website content editor reads', () => {
  it.each([
    ['loadAdminPage', () => loadAdminPage(PAGE_ID)],
    ['loadAdminSections', () => loadAdminSections(PAGE_ID)],
    ['loadAdminNotes', () => loadAdminNotes(PAGE_ID)],
    ['loadPageRevisions', () => loadPageRevisions(PAGE_ID)],
  ])('%s throws on a failed read instead of reporting an empty result', async (_name, load) => {
    state.result = { data: null, error: { message: 'permission denied for table site_pages', code: '42501' } };
    await expect(load()).rejects.toThrow(/could not be loaded \[42501\]/);
  });

  it('still answers "no such row" without throwing when the read succeeded', async () => {
    await expect(loadAdminPage(PAGE_ID)).resolves.toBeNull();
    await expect(loadAdminSections(PAGE_ID)).resolves.toEqual([]);
    await expect(loadAdminNotes(PAGE_ID)).resolves.toBeNull();
    await expect(loadPageRevisions(PAGE_ID)).resolves.toEqual([]);
  });

  it('refuses a malformed id before reading anything', async () => {
    await expect(loadAdminPage('not-a-uuid')).resolves.toBeNull();
  });
});
