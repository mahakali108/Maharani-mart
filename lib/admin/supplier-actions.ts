'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import {
  clientIdentityFromHeaders,
  createSupplierSubmissionLimiterFromFactory,
} from '@/lib/admin/supplier-rate-limit';
import {
  isSupplierDocType,
  normalizeSupplierApplication,
  validateSupplierApplication,
  type SupplierApplicationErrors,
} from '@/lib/admin/supplier-application';

export type SubmitSupplierResult =
  | { ok: true }
  | { ok: false; errors: SupplierApplicationErrors; error?: string };

/**
 * Public supplier-application submission (V1: application-only, no login).
 *
 * Defences, in order:
 *  1. honeypot — a filled `website` field means a bot; pretend success.
 *  2. rate limiting (lib/admin/supplier-rate-limit.ts): durable, atomic
 *     DB buckets keyed by hashed phone + best-effort client identity
 *     (migration 0060), failing open to an in-memory phone throttle if
 *     the RPC is unavailable. The durable duplicate protection remains
 *     the migration-0059 partial unique index.
 *  3. full server-side validation (the form's client checks are cosmetic).
 *  4. the ONLY write path is `submit_supplier_application(...)` — a
 *     SECURITY DEFINER function that forces status='pending' and cannot
 *     set GSTIN-verification or reviewer fields. Direct table INSERT is
 *     granted to no API role, and RLS gives anon no read at all, so an
 *     applicant can never read back (or enumerate) applications.
 */
export async function submitSupplierApplicationAction(
  formData: FormData
): Promise<SubmitSupplierResult> {
  const input = normalizeSupplierApplication({
    businessName: formData.get('businessName'),
    legalName: formData.get('legalName'),
    contactName: formData.get('contactName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    addressLine: formData.get('addressLine'),
    city: formData.get('city'),
    state: formData.get('state'),
    pincode: formData.get('pincode'),
    gstin: formData.get('gstin'),
    productCategories: formData.get('productCategories'),
    website: formData.get('website'),
  });

  if (input.website) return { ok: true }; // honeypot: silently accept-and-drop

  const errors = validateSupplierApplication(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const supabase = (await createClient());
  // N1: the rate-limit RPC is server-only (EXECUTE granted to
  // service_role only in migration 0060), so the limiter uses the
  // privileged server client. The public submission RPC below stays on
  // the ordinary anon-context client — the submission flow itself is
  // NOT moved to a privileged client. Bucket keys and limiter
  // parameters are still derived entirely server-side; nothing
  // caller-supplied can select keys, buckets, limits or windows.
  // F-1: construction goes through the factory wrapper so a throwing
  // privileged-client factory reaches the limiter's documented
  // fail-open fallback instead of aborting the submission.
  const limiter = createSupplierSubmissionLimiterFromFactory(createServiceRoleClient);
  const requestHeaders = await headers();
  const clientIdentity = clientIdentityFromHeaders((name) => requestHeaders.get(name));
  const limit = await limiter.consume(input.phone, clientIdentity);
  if (!limit.allowed) {
    // Generic on purpose: the message must not reveal whether this phone
    // or email has an application, is registered, or was rate-limited by
    // the phone bucket vs the client bucket.
    return {
      ok: false,
      errors: {},
      error: 'Too many submissions. Please wait a few minutes and try again.',
    };
  }

  const { error } = await supabase.rpc('submit_supplier_application' as never, {
    p_business_name: input.businessName,
    p_legal_name: input.legalName || null,
    p_contact_name: input.contactName,
    p_phone: input.phone,
    p_email: input.email || null,
    p_address_line: input.addressLine || null,
    p_city: input.city || null,
    p_state: input.state || null,
    p_pincode: input.pincode || null,
    p_gstin: input.gstin || null,
    p_product_categories: input.productCategories || null,
  } as never);

  if (error) {
    // Partial unique indexes (pending phone/email) surface as 23505.
    if ((error as { code?: string }).code === '23505') {
      return {
        ok: false,
        errors: { phone: 'An application with this phone number is already pending review.' },
      };
    }
    if ((error as { code?: string }).code === '23514') {
      return { ok: false, errors: {}, error: 'Some details failed validation. Please review the form and try again.' };
    }
    console.error('[suppliers] application submission failed:', error.message);
    return { ok: false, errors: {}, error: 'Your application could not be submitted right now. Please try again later.' };
  }

  return { ok: true };
}

export type ReviewResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Approve or reject a PENDING application. Admin + Super Admin
 * (`suppliers.review`, owner decision 2026-10-17), re-checked here on the
 * server; RLS (`suppliers_admin_update`, is_admin_or_above) is the second
 * boundary. The `.eq('status','pending')` guard makes double-review a
 * no-op error instead of silently overwriting the first decision; the
 * trg_audit_suppliers trigger records every transition.
 */
export async function reviewSupplierApplicationAction(
  supplierId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<ReviewResult> {
  const user = await requirePermission('suppliers.review');
  if (!UUID_RE.test(supplierId)) return { ok: false, error: 'Invalid application.' };
  const reason = (rejectionReason ?? '').trim().slice(0, 500);
  if (decision === 'rejected' && reason.length < 3) {
    return { ok: false, error: 'Give a short reason for rejection (the applicant may ask why).' };
  }

  const supabase = (await createClient());
  const { data, error } = await supabase
    .from('suppliers' as never)
    .update({
      status: decision,
      rejection_reason: decision === 'rejected' ? reason : null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq('id', supplierId)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'This application has already been reviewed.' };
  }

  revalidatePath('/admin/suppliers/applications');
  revalidatePath(`/admin/suppliers/applications/${supplierId}`);
  return { ok: true };
}

/**
 * Attach a document Maharani reviewers received offline. The file itself is
 * uploaded through the media pipeline (kind `supplier-document`, private
 * `supplier-documents` bucket, type/size verified server-side); this action
 * records its object path — never a public URL.
 */
export async function addSupplierDocumentAction(
  supplierId: string,
  docType: string,
  fileUrl: string,
  fileName: string
): Promise<ReviewResult> {
  const user = await requirePermission('suppliers.documents.manage');
  if (!UUID_RE.test(supplierId)) return { ok: false, error: 'Invalid application.' };
  if (!isSupplierDocType(docType)) return { ok: false, error: 'Choose a document type.' };
  if (!fileUrl.startsWith(`suppliers/${supplierId}/documents/`)) {
    return { ok: false, error: 'Uploaded file does not belong to this application.' };
  }
  const supabase = (await createClient());
  const { error } = await supabase.from('supplier_documents' as never).insert({
    supplier_id: supplierId,
    doc_type: docType,
    file_url: fileUrl,
    file_name: fileName.slice(0, 200),
    uploaded_by: user.id,
  } as never);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/suppliers/applications/${supplierId}`);
  return { ok: true };
}

