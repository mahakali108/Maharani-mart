import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Shared server-side contract for the private `compliance-evidence` bucket.
 * Upload actions must validate a file with this module before calling Storage
 * and must register the returned canonical key in the matching evidence table.
 * The database migration independently verifies the key/MIME binding, so a
 * browser payload or a future route cannot make metadata point at a public key.
 */
export const COMPLIANCE_EVIDENCE_BUCKET_ID = 'compliance-evidence' as const;
export const COMPLIANCE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
/** A fixed five-minute reviewer/owner URL; callers cannot extend it. */
export const COMPLIANCE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 300;

export const COMPLIANCE_EVIDENCE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type ComplianceEvidenceContentType = (typeof COMPLIANCE_EVIDENCE_CONTENT_TYPES)[number];
export type ProductEvidenceType =
  | 'label_photo'
  | 'supplier_invoice'
  | 'source_authorization'
  | 'manufacturing_licence'
  | 'import_registration'
  | 'country_of_origin'
  | 'product_source_evidence';
export type SellerEvidenceType =
  | 'business_identity'
  | 'business_address'
  | 'business_contact'
  | 'gst_registration'
  | 'seller_agreement'
  | 'settlement_verification'
  | 'compliance_declaration'
  | 'product_source_evidence'
  | 'cosmetics_authorization';

type UploadInput = {
  fileName: string;
  contentType: string;
  byteLength: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extensionFor(contentType: ComplianceEvidenceContentType): 'png' | 'jpg' | 'webp' | 'pdf' {
  switch (contentType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'application/pdf': return 'pdf';
  }
}

function requireUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID.`);
  return value.toLowerCase();
}

/** Reject malformed metadata before bytes are sent to Storage. */
export function validateComplianceEvidenceUpload(input: UploadInput): ComplianceEvidenceContentType {
  const contentType = input.contentType.trim().toLowerCase();
  if (!COMPLIANCE_EVIDENCE_CONTENT_TYPES.includes(contentType as ComplianceEvidenceContentType)) {
    throw new Error('Compliance evidence must be a PNG, JPEG, WebP image, or PDF.');
  }
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > COMPLIANCE_EVIDENCE_MAX_BYTES) {
    throw new Error('Compliance evidence file size is outside the approved private-bucket limit.');
  }
  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 255 || /[\u0000-\u001f\\\/]/.test(fileName)) {
    throw new Error('Compliance evidence file name is invalid.');
  }
  return contentType as ComplianceEvidenceContentType;
}

/**
 * Preferred server-action entrypoint: derive metadata from the received file,
 * rather than trusting a separately supplied browser-declared byte length.
 */
export function validateComplianceEvidenceFile(file: { name: string; type: string; size: number }): ComplianceEvidenceContentType {
  return validateComplianceEvidenceUpload({
    fileName: file.name,
    contentType: file.type,
    byteLength: file.size,
  });
}

/**
 * Generates the only accepted object-key layouts. The random object id is
 * intentionally opaque: user file names, PAN/GST values, business names, and
 * reviewer data must never be embedded in a Storage path.
 */
export function buildProductEvidenceObjectKey(input: {
  productId: string;
  evidenceType: ProductEvidenceType;
  objectId: string;
  contentType: ComplianceEvidenceContentType;
  sellerId?: string | null;
}): string {
  const productId = requireUuid(input.productId, 'Product id');
  const objectId = requireUuid(input.objectId, 'Evidence object id');
  const extension = extensionFor(input.contentType);
  if (input.sellerId) {
    const sellerId = requireUuid(input.sellerId, 'Seller id');
    return `products/${productId}/sellers/${sellerId}/${input.evidenceType}/${objectId}.${extension}`;
  }
  return `products/${productId}/central/${input.evidenceType}/${objectId}.${extension}`;
}

export function buildSellerEvidenceObjectKey(input: {
  sellerId: string;
  evidenceType: SellerEvidenceType;
  objectId: string;
  contentType: ComplianceEvidenceContentType;
}): string {
  const sellerId = requireUuid(input.sellerId, 'Seller id');
  const objectId = requireUuid(input.objectId, 'Evidence object id');
  return `sellers/${sellerId}/${input.evidenceType}/${objectId}.${extensionFor(input.contentType)}`;
}

/**
 * Server-action upload primitive. It validates the received file, asks the
 * caller-scoped database policy for write authorization, and uploads only to
 * the dedicated private bucket without upsert/replace capability. A caller
 * must still insert matching evidence metadata in the same application flow;
 * the database evidence trigger independently rejects a mismatched key/MIME.
 */
export async function uploadComplianceEvidenceObject(
  input: { objectKey: string; file: Blob & { name?: string; type: string; size: number } },
  client?: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  client ??= await createClient();
  const contentType = validateComplianceEvidenceFile({
    name: input.file.name ?? 'evidence',
    type: input.file.type,
    size: input.file.size,
  });
  const { data: permitted, error: permissionError } = await client.rpc(
    'can_write_compliance_evidence_object' as never,
    { p_name: input.objectKey } as never
  );
  if (permissionError || permitted !== true) {
    throw new Error('You are not authorized to upload evidence at that private object path.');
  }
  const { error } = await client.storage
    .from(COMPLIANCE_EVIDENCE_BUCKET_ID)
    .upload(input.objectKey, input.file, { contentType, upsert: false });
  if (error) throw new Error('Private evidence upload could not be completed.');
}

/**
 * Mint a short-lived URL only after the caller's JWT has passed the same
 * database authorization predicate used by the Storage SELECT policy. This
 * intentionally uses the caller-scoped client, never a public URL or a
 * service-role URL minting shortcut.
 */
export async function createComplianceEvidenceSignedUrl(
  objectKey: string,
  client?: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  client ??= await createClient();
  const { data: permitted, error: permissionError } = await client.rpc(
    'can_read_compliance_evidence_object' as never,
    { p_name: objectKey } as never
  );
  if (permissionError || permitted !== true) return null;

  const { data, error } = await client.storage
    .from(COMPLIANCE_EVIDENCE_BUCKET_ID)
    .createSignedUrl(objectKey, COMPLIANCE_EVIDENCE_SIGNED_URL_TTL_SECONDS);
  return error || !data ? null : data.signedUrl;
}
