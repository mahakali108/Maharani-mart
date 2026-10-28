'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import {
  type BusinessProfileConfig,
  type ContactGrievanceConfig,
  type MarketplaceComplianceConfig,
  businessProfileSchema,
  contactGrievanceSchema,
  marketplaceComplianceSchema,
} from './types';

interface SettingRow {
  value: Record<string, unknown>;
}

async function recordSuperAdminAudit(
  actorId: string,
  targetId: string | null,
  action: string,
  beforeData: Record<string, unknown> | null = null,
  afterData: Record<string, unknown> | null = null,
  reason: string | null = null
) {
  const supabase = createClient();
  const { error } = await supabase.from('super_admin_audit_logs').insert({
    actor_id: actorId,
    target_id: targetId,
    action,
    before_data: beforeData,
    after_data: afterData,
    reason,
  } as never);
  if (error) {
    throw new Error(`Audit log entry failed: ${error.message}`);
  }
}

/** Update Business Profile (Super Admin Only) */
export async function updateBusinessProfileAction(
  payload: unknown,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireSuperAdmin();
    const parsed = businessProfileSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid business profile payload.' };
    }

    const supabase = createClient();
    const { data: before } = await supabase
      .from('platform_settings' as never)
      .select('value')
      .eq('key', 'business_profile')
      .maybeSingle<SettingRow>();

    const valueToSave: BusinessProfileConfig = {
      ...parsed.data,
      gstin: parsed.data.gstin || null,
      pan: parsed.data.pan || null,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };

    // Upsert platform_settings
    const { error } = await supabase.from('platform_settings' as never).upsert(
      {
        key: 'business_profile',
        value: valueToSave as never,
        description: 'Legal business entity and GST verification particulars',
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'key' }
    );

    if (error) {
      return { success: false, error: `Failed to save business profile: ${(error as { message: string }).message}` };
    }

    await recordSuperAdminAudit(
      user.id,
      null,
      'SETTING_CHANGED',
      before?.value ?? null,
      valueToSave as unknown as Record<string, unknown>,
      reason ?? 'Updated platform business and tax identity'
    );

    revalidatePath('/admin/control-center');
    revalidatePath('/legal/terms');
    revalidatePath('/about');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized or internal error';
    return { success: false, error: msg };
  }
}

/** Update Contact & Grievance Particulars (Super Admin Only) */
export async function updateContactGrievanceAction(
  payload: unknown,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireSuperAdmin();
    const parsed = contactGrievanceSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid contact/grievance payload.' };
    }

    const supabase = createClient();
    const { data: before } = await supabase
      .from('platform_settings' as never)
      .select('value')
      .eq('key', 'contact_grievance')
      .maybeSingle<SettingRow>();

    const valueToSave: ContactGrievanceConfig = {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };

    const { error } = await supabase.from('platform_settings' as never).upsert(
      {
        key: 'contact_grievance',
        value: valueToSave as never,
        description: 'Statutory Grievance Redressal Officer and customer support particulars',
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'key' }
    );

    if (error) {
      return { success: false, error: `Failed to save contact/grievance: ${(error as { message: string }).message}` };
    }

    await recordSuperAdminAudit(
      user.id,
      null,
      'SETTING_CHANGED',
      before?.value ?? null,
      valueToSave as unknown as Record<string, unknown>,
      reason ?? 'Updated statutory grievance redressal officer contact details'
    );

    revalidatePath('/admin/control-center');
    revalidatePath('/legal/grievance');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized or internal error';
    return { success: false, error: msg };
  }
}

/** Update Marketplace Compliance & Tax Gates (Super Admin Only) */
export async function updateMarketplaceComplianceAction(
  payload: unknown,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireSuperAdmin();
    const parsed = marketplaceComplianceSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid marketplace compliance payload.' };
    }

    // RETIRED (migration 0083): membership, and therefore the membership
    // checkout discount, no longer exists. A CA reference can never switch it
    // back on; a legacy payload asking for `true` is refused outright and the
    // stored value is always false.
    if (parsed.data.membershipDiscountCheckoutActive) {
      return {
        success: false,
        error:
          'Membership discounts were retired with the paid membership system. There is no membership checkout discount to activate.',
      };
    }

    const supabase = createClient();
    const { data: before } = await supabase
      .from('platform_settings' as never)
      .select('value')
      .eq('key', 'marketplace_compliance')
      .maybeSingle<SettingRow>();

    const valueToSave: MarketplaceComplianceConfig = {
      ...parsed.data,
      membershipDiscountCheckoutActive: false,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };

    const { error } = await supabase.from('platform_settings' as never).upsert(
      {
        key: 'marketplace_compliance',
        value: valueToSave as never,
        description: 'Marketplace discount funding, seller moderation, and CA tax gate settings',
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'key' }
    );

    if (error) {
      return { success: false, error: `Failed to save marketplace compliance: ${(error as { message: string }).message}` };
    }

    await recordSuperAdminAudit(
      user.id,
      null,
      'SETTING_CHANGED',
      before?.value ?? null,
      valueToSave as unknown as Record<string, unknown>,
      reason ?? 'Updated marketplace compliance and CA approval gates'
    );

    revalidatePath('/admin/control-center');
    revalidatePath('/retailer/checkout');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized or internal error';
    return { success: false, error: msg };
  }
}
