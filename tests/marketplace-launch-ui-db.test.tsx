/**
 * Super Admin marketplace launch controls and the seller-facing gate notice.
 *
 * The REAL server actions run against the REAL 0098 functions on PostgreSQL 16
 * (PGlite). The Supabase client is replaced by a bridge that executes each call
 * as the signed-in user's database session (role `authenticated` + JWT `sub`),
 * so every assertion about "the UI cannot bypass the database" is exercised,
 * not assumed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { as, createMigratedDb, createUser, type Db, type Tx } from './helpers/pg-harness';

const state = vi.hoisted(() => ({
  db: null as unknown,
  /** Who the APP believes is signed in. */
  appUser: null as null | { id: string; role: string },
  /** Whose database session the client really carries. */
  dbUser: null as null | string,
  buildVersion: '1.0',
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }) }));
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn(async () => state.appUser) }));
vi.mock('@/lib/legal/documents', async (original) => {
  const real = await original<typeof import('@/lib/legal/documents')>();
  return {
    ...real,
    legalDocumentByKey: (key: string) => {
      const found = real.legalDocumentByKey(key);
      return found && key === 'seller-agreement' ? { ...found, version: state.buildVersion } : found;
    },
  };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const { as: runAs } = await import('./helpers/pg-harness');
    const run = async <T,>(fn: (tx: Tx) => Promise<T>) => {
      try {
        return { data: await runAs(state.db as Db, state.dbUser ?? 'anon', fn), error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    };
    const table = (name: string) => {
      const filters: [string, unknown][] = [];
      let inFilter: [string, unknown[]] | null = null;
      let columns = '*';
      let order = '';
      let limit = '';
      const rows = () => run(async (tx) => {
        const where = [
          ...filters.map(([column], index) => `${column} = $${index + 1}`),
          ...(inFilter ? [`${inFilter[0]} = any($${filters.length + 1})`] : []),
        ];
        const params = [...filters.map(([, value]) => value), ...(inFilter ? [inFilter[1]] : [])];
        const sql = `select ${columns} from public.${name}${where.length ? ` where ${where.join(' and ')}` : ''}${order}${limit}`;
        return (await tx.query(sql, params)).rows;
      });
      const chain = {
        select(value: string) { columns = value; return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        in(column: string, values: unknown[]) { inFilter = [column, values]; return chain; },
        order(column: string, options?: { ascending?: boolean }) { order += `${order ? ',' : ' order by'} ${column} ${options?.ascending === false ? 'desc' : 'asc'}`; return chain; },
        limit(count: number) { limit = ` limit ${count}`; return chain; },
        returns() { return chain; },
        async maybeSingle() { const result = await rows(); return { data: (result.data as unknown[] | null)?.[0] ?? null, error: result.error }; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return rows().then(resolve, reject); },
      };
      return chain;
    };
    return {
      from: table,
      rpc: (name: string, args: Record<string, unknown> = {}) => run(async (tx) => {
        const keys = Object.keys(args);
        const sql = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as r`;
        return (await tx.query<{ r: unknown }>(sql, keys.map((key) => args[key]))).rows[0]!.r;
      }),
    };
  }),
  createServiceRoleClient: vi.fn(() => { throw new Error('the marketplace screen must never use the service role'); }),
}));

import { publishSellerAgreementVersionAction, recordMarketplaceDecisionAction } from '@/lib/admin/marketplace/actions';
import { getMarketplaceLaunchState } from '@/lib/admin/marketplace/queries';
import { ENABLE_CONFIRMATION_PHRASE, mapMarketplaceDecisionError, validateMarketplaceDecision } from '@/lib/admin/marketplace/validation';
import { SellerGateNotice } from '@/components/seller/seller-gate-notice';
import MarketplaceLaunchPage from '@/app/admin/marketplace-launch/page';

let db: Db;
let superAdmin: string;
let admin: string;
let staff: string;
let sellerOwner: string;
let sellerMember: string;
let sellerId: string;

const OWNER_REF = 'Owner signed letter dated 2 December 2026 (file MT/OWN/01)';
const CA_REF = 'CA certificate dated 3 December 2026, firm reg. on file (MT/CA/01)';

function signIn(id: string, role: string, dbUser: string = id) {
  state.appUser = { id, role };
  state.dbUser = dbUser;
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const enableForm = (overrides: Record<string, string> = {}) => form({
  decision: 'enable', owner_reference: OWNER_REF, ca_reference: CA_REF,
  reason: 'Owner and CA approvals received and filed.', confirmation: ENABLE_CONFIRMATION_PHRASE, ...overrides,
});
const isOpen = async () => (await db.query<{ v: boolean }>(`select public.third_party_offers_enabled() v`)).rows[0]!.v;
const historyCount = async () => (await db.query<{ n: number }>(`select count(*)::int n from public.marketplace_launch_approvals`)).rows[0]!.n;

beforeAll(async () => {
  db = await createMigratedDb();
  state.db = db;
  superAdmin = await createUser(db, 'super_admin', 'Owner Super Admin');
  admin = await createUser(db, 'admin', 'Plain Admin');
  staff = await createUser(db, 'staff', 'Staff');
  sellerOwner = await createUser(db, 'seller', 'Seller Owner');
  sellerMember = await createUser(db, 'seller', 'Seller Member');
  await db.exec(`set session_replication_role = 'replica'`);
  const { rows } = await db.query<{ id: string }>(`insert into public.sellers (business_name, status) values ('Gate Notice Seller', 'active') returning id`);
  sellerId = rows[0]!.id;
  await db.query(`insert into public.seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner'), ($1, $3, 'member')`, [sellerId, sellerOwner, sellerMember]);
  await db.exec(`set session_replication_role = 'origin'`);
}, 180_000);

afterEach(() => { state.buildVersion = '1.0'; });

describe('marketplace decision — input rules (pure)', () => {
  const base = { enable: true, ownerReference: OWNER_REF, caReference: CA_REF, reason: 'Approvals received and filed.', confirmation: ENABLE_CONFIRMATION_PHRASE };
  it('accepts two distinct real-looking references with the typed confirmation', () => {
    expect(validateMarketplaceDecision(base)).toMatchObject({ ok: true, value: { enable: true, ownerReference: OWNER_REF, caReference: CA_REF } });
  });
  it.each(['', '  ', 'NA', 'n/a', 'TBD', 'pending', 'none', 'xxx', '---', 'placeholder', 'owner input required', 'test', 'dummy', 'ab'])(
    'refuses the placeholder %j as an approval reference', (value) => {
      expect(validateMarketplaceDecision({ ...base, ownerReference: value }).ok).toBe(false);
      expect(validateMarketplaceDecision({ ...base, caReference: value }).ok).toBe(false);
    });
  it('refuses the same text for both approvals, a missing reason and a wrong confirmation', () => {
    expect(validateMarketplaceDecision({ ...base, caReference: OWNER_REF.toUpperCase() }).ok).toBe(false);
    expect(validateMarketplaceDecision({ ...base, reason: 'short' }).ok).toBe(false);
    expect(validateMarketplaceDecision({ ...base, confirmation: 'enable third-party sellers' }).ok).toBe(false);
    expect(validateMarketplaceDecision({ ...base, confirmation: '' }).ok).toBe(false);
  });
  it('disabling needs only a reason and never carries approval references', () => {
    expect(validateMarketplaceDecision({ enable: false, ownerReference: 'ignored', caReference: 'ignored', reason: 'Pausing while the CA reviews.', confirmation: '' }))
      .toEqual({ ok: true, value: { enable: false, ownerReference: null, caReference: null, reason: 'Pausing while the CA reviews.' } });
  });
  it('does not echo unknown database errors', () => {
    expect(mapMarketplaceDecisionError('relation "secret_table" does not exist at character 15')).not.toMatch(/secret_table/);
    expect(mapMarketplaceDecisionError('MARKETPLACE_APPROVAL_REQUIRED: an owner approval reference is required to enable third-party offers.')).toMatch(/^An owner approval reference is required/);
  });
});

describe('marketplace decision — Super Admin action against the database', () => {
  it('starts DISABLED with an empty history', async () => {
    signIn(superAdmin, 'super_admin');
    const launch = await getMarketplaceLaunchState();
    expect(launch).toMatchObject({ available: true, open: false, history: [] });
    expect(launch.agreement).toMatchObject({ buildVersion: '1.0', databaseVersion: '1.0', inSync: true });
  });

  it('refuses admin, staff and seller in the app, without calling the database', async () => {
    for (const [id, role] of [[admin, 'admin'], [staff, 'staff'], [sellerOwner, 'seller']] as const) {
      signIn(id, role);
      expect(await recordMarketplaceDecisionAction(null, enableForm())).toEqual({ error: 'Only a Super Admin can change this. Nothing was changed.' });
      expect(await publishSellerAgreementVersionAction(null, form({ confirm: 'on' }))).toEqual({ error: 'Only a Super Admin can change this. Nothing was changed.' });
    }
    expect(await isOpen()).toBe(false);
    expect(await historyCount()).toBe(0);
  });

  it('the database refuses even when the app check is bypassed (app believes Super Admin, session is an Admin)', async () => {
    for (const session of [admin, staff, sellerOwner]) {
      signIn(superAdmin, 'super_admin', session);
      expect(await recordMarketplaceDecisionAction(null, enableForm())).toEqual({ error: 'Only a Super Admin can change this. Nothing was changed.' });
      expect((await publishSellerAgreementVersionAction(null, form({ confirm: 'on' })))?.error).toBeTruthy();
    }
    expect(await isOpen()).toBe(false);
    expect(await historyCount()).toBe(0);
  });

  it('cannot be enabled without both approvals, with placeholders, with identical references or without the typed confirmation', async () => {
    signIn(superAdmin, 'super_admin');
    const attempts: Record<string, string>[] = [
      { owner_reference: '' }, { ca_reference: '' }, { owner_reference: 'TBD' }, { ca_reference: 'pending' },
      { ca_reference: OWNER_REF }, { confirmation: 'yes' }, { reason: '' }, { decision: 'maybe' },
    ];
    for (const overrides of attempts) {
      expect((await recordMarketplaceDecisionAction(null, enableForm(overrides)))?.error).toBeTruthy();
    }
    expect(await isOpen()).toBe(false);
    expect(await historyCount()).toBe(0);
  });

  it('the database itself refuses a placeholder that the app rules would let through', async () => {
    // "pending" is refused by both; this goes straight to the function as a Super Admin.
    const direct = (owner: string, ca: string) => as(db, superAdmin, (tx: Tx) =>
      tx.query(`select public.record_marketplace_launch_approval(true, $1, $2, 'direct call')`, [owner, ca])).then(() => null, (e: Error) => e.message);
    expect(await direct('pending', CA_REF)).toMatch(/MARKETPLACE_APPROVAL_REQUIRED/);
    expect(await direct(OWNER_REF, OWNER_REF)).toMatch(/two separate references/);
    expect(await isOpen()).toBe(false);
  });

  it('records the owner and CA references, enables, shows them in the history, then disables again — history keeps both', async () => {
    signIn(superAdmin, 'super_admin');
    const enabled = await recordMarketplaceDecisionAction(null, enableForm());
    expect(enabled?.success).toMatch(/now enabled/);
    expect(await isOpen()).toBe(true);

    let launch = await getMarketplaceLaunchState();
    expect(launch.open).toBe(true);
    expect(launch.history).toHaveLength(1);
    expect(launch.history[0]).toMatchObject({
      enabled: true, ownerReference: OWNER_REF, caReference: CA_REF, recordedBy: superAdmin, recordedByName: 'Owner Super Admin',
    });

    const disabled = await recordMarketplaceDecisionAction(null, form({ decision: 'disable', reason: 'Pausing seller sales for review.', owner_reference: 'x', ca_reference: 'y' }));
    expect(disabled?.success).toMatch(/now disabled/);
    expect(await isOpen()).toBe(false);
    launch = await getMarketplaceLaunchState();
    expect(launch.history.map((row) => row.enabled)).toEqual([false, true]);
    expect(launch.history[0]).toMatchObject({ ownerReference: null, caReference: null, reason: 'Pausing seller sales for review.' });

    // History is append-only for everyone, including the Super Admin.
    for (const sql of [`update public.marketplace_launch_approvals set reason = 'rewritten'`, `delete from public.marketplace_launch_approvals`]) {
      const outcome = await as(db, superAdmin, (tx: Tx) => tx.query(sql)).then((r) => `rows:${(r as { affectedRows?: number }).affectedRows ?? 0}`, (e: Error) => e.message);
      expect(outcome).toMatch(/permission denied|rows:0/);
    }
    expect(await historyCount()).toBe(2);
  });

  it('the screen and the database agree on the switch, and no browser session can call the internal switch function', async () => {
    signIn(superAdmin, 'super_admin');
    expect((await getMarketplaceLaunchState()).open).toBe(await isOpen());
    for (const who of [superAdmin, admin, staff, sellerOwner, 'anon']) {
      const outcome = await as(db, who, (tx: Tx) => tx.query(`select public.third_party_offers_enabled()`)).then(() => 'allowed', (e: Error) => e.message);
      expect(outcome).toMatch(/permission denied for function third_party_offers_enabled/);
    }
  });

  it('a plain Admin can read the status and history but not change it; staff and sellers cannot read the history', async () => {
    signIn(admin, 'admin');
    expect((await getMarketplaceLaunchState()).history).toHaveLength(2);
    for (const who of [staff, sellerOwner]) {
      const rows = await as(db, who, (tx: Tx) => tx.query(`select id from public.marketplace_launch_approvals`)).then((r) => r.rows.length, () => 0);
      expect(rows).toBe(0);
    }
  });
});

describe('Seller Agreement version', () => {
  it('publishes only the version this build carries — a version typed into the form is ignored', async () => {
    signIn(superAdmin, 'super_admin');
    state.buildVersion = '1.1';
    expect((await getMarketplaceLaunchState()).agreement).toMatchObject({ buildVersion: '1.1', databaseVersion: '1.0', inSync: false });

    expect((await publishSellerAgreementVersionAction(null, form({})))?.error).toMatch(/Tick the box/);
    const result = await publishSellerAgreementVersionAction(null, form({ confirm: 'on', document_version: '9.9', p_document_version: '9.9', version: '9.9' }));
    expect(result?.success).toMatch(/version 1\.1 is now the enforced version/);
    const { rows } = await db.query<{ document_version: string; published_by: string }>(
      `select document_version, published_by from public.legal_document_current_versions where document_key = 'seller-agreement'`);
    expect(rows[0]).toEqual({ document_version: '1.1', published_by: superAdmin });
    expect((await getMarketplaceLaunchState()).agreement.inSync).toBe(true);
  });

  it('after a new version is enforced, an earlier acceptance no longer opens the gate; accepting the new one does', async () => {
    // Database is at 1.1 from the previous test. Open the marketplace.
    signIn(superAdmin, 'super_admin');
    state.buildVersion = '1.1';
    expect((await recordMarketplaceDecisionAction(null, enableForm()))?.success).toBeTruthy();
    const gate = async () => (await as(db, sellerOwner, (tx: Tx) => tx.query<{ g: { marketplace_open: boolean; agreement_current: boolean; agreement_version: string } }>(
      `select public.seller_offer_gate_status($1) g`, [sellerId]))).rows[0]!.g;

    expect(await gate()).toMatchObject({ marketplace_open: true, agreement_current: false, agreement_version: '1.1' });
    // The old version can no longer be accepted at all.
    const old = await as(db, sellerOwner, (tx: Tx) => tx.query(`select public.record_legal_acceptance('seller-agreement', '1.0', 'seller_onboarding')`)).then(() => null, (e: Error) => e.message);
    expect(old).toMatch(/LEGAL_VERSION_NOT_CURRENT/);
    // A non-owner member accepting does not open the gate.
    await as(db, sellerMember, (tx: Tx) => tx.query(`select public.record_legal_acceptance('seller-agreement', '1.1', 'seller_onboarding')`));
    expect((await gate()).agreement_current).toBe(false);
    await as(db, sellerOwner, (tx: Tx) => tx.query(`select public.record_legal_acceptance('seller-agreement', '1.1', 'seller_onboarding')`));
    expect((await gate()).agreement_current).toBe(true);

    // Leave the marketplace closed for the following tests.
    expect((await recordMarketplaceDecisionAction(null, form({ decision: 'disable', reason: 'Closing after the version test.' })))?.success).toBeTruthy();
  });
});

describe('seller-facing notice', () => {
  const render = async (role: 'owner' | 'member') => {
    const element = await SellerGateNotice({ sellerId, memberRole: role });
    return element ? renderToStaticMarkup(element) : '';
  };

  it('marketplace closed: says so plainly and does not blame the seller or ask for acceptance', async () => {
    signIn(sellerOwner, 'seller');
    state.buildVersion = '1.1';
    const html = await render('owner');
    expect(html).toContain('The marketplace is not open to sellers yet');
    expect(html).toContain('not a problem with your');
    expect(html).not.toContain('needs to be accepted');
    expect(html).toContain('role="status"');
  });

  it('marketplace open but agreement not accepted: owner is sent to accept; a member is told only the owner can', async () => {
    signIn(superAdmin, 'super_admin');
    state.buildVersion = '1.2';
    expect((await publishSellerAgreementVersionAction(null, form({ confirm: 'on' })))?.success).toBeTruthy();
    expect((await recordMarketplaceDecisionAction(null, enableForm()))?.success).toBeTruthy();

    signIn(sellerOwner, 'seller');
    const owner = await render('owner');
    expect(owner).toContain('The current Seller Agreement needs to be accepted');
    expect(owner).toContain('href="/seller/profile"');
    expect(owner).toContain('href="/legal/seller-agreement"');

    signIn(sellerMember, 'seller');
    const member = await render('member');
    expect(member).toContain('Only the owner can accept it');
    expect(member).not.toContain('href="/seller/profile"');
  });

  it('gate open: renders nothing', async () => {
    await as(db, sellerOwner, (tx: Tx) => tx.query(`select public.record_legal_acceptance('seller-agreement', '1.2', 'seller_onboarding')`));
    signIn(sellerOwner, 'seller');
    state.buildVersion = '1.2';
    expect(await render('owner')).toBe('');
  });

  it('build and database disagree on the version: offers stay off and the seller is told it is not their data', async () => {
    signIn(sellerOwner, 'seller');
    state.buildVersion = '7.0';
    const html = await render('owner');
    expect(html).toContain('Offers cannot go live right now');
    expect(html).not.toContain('The marketplace is not open');
  });
});

describe('Super Admin page', () => {
  it('redirects everyone who is not a Super Admin', async () => {
    for (const [id, role] of [[admin, 'admin'], [staff, 'staff'], [sellerOwner, 'seller']] as const) {
      signIn(id, role);
      await expect(MarketplaceLaunchPage()).rejects.toThrow('REDIRECT:/unauthorized');
    }
  });

  it('is linked for Super Admins only and contains no pre-filled approval reference', () => {
    const shell = readFileSync('components/layout/admin-shell.tsx', 'utf8');
    expect(shell).toMatch(/href: '\/admin\/marketplace-launch', icon: Store, roles: \['super_admin'\]/);
    const forms = readFileSync('components/admin/marketplace-launch-forms.tsx', 'utf8');
    expect(forms).not.toMatch(/defaultValue=|value=\{?["'`][^"'`]*(approval|letter|certificate)/i);
    expect(forms).toMatch(/name="owner_reference"[^>]*required/);
    expect(forms).toMatch(/name="ca_reference"[^>]*required/);
    const actions = readFileSync('lib/admin/marketplace/actions.ts', 'utf8');
    expect(actions).not.toMatch(/createServiceRoleClient|createTrustedDeliveryWriter/);
    expect(actions).not.toMatch(/\.from\('marketplace_launch_approvals'/);
  });
});
