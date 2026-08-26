import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { getUserManagementView, getUserFeatureOverrides, getUserAccessPeriods, getFeatures } from '@/lib/admin/control-center/actions';
import { UserManagementClient } from './client';

export const dynamic = 'force-dynamic';

export default async function UserManagementPage({ params }: { params: { id: string } }) {
  await requireSuperAdmin();

  const [userView, overrides, accessPeriods, features] = await Promise.all([
    getUserManagementView(params.id),
    getUserFeatureOverrides(params.id),
    getUserAccessPeriods(params.id),
    getFeatures(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/control-center"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-ink-950">{userView.fullName}</h1>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            User Management · Super Admin only
          </p>
        </div>
      </div>

      <UserManagementClient
        userView={userView}
        overrides={overrides}
        accessPeriods={accessPeriods}
        features={features}
      />
    </div>
  );
}
