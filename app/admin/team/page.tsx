import Link from 'next/link';
import { UserCog, Plus } from 'lucide-react';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StaffRowActions } from '@/components/admin/staff-row-actions';

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

export default async function TeamPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'team.manage');

  const supabase = createClient();

  // profiles.role is a Postgres enum, so .in() with the two role
  // values is a normal indexable filter, not a full scan.
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active')
    .in('role', ['staff', 'salesman'])
    .order('full_name');

  const staff = (profileRows ?? []) as unknown as StaffProfileRow[];
  const staffIds = staff.map((s) => s.id);

  // Separate queries, not embeds — same reasoning as the fix in
  // app/admin/retailers/page.tsx: keep every join explicit and in JS
  // so a relationship that doesn't resolve can never silently drop a
  // row instead of just leaving a field blank.
  const [{ data: assignmentRows }, { data: areaRows }, { data: warehouseRows }] = await Promise.all([
    staffIds.length > 0
      ? supabase.from('staff_assignments').select('staff_id, area_id, warehouse_id').in('staff_id', staffIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from('areas').select('id, name'),
    supabase.from('warehouses').select('id, name'),
  ]);

  const assignmentByStaff = new Map(
    ((assignmentRows ?? []) as unknown as StaffAssignmentRow[]).map((a) => [a.staff_id, a])
  );
  const areaById = new Map(((areaRows ?? []) as unknown as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const warehouseById = new Map(
    ((warehouseRows ?? []) as unknown as { id: string; name: string }[]).map((w) => [w.id, w.name])
  );

  // Email lives on auth.users, not any RLS-governed public table, so
  // it can only be read via the admin API — using the service-role
  // client here is safe because this runs entirely on the server
  // (never shipped to the browser) and is the same pattern already
  // set up in lib/supabase/server.ts for this exact purpose.
  const emailById = new Map<string, string>();
  if (staffIds.length > 0 && canManage) {
    const adminClient = createServiceRoleClient();
    const { data: usersPage } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users ?? []) {
      if (staffIds.includes(u.id)) emailById.set(u.id, u.email ?? '—');
    }
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
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
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
              {staff.map((s) => {
                const assignment = assignmentByStaff.get(s.id);
                const areaName = assignment?.area_id ? areaById.get(assignment.area_id) : null;
                const warehouseName = assignment?.warehouse_id ? warehouseById.get(assignment.warehouse_id) : null;
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.full_name}</td>
                    <td className="px-5 py-3 text-ink-600">
                      <p>{s.phone}</p>
                      {canManage ? <p className="text-xs text-ink-400">{emailById.get(s.id) ?? '—'}</p> : null}
                    </td>
                    <td className="px-5 py-3 text-ink-600 capitalize">{s.role}</td>
                    <td className="px-5 py-3 text-ink-600">
                      {areaName || warehouseName ? (
                        <>
                          {areaName ? <span>{areaName}</span> : null}
                          {areaName && warehouseName ? ' · ' : ''}
                          {warehouseName ? <span>{warehouseName}</span> : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          s.is_active ? 'bg-green-50 text-green-700' : 'bg-ink-100 text-ink-500'
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
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

