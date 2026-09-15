/**
 * Support tickets (retailer helpdesk) — pure workflow helpers + source-level
 * security guards.
 *
 * Locks in:
 *   1. Ticket number format is server-generated and validatable
 *   2. The status workflow is one-way (no silent skips/reversals)
 *   3. RLS: retailers create/reply on OWN tickets only (and only while open);
 *      admins manage status; NO delete policies anywhere
 *   4. Server actions re-verify role + ownership before writing
 *   5. Retailer pages are auth-gated and ownership-scoped (direct URL access)
 *   6. Admin nav + permission matrix are wired
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SUPPORT_STATUS_TRANSITIONS,
  SUPPORT_STATUSES,
  SUPPORT_TOPICS,
  canTransitionStatus,
  generateTicketNumber,
  isTicketOpen,
  isValidTicketNumber,
} from '@/lib/retailer/support';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const migration = read('supabase/migrations/0048_support_tickets.sql');
const retailerActions = read('lib/retailer/support-actions.ts');
const adminActions = read('lib/admin/support-actions.ts');
const listPage = read('app/retailer/support/page.tsx');
const newPage = read('app/retailer/support/new/page.tsx');
const detailPage = read('app/retailer/support/[id]/page.tsx');
const adminListPage = read('app/admin/support/page.tsx');
const adminDetailPage = read('app/admin/support/[id]/page.tsx');
const permissions = read('lib/permissions/permissions.ts');
const adminShell = read('components/layout/admin-shell.tsx');
const helpPage = read('app/retailer/help/page.tsx');

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe('ticket number', () => {
  it('builds MT-TKT-YYYYMMDD-XXXX from an India date key', () => {
    const n = generateTicketNumber('2026-09-15', 'a1b2');
    expect(n).toBe('MT-TKT-20260915-A1B2');
    expect(isValidTicketNumber(n)).toBe(true);
  });

  it('accepts only the canonical shape', () => {
    expect(isValidTicketNumber('MT-TKT-20260915-A1B2')).toBe(true);
    expect(isValidTicketNumber('MT-TKT-2026915-A1B2')).toBe(false); // 7 digits
    expect(isValidTicketNumber('X-TKT-20260915-A1B2')).toBe(false);
    expect(isValidTicketNumber('')).toBe(false);
  });
});

describe('status workflow', () => {
  it('supports exactly the four expected statuses', () => {
    expect([...SUPPORT_STATUSES].sort()).toEqual(['closed', 'in_progress', 'open', 'resolved']);
  });

  it('isTicketOpen is true only for open / in_progress', () => {
    expect(isTicketOpen('open')).toBe(true);
    expect(isTicketOpen('in_progress')).toBe(true);
    expect(isTicketOpen('resolved')).toBe(false);
    expect(isTicketOpen('closed')).toBe(false);
  });

  it('allows the documented moves and nothing else', () => {
    expect(canTransitionStatus('open', 'in_progress')).toBe(true);
    expect(canTransitionStatus('open', 'resolved')).toBe(true);
    expect(canTransitionStatus('in_progress', 'resolved')).toBe(true);
    expect(canTransitionStatus('resolved', 'in_progress')).toBe(true); // re-open
    expect(canTransitionStatus('resolved', 'closed')).toBe(true);
    // Closed is final.
    expect(SUPPORT_STATUS_TRANSITIONS.closed).toEqual([]);
    expect(canTransitionStatus('closed', 'open')).toBe(false);
    expect(canTransitionStatus('closed', 'in_progress')).toBe(false);
    // No skipping backwards.
    expect(canTransitionStatus('resolved', 'open')).toBe(false);
    expect(canTransitionStatus('delivered' as never, 'open')).toBe(false);
  });
});

describe('topics', () => {
  it('covers the common B2B support categories', () => {
    expect(SUPPORT_TOPICS).toContain('order');
    expect(SUPPORT_TOPICS).toContain('payment');
    expect(SUPPORT_TOPICS).toContain('delivery');
  });
});

// ---------------------------------------------------------------------------
// RLS guards (migration 0048)
// ---------------------------------------------------------------------------
describe('migration RLS', () => {
  it('creates both tables with RLS enabled', () => {
    expect(migration).toContain('create table if not exists support_tickets');
    expect(migration).toContain('create table if not exists support_ticket_messages');
    expect(migration).toContain('alter table support_tickets enable row level security');
    expect(migration).toContain('alter table support_ticket_messages enable row level security');
  });

  it('retailers can only INSERT their own ticket', () => {
    expect(migration).toMatch(
      /create policy "support_tickets_retailer_insert"[\s\S]*retailer_id = auth\.uid\(\)[\s\S]*current_user_role\(\) = 'retailer'/
    );
  });

  it('only admin+ can update ticket status', () => {
    expect(migration).toMatch(
      /create policy "support_tickets_admin_update"[\s\S]*is_admin_or_above\(\)/
    );
  });

  it('retailer message inserts require own ticket AND open/in_progress status', () => {
    expect(migration).toMatch(
      /create policy "support_messages_insert"[\s\S]*t\.retailer_id = auth\.uid\(\)[\s\S]*t\.status in \('open', 'in_progress'\)/
    );
  });

  it('message reads follow the parent ticket scope', () => {
    expect(migration).toMatch(
      /create policy "support_messages_read"[\s\S]*t\.retailer_id = auth\.uid\(\) or is_admin_or_above\(\)/
    );
  });

  it('has NO delete policies (append-only history)', () => {
    expect(migration).not.toMatch(/for delete/);
    expect(migration).not.toMatch(/create policy[\s\S]{0,80}delete/i);
  });

  it('audits both tables', () => {
    expect(migration).toContain('trg_audit_support_tickets');
    expect(migration).toContain('trg_audit_support_ticket_messages');
  });

  it('validates topic and status values at the DB level', () => {
    expect(migration).toContain("check (topic in ('order', 'payment', 'product', 'delivery', 'credit', 'other'))");
    expect(migration).toContain("check (status in ('open', 'in_progress', 'resolved', 'closed'))");
  });
});

// ---------------------------------------------------------------------------
// Server action guards
// ---------------------------------------------------------------------------
describe('retailer server actions', () => {
  it('enforces the retailer role (defense in depth)', () => {
    expect(retailerActions).toContain("user.role !== 'retailer'");
  });

  it('re-verifies ownership of a linked order before creating', () => {
    expect(retailerActions).toMatch(
      /eq\('id', input\.orderId\)[\s\S]*eq\('retailer_id', user\.id\)/
    );
  });

  it('generates the ticket number server-side and retries unique collisions', () => {
    expect(retailerActions).toContain('generateTicketNumber');
    expect(retailerActions).toContain("error.code === '23505'");
  });

  it('stores the author role from the verified caller, never the client', () => {
    expect(retailerActions).toMatch(/author_role: 'retailer'/);
  });

  it('blocks replies on resolved/closed tickets', () => {
    expect(retailerActions).toContain('isTicketOpen');
    expect(retailerActions).toMatch(/closed for replies/i);
  });
});

describe('admin server actions', () => {
  it('require the support.manage permission', () => {
    expect(adminActions).toContain("requirePermission('support.manage')");
  });

  it('validate transitions before updating', () => {
    expect(adminActions).toContain('canTransitionStatus');
  });

  it('updates optimistically (status equality guard) and stamps resolved/closed times', () => {
    expect(adminActions).toContain(".eq('status', ticket.status)");
    expect(adminActions).toContain('resolved_at');
    expect(adminActions).toContain('closed_at');
  });

  it('notifies the retailer through the existing notification infrastructure', () => {
    expect(adminActions).toContain('createInAppNotification');
    expect(adminActions).toContain('/retailer/support/');
  });
});

// ---------------------------------------------------------------------------
// Page-level guards (auth, ownership, states)
// ---------------------------------------------------------------------------
describe('retailer pages', () => {
  it('every retailer page is auth-gated with requireUser', () => {
    for (const page of [listPage, newPage, detailPage]) {
      expect(page).toContain('await requireUser()');
    }
  });

  it('lists only the caller\'s tickets with status filters', () => {
    expect(listPage).toContain("eq('retailer_id', user.id)");
    expect(listPage).toContain('All tickets');
    expect(listPage).toContain('New ticket');
  });

  it('the detail page 404s on foreign or missing tickets (ownership-scoped query)', () => {
    expect(detailPage).toContain('notFound()');
    expect(detailPage).toMatch(/eq\('id', params\.id\)[\s\S]*eq\('retailer_id', user\.id\)/);
  });

  it('the new-ticket page resolves ?order= against the caller\'s own orders only', () => {
    expect(newPage).toContain("eq('retailer_id', user.id)");
    expect(newPage).toContain('searchParams.order');
  });

  it('empty state exists on the list page', () => {
    expect(listPage).toContain('No support tickets yet');
  });
});

describe('admin pages', () => {
  it('admin list filters by status and links to the detail page', () => {
    expect(adminListPage).toContain('?status=');
    expect(adminListPage).toContain('/admin/support/${ticket.id}');
  });

  it('admin detail shows retailer + linked order context and the action form', () => {
    expect(adminDetailPage).toContain('TicketActionsForm');
    expect(adminDetailPage).toContain('shop_name');
    expect(adminDetailPage).toContain('order_number');
    expect(adminDetailPage).toContain('notFound()');
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
describe('permission + nav wiring', () => {
  it('adds support.manage to the permission type and to admin roles only', () => {
    expect(permissions).toContain("'support.manage'");
    // super_admin list line ends with command_center.view, support.manage
    expect(permissions).toMatch(/'command_center\.view', 'support\.manage',/);
    // admin list
    expect(permissions).toMatch(/'routes\.manage\.all', 'support\.manage',/);
  });

  it('admin sidebar exposes a Support item', () => {
    expect(adminShell).toMatch(/\{ label: 'Support', href: '\/admin\/support', icon: Headset \}/);
  });

  it('help centre links to ticket creation (order-prefilled when relevant)', () => {
    expect(helpPage).toContain('/retailer/support/new');
    expect(helpPage).toContain('New ticket');
  });
});
