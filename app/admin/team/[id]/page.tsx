import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StaffEditForm } from '@/components/admin/staff-edit-form';

interface StaffDetail {
  id: string;
  full_name: string;
  phone: string;
  role: 'staff' | 'salesman';
}

interface AssignmentRow {
  area_id: string | null;
  warehouse_id: string | null;
}

export default async function EditStaffPage({ params }: { params: { id: string } }) {
  await requirePermission('team.manage');

  const supabase = createClient();
  const { data: staffMember } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .eq('id', params.id)
    .in('role', ['staff', 'salesman'])
    .maybeSingle<StaffDetail>();

  if (!staffMember) notFound();

  const [{ data: assignment }, { data: areas }, { data: warehouses }] = await Promise.all([
    supabase
      .from('staff_assignments')
      .select('area_id, warehouse_id')
      .eq('staff_id', params.id)
      .maybeSingle<AssignmentRow>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit team member</h1>
        <p className="mt-1 text-sm text-ink-500">{staffMember.full_name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <StaffEditForm
          staffId={staffMember.id}
          fullName={staffMember.full_name}
          phone={staffMember.phone}
          role={staffMember.role}
          areaId={assignment?.area_id ?? null}
          warehouseId={assignment?.warehouse_id ?? null}
          areas={areas ?? []}
          warehouses={warehouses ?? []}
        />
      </Card>
    </div>
  );
}

