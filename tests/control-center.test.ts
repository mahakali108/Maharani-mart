import { describe, expect, it } from 'vitest';
import { allBusinessTools, executeBusinessTool, toolsForContext } from '@/lib/ai/tools';
import type { AIToolContext } from '@/lib/ai/types';
import { computeAccessStatus, statusBadgeColor, ACCESS_PRESETS } from '@/lib/admin/control-center/types';
import type { AccessStatus } from '@/lib/admin/control-center/types';

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

interface FakeRows {
  [table: string]: { data: unknown; error?: { message: string } };
}

function fakeSupabase(rows: FakeRows) {
  const chain = (table: string): Record<string, unknown> => {
    const result = rows[table] ?? { data: [] };
    const obj: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'or', 'order', 'limit', 'range', 'maybeSingle', 'single', 'not']) {
      obj[method] = () => obj;
    }
    obj.then = (resolve: (value: unknown) => void) => {
      resolve(result);
      return obj;
    };
    return obj;
  };
  return { from: (table: string) => chain(table) } as never;
}

function actorContext(role: 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer'): AIToolContext {
  const surface = role === 'retailer' ? 'retailer' : role === 'salesman' ? 'salesman' : role === 'staff' ? 'staff' : 'admin';
  return {
    actor: { id: '11111111-1111-4111-8111-111111111111', role, fullName: 'Test User', surface },
    supabase: fakeSupabase({}) as AIToolContext['supabase'],
    requestId: '22222222-2222-4222-8222-222222222222',
    confirmed: false,
  };
}

// ---------------------------------------------------------------------------
// Access Status Computation
// ---------------------------------------------------------------------------

describe('Access Status Computation', () => {
  it('returns unlimited for null expiry', () => {
    expect(computeAccessStatus(null)).toBe('unlimited');
  });

  it('returns expired for past dates', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeAccessStatus(pastDate)).toBe('expired');
  });

  it('returns expiring_soon for dates within 3 days', () => {
    const twoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeAccessStatus(twoDays)).toBe('expiring_soon');
  });

  it('returns active for dates beyond 3 days', () => {
    const tenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeAccessStatus(tenDays)).toBe('active');
  });

  it('returns expiring_soon for exactly 3 days boundary', () => {
    const exactly3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    expect(computeAccessStatus(exactly3Days)).toBe('expiring_soon');
  });
});

// ---------------------------------------------------------------------------
// Status Badge Colors
// ---------------------------------------------------------------------------

describe('Status Badge Colors', () => {
  it('returns correct color for each status', () => {
    expect(statusBadgeColor('active')).toContain('emerald');
    expect(statusBadgeColor('expiring_soon')).toContain('amber');
    expect(statusBadgeColor('expired')).toContain('red');
    expect(statusBadgeColor('suspended')).toContain('gray');
    expect(statusBadgeColor('unlimited')).toContain('blue');
  });
});

// ---------------------------------------------------------------------------
// Access Presets
// ---------------------------------------------------------------------------

describe('Access Presets', () => {
  it('has all required presets', () => {
    const labels = ACCESS_PRESETS.map((p) => p.label);
    expect(labels).toContain('1 Day');
    expect(labels).toContain('3 Days');
    expect(labels).toContain('7 Days');
    expect(labels).toContain('15 Days');
    expect(labels).toContain('30 Days');
    expect(labels).toContain('Unlimited');
  });

  it('unlimited preset has null days', () => {
    const unlimited = ACCESS_PRESETS.find((p) => p.label === 'Unlimited');
    expect(unlimited?.days).toBeNull();
  });

  it('7-day preset is the default trial', () => {
    const sevenDays = ACCESS_PRESETS.find((p) => p.days === 7);
    expect(sevenDays?.label).toBe('7 Days');
  });
});

// ---------------------------------------------------------------------------
// Control Center AI Tools Authorization
// ---------------------------------------------------------------------------

