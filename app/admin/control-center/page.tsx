import { Settings, ShieldCheck } from 'lucide-react';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { getControlCenterOverview, getFeatures, getAllUsers, getSuperAdminAuditLogs, getPlatformSettings } from '@/lib/admin/control-center/actions';
import { ControlCenterClient } from './client';

export const dynamic = 'force-dynamic';

export default async function ControlCenterPage() {
  const user = await requireSuperAdmin();

  const [overview, features, users, auditLogs, settings] = await Promise.all([
    getControlCenterOverview(),
    getFeatures(),
    getAllUsers(),
    getSuperAdminAuditLogs(30),
    getPlatformSettings(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
              <Settings className="h-5 w-5 text-white" />
            </span>
            <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Master Control Center</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Super Admin only · Full platform control · All actions audit logged
          </p>
        </div>
      </div>

      <ControlCenterClient
        overview={overview}
        features={features}
        users={users}
        auditLogs={auditLogs}
        settings={settings}
        currentUserId={user.id}
      />
    </div>
  );
}
