/**
 * Admin master-data Server Actions — the create/edit path for Categories and
 * Brands (`lib/admin/master-data-actions.ts`).
 *
 * These are the actions behind "Admin is unable to add/create Categories /
 * Brands". The test proves, per action:
 *   1. authorization runs SERVER-SIDE, before anything is written, and the
 *      permission required is `master_data.manage` (never a client flag);
 *   2. validation answers with a readable message and writes nothing;
 *   3. a duplicate name — including the multi-row case that used to throw
 *      PGRST116 out of `maybeSingle()` and crash the form — is reported as a
 *      message, not an exception;
 *   4. a successful create really inserts the row into the table and answers
 *      with a confirmation naming it;
 *   5. the retailer catalog surfaces are revalidated with the admin ones, so a
 *      row created here cannot be invisible in the catalog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrandAction,
  createCategoryAction,
  type MasterDataFormState,
} from '@/lib/admin/master-data-actions';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ client: vi.fn(), permission: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const CATEGORY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRAND = '11111111-1111-4111-8111-111111111111';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function state(result: MasterDataFormState): { error?: string; success?: string } {
  return result ?? {};
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: 'admin-1', role: 'admin', fullName: 'Fixture admin', email: null });
});

describe('createCategoryAction', () => {
  it('requires master_data.manage before touching the database', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    await createCategoryAction(null, form({ name: 'Snacks' }));

    expect(mocks.permission).toHaveBeenCalledWith('master_data.manage');
    expect(mocks.client).toHaveBeenCalled();
  });

  it('rejects an unauthorized caller and writes nothing', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] });
    mocks.client.mockReturnValue(fixture);
    mocks.permission.mockRejectedValue(new Error('You don\'t have permission to do that (requires "master_data.manage").'));

    await expect(createCategoryAction(null, form({ name: 'Snacks' }))).rejects.toThrow(/permission/i);
    expect(fixture.tables.categories).toHaveLength(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('validates the name and persists nothing when it is too short', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createCategoryAction(null, form({ name: 'A' })));

    expect(result.error).toBe('Enter a category name.');
    expect(fixture.tables.categories).toHaveLength(0);
  });

  it('persists the category and confirms it to the operator', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createCategoryAction(null, form({ name: '  Snacks  ', parentId: '' })));

    expect(result.error).toBeUndefined();
    expect(result.success).toContain('Snacks');
    // The row really is in the table, trimmed and top-level, active by default.
    expect(fixture.tables.categories).toHaveLength(1);
    expect(fixture.tables.categories?.[0]).toMatchObject({ name: 'Snacks', parent_id: null, image_url: null });
  });

  it('creates a subcategory under an explicit parent', async () => {
    const fixture = supabaseFixture({
      categories: [{ id: CATEGORY, name: 'Snacks', parent_id: null, is_active: true }],
      products: [],
    });
    mocks.client.mockReturnValue(fixture);

    const result = state(
      await createCategoryAction(null, form({ name: 'Namkeen', parentId: CATEGORY }))
    );

    expect(result.success).toContain('Namkeen');
    expect(fixture.tables.categories?.find((row) => row.name === 'Namkeen')).toMatchObject({
      parent_id: CATEGORY,
    });
  });

  it('reports a case-insensitive duplicate instead of crashing on a multi-row match', async () => {
    // `brands`/`categories` can hold names that differ only in case, so the
    // duplicate pre-check must tolerate 2+ matches (a single-row read raises
    // PGRST116 and the form used to blow up on exactly this input).
    const fixture = supabaseFixture({
      categories: [
        { id: CATEGORY, name: 'Snacks', parent_id: null, is_active: true },
        { id: BRAND, name: 'snacks', parent_id: null, is_active: true },
      ],
      products: [],
    });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createCategoryAction(null, form({ name: 'SNACKS' })));

    expect(result.error).toMatch(/already exists/i);
    expect(fixture.tables.categories).toHaveLength(2);
  });

  it('allows the same name under a different parent', async () => {
    const parent = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const fixture = supabaseFixture({
      categories: [
        { id: CATEGORY, name: 'Snacks', parent_id: parent, is_active: true },
      ],
      products: [],
    });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createCategoryAction(null, form({ name: 'Snacks' })));

    expect(result.error).toBeUndefined();
    expect(result.success).toContain('Snacks');
    expect(fixture.tables.categories).toHaveLength(2);
  });

  it('revalidates the retailer catalog surfaces as well as the admin list', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    await createCategoryAction(null, form({ name: 'Snacks' }));

    const revalidated = mocks.revalidate.mock.calls.map(([path]) => path);
    expect(revalidated).toContain('/admin/catalog/categories');
    // The catalog must be revalidated too: a category created in the admin
    // workspace has to be visible to retailers on the next request.
    expect(revalidated).toContain('/retailer/catalog');
    expect(revalidated).toContain('/retailer/home');
  });

  it('surfaces a database error instead of throwing it at the form', async () => {
    const fixture = supabaseFixture({ categories: [], products: [] }, { 'categories:insert': 'permission denied for table categories' });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createCategoryAction(null, form({ name: 'Snacks' })));

    expect(result.error).toContain('permission denied');
    expect(fixture.tables.categories).toHaveLength(0);
  });
});

describe('createBrandAction', () => {
  it('rejects an unauthorized caller and writes nothing', async () => {
    const fixture = supabaseFixture({ brands: [], products: [] });
    mocks.client.mockReturnValue(fixture);
    mocks.permission.mockRejectedValue(new Error('You don\'t have permission to do that (requires "master_data.manage").'));

    await expect(createBrandAction(null, form({ name: 'Amul' }))).rejects.toThrow(/permission/i);
    expect(fixture.tables.brands).toHaveLength(0);
  });

  it('validates the name', async () => {
    const fixture = supabaseFixture({ brands: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createBrandAction(null, form({ name: ' ' })));

    expect(result.error).toBe('Enter a brand name.');
    expect(fixture.tables.brands).toHaveLength(0);
  });

  it('persists the brand and confirms it', async () => {
    const fixture = supabaseFixture({ brands: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createBrandAction(null, form({ name: 'Amul' })));

    expect(result.success).toContain('Amul');
    expect(fixture.tables.brands).toHaveLength(1);
    expect(fixture.tables.brands?.[0]).toMatchObject({ name: 'Amul', logo_url: null });
  });

  it('reports a case-insensitive duplicate instead of crashing', async () => {
    const fixture = supabaseFixture({
      brands: [
        { id: BRAND, name: 'Amul', logo_url: null, is_active: true },
        { id: CATEGORY, name: 'amul', logo_url: null, is_active: true },
      ],
      products: [],
    });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createBrandAction(null, form({ name: 'AMUL' })));

    expect(result.error).toMatch(/already exists/i);
    expect(fixture.tables.brands).toHaveLength(2);
  });

  it('revalidates the brand list and the retailer catalog', async () => {
    const fixture = supabaseFixture({ brands: [], products: [] });
    mocks.client.mockReturnValue(fixture);

    await createBrandAction(null, form({ name: 'Amul' }));

    const revalidated = mocks.revalidate.mock.calls.map(([path]) => path);
    expect(revalidated).toContain('/admin/catalog/brands');
    expect(revalidated).toContain('/retailer/catalog');
  });

  it('surfaces a database error instead of throwing it at the form', async () => {
    const fixture = supabaseFixture({ brands: [], products: [] }, { 'brands:insert': 'duplicate key value violates unique constraint' });
    mocks.client.mockReturnValue(fixture);

    const result = state(await createBrandAction(null, form({ name: 'Amul' })));

    expect(result.error).toMatch(/already exists/i);
    expect(fixture.tables.brands).toHaveLength(0);
  });
});