describe('Control Center AI tools authorization', () => {
  it('exposes control center tools to super_admin only', () => {
    const controlCenterToolNames = [
      'get_users_expiring_soon',
      'get_disabled_features',
      'get_expired_retailers',
      'get_suspended_users',
      'get_recent_permission_changes',
    ];

    const superAdminTools = toolsForContext(actorContext('super_admin'));
    const superAdminNames = new Set(superAdminTools.map((t) => t.name));

    for (const name of controlCenterToolNames) {
      expect(superAdminNames.has(name), `${name} should be available to super_admin`).toBe(true);
    }

    // Normal admin must NOT receive control center tools
    const adminNames = new Set(toolsForContext(actorContext('admin')).map((t) => t.name));
    for (const name of controlCenterToolNames) {
      expect(adminNames.has(name), `${name} leaked to admin`).toBe(false);
    }

    // Other roles must NOT receive control center tools
    for (const role of ['staff', 'salesman', 'retailer'] as const) {
      const names = new Set(toolsForContext(actorContext(role)).map((t) => t.name));
      for (const name of controlCenterToolNames) {
        expect(names.has(name), `${name} leaked to ${role}`).toBe(false);
      }
    }
  });

  it('registers ONLY READ tools for control center', () => {
    const controlCenterToolNames = [
      'get_users_expiring_soon',
      'get_disabled_features',
      'get_expired_retailers',
      'get_suspended_users',
      'get_recent_permission_changes',
    ];

    for (const name of controlCenterToolNames) {
      const tool = allBusinessTools.find((t) => t.name === name);
      expect(tool, `${name} should exist`).toBeDefined();
      expect(tool!.actionClass, `${name} should be READ`).toBe('READ');
      expect(tool!.roles).toContain('super_admin');
      expect(tool!.surfaces).toContain('admin');
    }
  });

  it('rejects control center tool requested by non-super-admin at execution time', async () => {
    const execution = await executeBusinessTool('get_users_expiring_soon', {}, actorContext('admin'));
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toContain('not available for the authenticated role');
  });
});

// ---------------------------------------------------------------------------
// Control Center AI Tools - Data Handling
// ---------------------------------------------------------------------------

describe('Control Center AI tools data handling', () => {
  it('reports empty data honestly for users expiring soon', async () => {
    const supabase = fakeSupabase({ user_access_periods: { data: [] } });
    const context: AIToolContext = { ...actorContext('super_admin'), supabase };
    const execution = await executeBusinessTool('get_users_expiring_soon', {}, context);
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toContain("I couldn't verify that from current Maharani Traders data.");
  });

  it('reports empty data honestly for disabled features', async () => {
    const supabase = fakeSupabase({ platform_features: { data: [] } });
    const context: AIToolContext = { ...actorContext('super_admin'), supabase };
    const execution = await executeBusinessTool('get_disabled_features', {}, context);
    expect(execution.result.ok).toBe(true);
    const data = execution.result.data as { disabled: unknown[] };
    expect(data.disabled).toHaveLength(0);
  });

  it('reports empty data honestly for suspended users', async () => {
    const supabase = fakeSupabase({ profiles: { data: [] } });
    const context: AIToolContext = { ...actorContext('super_admin'), supabase };
    const execution = await executeBusinessTool('get_suspended_users', {}, context);
    expect(execution.result.ok).toBe(true);
    const data = execution.result.data as { suspended: unknown[] };
    expect(data.suspended).toHaveLength(0);
  });

  it('surfaces database failures as unverified', async () => {
    const supabase = fakeSupabase({ user_access_periods: { data: null, error: { message: 'connection refused' } } });
    const context: AIToolContext = { ...actorContext('super_admin'), supabase };
    const execution = await executeBusinessTool('get_users_expiring_soon', {}, context);
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toContain("I couldn't verify that from current Maharani Traders data.");
  });
});

// ---------------------------------------------------------------------------
// Privilege Escalation Prevention
// ---------------------------------------------------------------------------

describe('Privilege escalation prevention', () => {
  it('control center tools are not accessible to non-super-admin roles at execution time', async () => {
    const toolNames = [
      'get_users_expiring_soon',
      'get_disabled_features',
      'get_expired_retailers',
      'get_suspended_users',
      'get_recent_permission_changes',
    ];

    for (const role of ['admin', 'staff', 'salesman', 'retailer'] as const) {
      for (const toolName of toolNames) {
        const execution = await executeBusinessTool(toolName, {}, actorContext(role));
        expect(execution.result.ok, `${toolName} executed for ${role}`).toBe(false);
      }
    }
  });

  it('super admin executive tools remain isolated from control center tools', () => {
    const superAdminOnly = allBusinessTools.filter((t) => t.roles.length === 1 && t.roles[0] === 'super_admin');
    const names = superAdminOnly.map((t) => t.name);

    // Original executive tools
    expect(names).toContain('get_command_overview');
    expect(names).toContain('get_business_risks');

    // New control center tools
    expect(names).toContain('get_users_expiring_soon');
    expect(names).toContain('get_disabled_features');
    expect(names).toContain('get_expired_retailers');
    expect(names).toContain('get_suspended_users');
    expect(names).toContain('get_recent_permission_changes');
  });
});
