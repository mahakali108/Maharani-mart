import { UserCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

interface ProfileRow {
  full_name: string;
  phone: string;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface AssignmentRow {
  area_id: string | null;
  warehouse_id: string | null;
}

export default async function SalesmanProfilePage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: profile }, { data: assignment }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, phone, avatar_url, is_active, created_at')
      .eq('id', user.id)
      .single<ProfileRow>(),
    supabase
      .from('staff_assignments')
      .select('area_id, warehouse_id')
      .eq('staff_id', user.id)
      .maybeSingle<AssignmentRow>(),
  ]);

  const [{ data: area }, { data: warehouse }] = await Promise.all([
    assignment?.area_id
      ? supabase.from('areas').select('name').eq('id', assignment.area_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
    assignment?.warehouse_id
      ? supabase.from('warehouses').select('name').eq('id', assignment.warehouse_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Profile</h1>
        <p className="mt-1 text-sm text-ink-500">Your account and team assignment.</p>
      </div>

      <Card className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-600">
          <UserCircle className="h-8 w-8" />
        </div>
        <div>
          <p className="font-semibold text-ink-950">{profile?.full_name ?? user.fullName}</p>
          <p className="text-sm text-ink-500">Salesman</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${profile?.is_active ? 'bg-green-50 text-green-700' : 'bg-ink-100 text-ink-500'}`}>
            {profile?.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-ink-400">Email</dt><dd className="font-medium text-ink-900">{user.email ?? '—'}</dd></div>
          <div><dt className="text-ink-400">Phone</dt><dd className="font-medium text-ink-900">{profile?.phone ?? '—'}</dd></div>
        </dl>
      </Card>

      <Card>
        <CardHeader><CardTitle>Team assignment</CardTitle></CardHeader>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-400">Area</dt><dd className="font-medium text-ink-900">{area?.name ?? 'Not assigned'}</dd></div>
          <div><dt className="text-ink-400">Warehouse</dt><dd className="font-medium text-ink-900">{warehouse?.name ?? 'Not assigned'}</dd></div>
          <div><dt className="text-ink-400">Member since</dt><dd className="font-medium text-ink-900">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-IN') : '—'}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
