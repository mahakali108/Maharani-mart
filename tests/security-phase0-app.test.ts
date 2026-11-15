/**
 * PHASE 0 — application-layer half of the emergency security hardening.
 * Complements tests/security-phase0-db.test.ts (which EXECUTES migration
 * 0052's policies/triggers in PostgreSQL) by driving the real Server Actions
 * with a mocked Supabase client:
 *   - requireUser() refuses deactivated / suspended / unapproved accounts
 *     even when middleware never ran (direct Server Action POST)
 *   - staff creation authorises the role server-side (invite), never via
 *     user_metadata; public registration sends no role
 *   - catalogue pricing is Admin-only in the actions as well
 *   - delivery OTPs are never persisted in the channel queue
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  service: vi.fn(),
  redirect: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { requireUser } from '@/lib/auth/session';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';
import { can } from '@/lib/permissions/permissions';
import { createStaffAction } from '@/lib/admin/team-actions';
import { registerRetailerAction } from '@/lib/auth/actions';
import { updateProductAction } from '@/lib/admin/products-actions';
import { notifyOrderEvent } from '@/lib/notifications/notify';

const UID = '00000000-0000-4000-8000-000000000001';
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

type Fixture = ReturnType<typeof supabaseFixture>;
function sessionClient(tables: Record<string, object[]>, extra: Partial<Record<string, unknown>> = {}) {
  const db = supabaseFixture(tables) as Fixture & Record<string, unknown>;
  Object.assign(db, { auth: { getUser: mocks.getUser, signUp: vi.fn() }, ...extra });
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((to: string) => {
    throw new Error(`redirect:${to}`);
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: UID, email: 'user@test.local' } } });
});

// ---------------------------------------------------------------------------
// P0-5 — protected Server Actions refuse inactive / suspended accounts
// ---------------------------------------------------------------------------
describe('P0-5 requireUser() gate (no middleware required)', () => {
  it('refuses a deactivated profile', async () => {
    mocks.client.mockReturnValue(sessionClient({ profiles: [{ id: UID, role: 'staff', full_name: 'S', is_active: false }] }));
    await expect(requireUser()).rejects.toThrow('redirect:/login?error=account_inactive');
  });

  it('refuses a suspended retailer', async () => {
    mocks.client.mockReturnValue(
      sessionClient({
        profiles: [{ id: UID, role: 'retailer', full_name: 'R', is_active: true }],
        retailers: [{ id: UID, status: 'suspended' }],
      })
    );
    await expect(requireUser()).rejects.toThrow('redirect:/login?error=account_suspended');
  });

  it.each([
    ['pending approval', [{ id: UID, status: 'pending_approval' }]],
    ['without a retailers row', []],
  ])('sends a retailer %s to /pending-approval', async (_label, retailers) => {
    mocks.client.mockReturnValue(
      sessionClient({ profiles: [{ id: UID, role: 'retailer', full_name: 'R', is_active: true }], retailers })
    );
    await expect(requireUser()).rejects.toThrow('redirect:/pending-approval');
  });

  it('LEGIT: an active retailer and active staff pass', async () => {
    mocks.client.mockReturnValue(
      sessionClient({
        profiles: [{ id: UID, role: 'retailer', full_name: 'R', is_active: true }],
        retailers: [{ id: UID, status: 'active' }],
      })
    );
    await expect(requireUser()).resolves.toMatchObject({ id: UID, role: 'retailer' });

    const staffDb = sessionClient({ profiles: [{ id: UID, role: 'staff', full_name: 'S', is_active: true }] });
    mocks.client.mockReturnValue(staffDb);
    await expect(requireUser()).resolves.toMatchObject({ role: 'staff' });
    expect(staffDb.queries.some((q) => q.table === 'retailers')).toBe(false);
  });

  it('a suspended retailer calling a protected Server Action directly performs no write', async () => {
    const db = sessionClient({
      profiles: [{ id: UID, role: 'retailer', full_name: 'R', is_active: true }],
      retailers: [{ id: UID, status: 'suspended' }],
      retailer_favorites: [],
    });
    mocks.client.mockReturnValue(db);
    await expect(toggleFavoriteAction('product-1')).rejects.toThrow('redirect:/login?error=account_suspended');
    expect(db.queries.some((q) => q.table === 'retailer_favorites')).toBe(false);
  });

  it('LEGIT: an active retailer can still use the same action', async () => {
    const db = sessionClient({
      profiles: [{ id: UID, role: 'retailer', full_name: 'R', is_active: true }],
      retailers: [{ id: UID, status: 'active' }],
      retailer_favorites: [],
    });
    mocks.client.mockReturnValue(db);
    await expect(toggleFavoriteAction('product-1')).resolves.toEqual({ success: true, isFavorite: true });
    expect(db.queries.find((q) => q.table === 'retailer_favorites' && q.operation === 'insert')?.payload).toMatchObject({
      retailer_id: UID,
      product_id: 'product-1',
    });
  });
});

// ---------------------------------------------------------------------------
// P0-1 — roles are never taken from client-controlled metadata
// ---------------------------------------------------------------------------
describe('P0-1 role assignment paths', () => {
  function staffForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    const values = {
      fullName: 'New Salesman',
      phone: '9876543210',
      email: 'New.Salesman@Test.local',
      password: 'longpassword',
      role: 'salesman',
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    return form;
  }

  function superAdminSession() {
    return sessionClient(
      { profiles: [{ id: UID, role: 'super_admin', full_name: 'Owner', is_active: true }] },
      { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) }
    );
  }

  it('createStaffAction writes a server-side invite BEFORE creating the user and sends no metadata role', async () => {
    mocks.client.mockReturnValue(superAdminSession());
    const calls: string[] = [];
    const createUser = vi.fn(async (args: { user_metadata: Record<string, unknown>; email: string }) => {
      void args;
      calls.push('createUser');
      return { data: { user: { id: 'new-user' } }, error: null };
    });
    const service = sessionClient({ profiles: [{ id: 'new-user', role: 'salesman' }] }, {
      auth: { admin: { createUser } },
    });
    const originalFrom = service.from;
    (service as unknown as { from: unknown }).from = ((table: string) => {
      const chain = originalFrom(table) as unknown as Record<string, unknown>;
      chain.upsert = async (payload: Record<string, unknown>) => {
        calls.push('invite');
        service.tables[table] = [...(service.tables[table] ?? []), payload];
        return { error: null };
      };
      return chain;
    }) as never;
    mocks.service.mockReturnValue(service);

    await expect(createStaffAction(null, staffForm())).rejects.toThrow('redirect:/admin/team');
    expect(calls).toEqual(['invite', 'createUser']);
    expect(service.tables.staff_account_invites?.[0]).toMatchObject({ email: 'new.salesman@test.local', role: 'salesman', created_by: UID });
    const args = createUser.mock.calls[0]![0];
    expect(args.user_metadata).not.toHaveProperty('role');
    expect(args.email).toBe('new.salesman@test.local');
  });

  it('createStaffAction removes the invite when account creation fails', async () => {
    mocks.client.mockReturnValue(superAdminSession());
    const service = sessionClient({}, {
      auth: { admin: { createUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'User already registered' } })) } },
    });
    const originalFrom = service.from;
    (service as unknown as { from: unknown }).from = ((table: string) => {
      const chain = originalFrom(table) as unknown as Record<string, unknown>;
      chain.upsert = async () => ({ error: null });
      return chain;
    }) as never;
    mocks.service.mockReturnValue(service);

    await expect(createStaffAction(null, staffForm())).resolves.toEqual({ error: 'An account with this email already exists.' });
    expect(service.queries.find((q) => q.table === 'staff_account_invites' && q.operation === 'delete')?.filters).toContainEqual({
      op: 'eq',
      column: 'email',
      value: 'new.salesman@test.local',
    });
  });

  it('createStaffAction is refused for non-super-admins (team.manage)', async () => {
    mocks.client.mockReturnValue(sessionClient({ profiles: [{ id: UID, role: 'admin', full_name: 'A', is_active: true }] }));
    await expect(createStaffAction(null, staffForm())).rejects.toThrow(/requires "team.manage"/);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it('public registration sends no role in signup metadata and maps invalid_area', async () => {
    const signUp = vi.fn(async (args: { options: { data: Record<string, unknown> } }) => {
      void args;
      return { data: { user: null, session: null }, error: { message: 'Database error saving new user: invalid_area' } };
    });
    mocks.client.mockReturnValue(
      sessionClient({}, { auth: { getUser: mocks.getUser, signUp }, rpc: vi.fn().mockResolvedValue({ data: false, error: null }) })
    );
    const form = new FormData();
    for (const [key, value] of Object.entries({
      fullName: 'Shop Owner',
      shopName: 'Kirana',
      phone: '9876543210',
      email: 'owner@test.local',
      areaId: '11111111-1111-4111-8111-111111111111',
      address: 'Main Road, Khagaria',
      password: 'longpassword',
    })) form.set(key, value);

    await expect(registerRetailerAction(null, form)).resolves.toEqual({ fieldErrors: { areaId: 'Select a valid service area.' } });
    const options = signUp.mock.calls[0]![0].options;
    expect(options.data).not.toHaveProperty('role');
  });

  it('no application code assigns a role through auth user metadata', () => {
    expect(read('lib/admin/team-actions.ts')).not.toMatch(/user_metadata:\s*\{[^}]*\brole\b/);
    expect(read('lib/auth/actions.ts')).not.toMatch(/data:\s*\{[^}]*\brole:/);
  });
});

// ---------------------------------------------------------------------------
// P0-3 — catalogue pricing in the Server Actions
// ---------------------------------------------------------------------------
describe('P0-3 catalogue pricing permissions', () => {
  it('staff hold operational catalogue rights only', () => {
    expect(can('staff', 'products.edit')).toBe(true);
    expect(can('staff', 'products.create')).toBe(false);
    expect(can('staff', 'pricing.manage')).toBe(false);
    for (const role of ['admin', 'super_admin'] as const) {
      expect(can(role, 'products.create')).toBe(true);
      expect(can(role, 'pricing.manage')).toBe(true);
    }
  });

  it('pack pricing, pack creation, pack duplication and bulk GST require pricing.manage', () => {
    const products = read('lib/admin/products-actions.ts');
    for (const fn of ['addProductPackAction', 'savePackPricingAction', 'duplicatePackAction']) {
      const start = products.indexOf(`export async function ${fn}(`);
      const body = products.slice(start, start + 400);
      expect(body, fn).toContain("requirePermission('pricing.manage')");
    }
    const bulk = read('lib/admin/products-bulk-actions.ts');
    const gst = bulk.slice(bulk.indexOf('async function bulkSetGst('), bulk.indexOf('async function bulkSetGst(') + 250);
    expect(gst).toContain("requirePermission('pricing.manage')");
  });

  function productForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    const values = {
      name: 'Soap 100g',
      unit: 'pcs',
      unitsPerCase: '10',
      basePrice: '100',
      casePrice: '900',
      gstPercent: '18',
      hsnCode: '3401',
      leadTimeDays: '2',
      moq: '1',
      // every product save must name an owner-classified category (0086 gate)
      categoryId: 'c1',
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    return form;
  }

  /** An active category a Super Admin has classified as FMCG. */
  const ALLOWED_CATEGORY = { id: 'c1', is_active: true, compliance_scope: 'fmcg' };

  it('refuses a product save with no category or an unclassified one, before any write', async () => {
    for (const categories of [[], [{ id: 'c1', is_active: true, compliance_scope: 'unapproved' }]]) {
      const db = sessionClient({
        profiles: [{ id: UID, role: 'admin', full_name: 'Admin', is_active: true }],
        products: [{ id: 'p1' }],
        categories,
      });
      mocks.client.mockReturnValue(db);
      await expect(updateProductAction('p1', null, productForm())).resolves.toHaveProperty('error');
      expect(db.queries.some((q) => q.operation === 'update')).toBe(false);
    }
  });

  function staffCatalogSession() {
    return sessionClient({
      profiles: [{ id: UID, role: 'staff', full_name: 'Staff', is_active: true }],
      products: [{ id: 'p1', base_price: 100, gst_percent: 18, hsn_code: '3401', units_per_case: 10 }],
      product_packs: [{ id: 'pk1', product_id: 'p1', case_price: 900, sort_order: 0, created_at: '2026-01-01' }],
      categories: [ALLOWED_CATEGORY],
    });
  }

  it('staff cannot change a price through updateProductAction (no write happens)', async () => {
    const db = staffCatalogSession();
    mocks.client.mockReturnValue(db);
    await expect(updateProductAction('p1', null, productForm({ basePrice: '1' }))).resolves.toEqual({
      error: 'Only an Admin can change the price, MRP, GST, HSN code or case size.',
    });
    expect(db.queries.some((q) => q.operation === 'update')).toBe(false);
  });

  it.each([
    ['GST', { gstPercent: '5' }],
    ['HSN', { hsnCode: '9999' }],
    ['case price', { casePrice: '1' }],
    ['case size', { unitsPerCase: '1' }],
  ])('staff cannot change the %s through updateProductAction', async (_label, overrides) => {
    const db = staffCatalogSession();
    mocks.client.mockReturnValue(db);
    await expect(updateProductAction('p1', null, productForm(overrides))).resolves.toHaveProperty('error');
    expect(db.queries.some((q) => q.operation === 'update')).toBe(false);
  });

  it('LEGIT: staff edits operational fields; money columns are not in the write', async () => {
    const db = staffCatalogSession();
    mocks.client.mockReturnValue(db);
    await expect(updateProductAction('p1', null, productForm({ name: 'Soap 100g (New Pack)' }))).resolves.toBeNull();
    const productWrite = db.queries.find((q) => q.table === 'products' && q.operation === 'update')!;
    expect(productWrite.payload).toMatchObject({ name: 'Soap 100g (New Pack)' });
    for (const column of ['base_price', 'cost_price', 'gst_percent', 'hsn_code', 'units_per_case']) {
      expect(productWrite.payload).not.toHaveProperty(column);
    }
    const packWrite = db.queries.find((q) => q.table === 'product_packs' && q.operation === 'update')!;
    expect(Object.keys(packWrite.payload ?? {}).sort()).toEqual(['barcode', 'moq']);
    expect(db.queries.some((q) => q.table === 'product_pricing_tiers')).toBe(false);
  });

  it('LEGIT: an admin still saves prices through updateProductAction', async () => {
    const db = sessionClient({
      profiles: [{ id: UID, role: 'admin', full_name: 'Admin', is_active: true }],
      products: [{ id: 'p1' }],
      product_packs: [{ id: 'pk1', product_id: 'p1', sort_order: 0, created_at: '2026-01-01' }],
      product_pricing_tiers: [],
      categories: [ALLOWED_CATEGORY],
    });
    mocks.client.mockReturnValue(db);
    await expect(updateProductAction('p1', null, productForm({ basePrice: '120', casePrice: '1000' }))).resolves.toBeNull();
    expect(db.queries.find((q) => q.table === 'products' && q.operation === 'update')?.payload).toMatchObject({ base_price: 120 });
    expect(db.queries.find((q) => q.table === 'product_packs' && q.operation === 'update')?.payload).toMatchObject({ case_price: 1000 });
  });
});

