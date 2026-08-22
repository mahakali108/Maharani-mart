/**
 * Shared media types. Pure — safe to import from Server Components,
 * Server Actions, Route Handlers and Client Components alike.
 * Nothing in here reads a secret.
 */

/**
 * The logical upload kinds the application understands. The browser never
 * chooses a bucket or an object path directly — it names one of these kinds,
 * and the server derives the bucket, the path and the permission check from
 * it. All files are stored in Supabase Storage.
 */
export const MEDIA_KINDS = [
  'product-gallery',
  'brand-logo',
  'category-image',
  'banner',
  'retailer-avatar',
  'retailer-document',
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export interface MediaKindConfig {
  /** Human label used in error messages. */
  label: string;
  /** Supabase Storage bucket name. Never caller-supplied. */
  bucket: string;
  /** Maximum accepted upload size, in bytes. */
  maxBytes: number;
  /** Accepted MIME types (verified against sniffed magic bytes, not the browser's claim). */
  mimeTypes: readonly string[];
  /** Private media is never publicly readable and is served via a signed URL. */
  private: boolean;
  /** Longest edge we downscale to before upload (client-side, best effort). `null` = leave alone. */
  maxEdge: number | null;
  /** Hard server-side ceiling on image dimensions; anything larger is rejected. */
  maxDimension: number;
  /** Logical folder prefix within the bucket, derived from the owning entity id. */
  folder: (ownerId: string | null) => string;
}

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/**
 * Maps each logical kind to its Supabase bucket and the object-path layout.
 *
 * Object paths (within the bucket) follow:
 *
 *   product-gallery  → products/{productId}/gallery/{uuid}.{ext}
 *   brand-logo       → brands/{brandId}/{uuid}.{ext}
 *   category-image   → categories/{categoryId}/{uuid}.{ext}
 *   banner           → banners/{bannerId}/{uuid}.{ext}     (`_draft` before the row exists)
 *   retailer-avatar  → avatars/{userId}/{uuid}.{ext}
 *   retailer-document→ retailers/{retailerId}/documents/{uuid}.{ext}
 *
 * The bucket ids themselves are unchanged from the original schema
 * (supabase/migrations/0003 + 0006), plus `category-images` added in 0016.
 */
export const MEDIA_KIND_CONFIG: Record<MediaKind, MediaKindConfig> = {
  'product-gallery': {
    label: 'Product image',
    bucket: 'product-images',
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 1600,
    maxDimension: 10000,
    folder: (ownerId) => `products/${ownerId ?? '_draft'}/gallery`,
  },
  'brand-logo': {
    label: 'Brand logo',
    bucket: 'brand-logos',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 800,
    maxDimension: 10000,
    folder: (ownerId) => `brands/${ownerId ?? '_draft'}`,
  },
  'category-image': {
    label: 'Category image',
    bucket: 'category-images',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 800,
    maxDimension: 10000,
    folder: (ownerId) => `categories/${ownerId ?? '_draft'}`,
  },
  banner: {
    label: 'Banner',
    bucket: 'banners',
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 2000,
    maxDimension: 10000,
    folder: (ownerId) => `banners/${ownerId ?? '_draft'}`,
  },
  'retailer-avatar': {
    label: 'Profile photo',
    bucket: 'avatars',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 512,
    maxDimension: 10000,
    folder: (ownerId) => `avatars/${ownerId ?? '_draft'}`,
  },
  'retailer-document': {
    label: 'Document',
    bucket: 'retailer-documents',
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: DOC_MIME,
    private: true,
    // KYC paperwork must stay legible — never downscaled.
    maxEdge: null,
    maxDimension: 20000,
    folder: (ownerId) => `retailers/${ownerId ?? '_draft'}/documents`,
  },
};

/** Parsed form of a stored column value (see lib/media/refs.ts). */
export interface UploadedMedia {
  /**
   * Stable value to persist in the existing Supabase column:
   * the public URL for public buckets, the object path for private buckets.
   */
  ref: string;
  /** Supabase Storage bucket name. */
  bucket: string;
  /** Object path within the bucket, e.g. `products/<id>/gallery/<uuid>.webp`. */
  path: string;
  /** Publicly renderable URL, or `null` for private media. */
  url: string | null;
  /** Sanitised original filename. */
  fileName: string;
  /** Verified MIME type (sniffed, not browser-supplied). */
  mimeType: string;
  /** Byte size actually stored. */
  size: number;
}

export type UploadMediaResult =
  | ({ ok: true } & UploadedMedia)
  | { ok: false; error: string };
