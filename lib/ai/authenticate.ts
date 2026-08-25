import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { AIActor, AISurface } from '@/lib/ai/types';
import type { UserRole } from '@/lib/auth/roles';
import { isRoleAuthorizedForAISurface } from '@/lib/ai/safety/auth';

export type AIAuthResult = { actor: AIActor } | { error: string; status: number };

export async function authenticateAIRequest(
  supabase: ReturnType<typeof createClient>,
  surface: AISurface
): Promise<AIAuthResult> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { error: 'Authentication required.', status: 401 };
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role, full_name, is_active').eq('id', authData.user.id).maybeSingle<{ role: UserRole; full_name: string; is_active: boolean }>();
  if (profileError || !profile || !profile.is_active) return { error: 'Active profile required.', status: 403 };
  if (!isRoleAuthorizedForAISurface(profile.role, surface)) return { error: 'This AI workspace is not allowed for your role.', status: 403 };

  if (profile.role === 'retailer') {
    const { data: retailer } = await supabase.from('retailers').select('status').eq('id', authData.user.id).maybeSingle<{ status: string }>();
    if (retailer?.status !== 'active') return { error: 'An active retailer account is required.', status: 403 };
  }
  return { actor: { id: authData.user.id, role: profile.role, fullName: profile.full_name, surface } };
}
