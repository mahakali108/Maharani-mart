import 'server-only';

/**
 * Authorisation rules for media.
 *
 * Every upload/delete is authorised against the caller's **Supabase** session
 * and the existing permission matrix (`lib/permissions/permissions.ts`).
 * Supabase Storage RLS remains the final authority on the actual object
 * write/delete — this module is a defence-in-depth layer on top of it.
 *
 * Ownership rules are enforced here so a retailer can never write into another
 * retailer's folder even if they tamper with the request payload.
 */

import { requireUser, type CurrentUser } from '@/lib/auth/session';
import { can, type Permission } from '@/lib/permissions/permissions';

import { isUuid } from './paths';
import { MEDIA_KIND_CONFIG, type MediaKind } from './types';

export type AccessDecision =
  | { ok: true; user: CurrentUser; ownerId: string | null }
  | { ok: false; error: string };

/** Permission required for staff-managed media. */
const REQUIRED_PERMISSION: Record<MediaKind, Permission> = {
  'product-gallery': 'products.edit',
  'brand-logo': 'master_data.manage',
  'category-image': 'master_data.manage',
  banner: 'banners.manage',
  // Staff acting on someone else's behalf need retailer-management rights;
  // a user editing their own avatar is handled by the self-service branch.
  'retailer-avatar': 'retailers.approve',
  'retailer-document': 'retailers.approve',
};

/** Kinds a user may perform on their OWN record without any staff permission. */
const SELF_SERVICE_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  'retailer-avatar',
  'retailer-document',
]);

/** Kinds that may be uploaded before the owning row exists (create-then-attach). */
const DRAFT_ALLOWED: ReadonlySet<MediaKind> = new Set<MediaKind>(['banner']);

/**
 * Decide whether `user` may write media of `kind` for entity `ownerId`.
 *
 * `ownerId` is validated as a UUID here; the *existence* of the row is
 * confirmed by the calling server action (which also holds the DB write), and
 * Supabase RLS remains the final authority on that write.
 */
export async function authorizeMediaWrite(
  kind: MediaKind,
  rawOwnerId: unknown,
): Promise<AccessDecision> {
  const user = await requireUser();
  const config = MEDIA_KIND_CONFIG[kind];

  const ownerId =
    typeof rawOwnerId === 'string' && rawOwnerId.trim() !== '' ? rawOwnerId.trim() : null;

  if (ownerId !== null && !isUuid(ownerId)) {
    return { ok: false, error: 'Invalid target for this upload.' };
  }

  if (ownerId === null && !DRAFT_ALLOWED.has(kind)) {
    return { ok: false, error: `${config.label} uploads require a saved record first.` };
  }

  // Self-service: a user uploading against their own profile id.
  if (SELF_SERVICE_KINDS.has(kind) && ownerId !== null && ownerId === user.id) {
    return { ok: true, user, ownerId };
  }

  const permission = REQUIRED_PERMISSION[kind];
  if (!can(user.role, permission)) {
    return {
      ok: false,
      error: `You don't have permission to upload ${config.label.toLowerCase()}s (requires "${permission}").`,
    };
  }

  // Retailers never hold these permissions, but be explicit: a retailer may
  // only ever target their own id, never another retailer's folder.
  if (user.role === 'retailer' && ownerId !== user.id) {
    return { ok: false, error: 'You can only upload files to your own account.' };
  }

  return { ok: true, user, ownerId };
}