// ---------------------------------------------------------------------------
// P0-4 — the delivery OTP never reaches the channel queue
// ---------------------------------------------------------------------------
describe('P0-4 delivery OTP is not persisted in notification_logs', () => {
  it('notifyOrderEvent keeps the OTP in-app and queues only channelBody', async () => {
    const db = sessionClient({ notifications: [], notification_logs: [] });
    mocks.client.mockReturnValue(db);
    await notifyOrderEvent({
      recipientId: 'retailer-1',
      title: 'Order dispatched',
      body: 'Your delivery OTP is 482913.',
      channelBody: 'Open the Maharani app to view your delivery OTP.',
    });
    expect(db.tables.notifications?.[0]).toMatchObject({ recipient_id: 'retailer-1', body: 'Your delivery OTP is 482913.' });
    const log = db.tables.notification_logs?.[0] as { payload: { body: string } };
    expect(log.payload.body).toBe('Open the Maharani app to view your delivery OTP.');
    expect(JSON.stringify(db.tables.notification_logs)).not.toContain('482913');
  });

  it('both OTP senders supply an OTP-free channelBody', () => {
    for (const file of ['lib/staff/dispatch-actions.ts', 'lib/delivery/delivery-actions.ts']) {
      const src = read(file);
      const channelBodies = [...src.matchAll(/channelBody:\s*`([^`]*)`/g)].map((m) => m[1]!);
      expect(channelBodies.length, file).toBeGreaterThan(0);
      for (const body of channelBodies) expect(body, file).not.toContain('${otp}');
      // every notification that interpolates the OTP carries a channelBody
      for (const call of src.match(/notifyOrderEvent\(\{[\s\S]*?\}\);/g) ?? []) {
        if (call.includes('${otp}')) expect(call, file).toContain('channelBody:');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P0-6 — the revenue view is read through the admin RPC only
// ---------------------------------------------------------------------------
describe('P0-6 top-products revenue view', () => {
  it('the admin low-stock page uses admin_top_products() instead of the materialized view', () => {
    const page = read('app/admin/inventory/low-stock/page.tsx');
    expect(page).toContain("rpc('admin_top_products'");
    expect(page).not.toMatch(/from\('mv_top_products'/);
  });
});
