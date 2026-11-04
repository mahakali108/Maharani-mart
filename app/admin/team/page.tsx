import Link from 'next/link';
import { UserCog, Plus } from 'lucide-react';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StaffRowActions } from '@/components/admin/staff-row-actions';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

interface StaffProfileRow {
  id: string;
  full_name: string;
  phone: string;
  role: 'staff' | 'salesman';
  is_active: boolean;
}

interface StaffAssignmentRow {
  staff_id: string;
  area_id: string | null;
  warehouse_id: string | null;
}

/** Rows per batch. */
const BATCH_SIZE = 25;

/**
 * Alphabetical by name, `id` breaking ties. Both columns are NOT NULL
 * (0001_init.sql), so a keyset cursor on the pair is always comparable and
 * batches can never overlap or skip.
 */
const ORDER: KeysetColumn[] = [
  { column: 'full_name', ascending: true },
  { column: 'id', ascending: true },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Email lives on auth.users, not any RLS-governed public table, so it can only
 * be read via the admin API — using the service-role client here is safe
 * because this runs entirely on the server (never shipped to the browser) and
 * is the same pattern already set up in lib/supabase/server.ts for this exact
 * purpose. Only the ids in THIS batch are looked up, so the cost is bounded by
 * the batch size instead of listing every auth user on every scroll step.
 */
async function loadEmailMap(ids: string[]): Promise<Map<string, string>> {
  const emailById = new Map<string, string>();
  if (ids.length === 0) return emailById;
  const adminClient = createServiceRoleClient();
  const results = await Promise.all(ids.map((id) => adminClient.auth.admin.getUserById(id)));
  for (const [index, result] of results.entries()) {
    const id = ids[index];
    if (!id) continue;
    emailById.set(id, result.data?.user?.email ?? '—');
  }
  return emailById;
}

/**
 * One batch of staff/salesman profiles plus everything the table shows.
 *
 * Separate queries, not embeds — same reasoning as app/admin/retailers/page.tsx:
 * keep every join explicit and in JS so a relationship that doesn't resolve can
 * never silently drop a row instead of just leaving a field blank. Areas and
 * warehouses are reference lists that stay small; the assignment lookup is
 * scoped to this batch with `.in()`.
 */
async function loadStaffBatch(
  supabase: SupabaseClient,
  options: { canManage: boolean },
  cursor: ListCursor | null
): Promise<{
  items: (StaffProfileRow & { areaName: string | null; warehouseName: string | null; email: string | null })[];
  nextCursor: string | null;
}> {
  // profiles.role is a Postgres enum, so .in() with the two role
  // values is a normal indexable filter, not a full scan.
  const query = supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active')
    .in('role', ['staff', 'salesman']);

  const { data: profileRows } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const staff = (profileRows ?? []) as unknown as StaffProfileRow[];
  const staffIds = staff.map((s) => s.id);

  const [{ data: assignmentRows }, { data: areaRows }, { data: warehouseRows }, emailById] = await Promise.all([
    staffIds.length > 0
      ? supabase.from('staff_assignments').select('staff_id, area_id, warehouse_id').in('staff_id', staffIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from('areas').select('id, name'),
    supabase.from('warehouses').select('id, name'),
    options.canManage ? loadEmailMap(staffIds) : Promise.resolve(new Map<string, string>()),
  ]);

  const assignmentByStaff = new Map(
    ((assignmentRows ?? []) as unknown as StaffAssignmentRow[]).map((a) => [a.staff_id, a])
  );
  const areaById = new Map(((areaRows ?? []) as unknown as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const warehouseById = new Map(
    ((warehouseRows ?? []) as unknown as { id: string; name: string }[]).map((w) => [w.id, w.name])
  );

  const batch = toListBatch(staff, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return {
    items: batch.items.map((s) => {
      const assignment = assignmentByStaff.get(s.id);
      return {
        ...s,
        areaName: assignment?.area_id ? areaById.get(assignment.area_id) ?? null : null,
        warehouseName: assignment?.warehouse_id ? warehouseById.get(assignment.warehouse_id) ?? null : null,
        email: options.canManage ? emailById.get(s.id) ?? null : null,
      };
    }),
    nextCursor: batch.nextCursor,
  };
}

export default async function TeamPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'team.manage');

  const supabase = (await createClient());
  const firstBatch = await loadStaffBatch(supabase, { canManage }, null);
  const staff = firstBatch.items;

  /**
   * Server Action for the batches after the first: the permission is re-derived
   * from the session instead of being trusted from the closure, so an email is
   * never returned to someone who cannot manage the team.
   */
  async function loadMoreStaff(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const allowed = can(caller.role, 'team.manage');
    const batch = await loadStaffBatch((await createClient()), { canManage: allowed }, readCursor(cursor));
    return { rows: renderStaffRows(batch.items, allowed), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Staff &amp; Salesmen</h1>
          <p className="mt-1 text-sm text-ink-500">Manage staff and salesman accounts and their area assignment.</p>
        </div>
        {canManage ? (
          <Link href="/admin/team/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              Add staff / salesman
            </Button>
          </Link>
        ) : null}
      </div>

      {staff.length === 0 ? (
        <AdminEmptyState
          icon={UserCog}
          title="No staff or salesman accounts yet"
          body={
            canManage
              ? 'Add your first staff or salesman account above.'
              : "You don't have permission to manage staff accounts."
          }
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreStaff}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Assignment</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  {canManage ? <th className="px-5 py-3 font-medium" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={canManage ? 6 : 5} />}>
                  {renderStaffRows(staff, canManage)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more staff" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}

type StaffCard = StaffProfileRow & { areaName: string | null; warehouseName: string | null; email: string | null };

function renderStaffRows(staff: StaffCard[], canManage: boolean) {
  return staff.map((s) => (
    <tr key={s.id}>
      <td className="px-5 py-3 font-medium text-ink-900">{s.full_name}</td>
      <td className="px-5 py-3 text-ink-600">
        <p>{s.phone}</p>
        {canManage ? <p className="text-xs text-ink-400">{s.email ?? '—'}</p> : null}
      </td>
      <td className="px-5 py-3 text-ink-600 capitalize">{s.role}</td>
      <td className="px-5 py-3 text-ink-600">
        {s.areaName || s.warehouseName ? (
          <>
            {s.areaName ? <span>{s.areaName}</span> : null}
            {s.areaName && s.warehouseName ? ' · ' : ''}
            {s.warehouseName ? <span>{s.warehouseName}</span> : null}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-5 py-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            s.is_active ? 'bg-mint-50 text-mint-700' : 'bg-ink-100 text-ink-500'
          }`}
        >
          {s.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      {canManage ? (
        <td className="px-5 py-3 text-right">
          <StaffRowActions staffId={s.id} isActive={s.is_active} />
        </td>
      ) : null}
    </tr>
  ));
}
