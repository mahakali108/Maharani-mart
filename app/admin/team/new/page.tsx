import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StaffForm } from '@/components/admin/staff-form';

export default async function NewStaffPage() {
  // Page-level gate (not just the action) since this whole screen is
  // pointless without team.manage — same reasoning as any admin write
  // flow that isn't useful in a read-only view.
  await requirePermission('team.manage');

  const supabase = createClient();
  const [{ data: areas }, { data: warehouses }] = await Promise.all([
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Add staff / salesman</h1>
        <p className="mt-1 text-sm text-ink-500">Creates a login account for this person.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <StaffForm areas={areas ?? []} warehouses={warehouses ?? []} />
      </Card>
    </div>
  );
}

