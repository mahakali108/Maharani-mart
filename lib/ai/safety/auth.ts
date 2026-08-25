import type { UserRole } from '@/lib/auth/roles';
import type { AISurface } from '@/lib/ai/types';

export function isRoleAuthorizedForAISurface(role: UserRole, surface: AISurface): boolean {
  if (surface === 'retailer') return role === 'retailer';
  if (surface === 'salesman') return role === 'salesman';
  if (surface === 'staff') return role === 'staff';
  return role === 'admin' || role === 'super_admin';
}

/** Retailer tools are structurally pinned to the session user, never model input. */
export function resolveRetailerTarget(actor: { id: string; role: UserRole }, requestedId?: string): string | null {
  if (actor.role === 'retailer') return actor.id;
  if ((actor.role === 'salesman' || actor.role === 'staff' || actor.role === 'admin' || actor.role === 'super_admin') && requestedId) return requestedId;
  return null;
}

export function isTrustedAIOrigin(requestUrl: string, origin: string | null, configuredSiteUrl?: string): boolean {
  if (!origin) return true; // Non-browser clients still require authenticated cookies.
  const allowed = new Set<string>();
  try { allowed.add(new URL(requestUrl).origin); } catch { return false; }
  if (configuredSiteUrl) {
    try { allowed.add(new URL(configuredSiteUrl).origin); } catch { /* ignore invalid optional URL */ }
  }
  return allowed.has(origin);
}
