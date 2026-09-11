import { Tags } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { SchemeForm } from '@/components/admin/scheme-form';
import { SchemeRowActions } from '@/components/admin/scheme-row-actions';
import { formatIndiaDateTime } from '@/lib/datetime/india';

interface SchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

function toDateTimeLocal(iso: string): string {
  return iso.slice(0, 16);
}

export default async function AdminSchemesPage() {
  await requirePermission('pricing.manage');
  const supabase = createClient();

  const { data } = await supabase
    .from('schemes')
    .select('id, name, description, is_festival, starts_at, ends_at, is_active')
    .order('created_at', { ascending: false })
    .returns<SchemeRow[]>();

  const schemes = data ?? [];
  const now = Date.now();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Schemes</h1>
        <p className="mt-1 text-sm text-ink-500">
          Trade and festival schemes shown to retailers and used by scheme-scoped price lists. Every change is audit-logged.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a scheme</CardTitle>
        </CardHeader>
        <SchemeForm />
      </Card>

      {schemes.length === 0 ? (
        <AdminEmptyState
          icon={Tags}
          title="No schemes yet"
          body="Schemes you create here appear on the retailer app's Schemes page once active and in their validity window."
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Valid</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {schemes.map((s) => {
                const started = new Date(s.starts_at).getTime() <= now;
                const ended = new Date(s.ends_at).getTime() <= now;
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{s.name}</p>
                      {s.description ? <p className="mt-0.5 max-w-md break-words text-xs text-ink-400">{s.description}</p> : null}
                    </td>
                    <td className="px-5 py-3 text-ink-600">{s.is_festival ? 'Festival' : 'Trade'}</td>
                    <td className="px-5 py-3 text-xs text-ink-600">
                      {formatIndiaDateTime(s.starts_at)} → {formatIndiaDateTime(s.ends_at)}
                    </td>
                    <td className="px-5 py-3">
                      {!s.is_active ? (
                        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">Deactivated</span>
                      ) : ended ? (
                        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">Expired</span>
                      ) : started ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Running</span>
                      ) : (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Scheduled</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <SchemeRowActions
                        scheme={{
                          id: s.id,
                          name: s.name,
                          description: s.description ?? '',
                          isFestival: s.is_festival,
                          startsAt: toDateTimeLocal(s.starts_at),
                          endsAt: toDateTimeLocal(s.ends_at),
                        }}
                      />
                    </td>
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
