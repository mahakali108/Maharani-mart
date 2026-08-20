/**
 * Shared media types. Pure — safe to import from Server Components,
 * Server Actions, Route Handlers and Client Components alike.
 * Nothing in here reads a secret.
 */

/**
 * The logical buckets/folders the application understands. The browser
 * never chooses an Appwrite bucket or file id directly — it names one of
 * these kinds, and the server derives bucket + owner + file id from it.
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
  /** Maximum accepted upload size, in bytes. */
  maxBytes: number;
  /** Accepted MIME types (verified against sniffed magic bytes, not the browser's claim). */
  mimeTypes: readonly string[];
  /** Private media is never publicly readable and is streamed through an authorised route handler. */
  private: boolean;
  /** Longest edge we downscale to before upload (client-side, best effort). `null` = leave alone. */
  maxEdge: number | null;
  /** Hard server-side ceiling on image dimensions; anything larger is rejected. */
  maxDimension: number;
  /** Logical folder prefix recorded with the file (Appwrite storage itself is flat). */
  folder: (ownerId: string | null) => string;
}

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export const MEDIA_KIND_CONFIG: Record<MediaKind, MediaKindConfig> = {
  'product-gallery': {
    label: 'Product image',
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 1600,
    maxDimension: 10000,
    folder: (ownerId) => `products/${ownerId ?? '_draft'}/gallery`,
  },
  'brand-logo': {
    label: 'Brand logo',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 800,
    maxDimension: 10000,
    folder: (ownerId) => `brands/${ownerId ?? '_draft'}`,
  },
  'category-image': {
    label: 'Category image',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 800,
    maxDimension: 10000,
    folder: (ownerId) => `categories/${ownerId ?? '_draft'}`,
  },
  banner: {
    label: 'Banner',
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 2000,
    maxDimension: 10000,
    folder: (ownerId) => `banners/${ownerId ?? '_draft'}`,
  },
  'retailer-avatar': {
    label: 'Profile photo',
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_MIME,
    private: false,
    maxEdge: 512,
    maxDimension: 10000,
    folder: (ownerId) => `retailers/${ownerId ?? '_draft'}/profile`,
  },
  'retailer-document': {
    label: 'Document',
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: DOC_MIME,
    private: true,
    // KYC paperwork must stay legible — never downscaled.
    maxEdge: null,
    maxDimension: 20000,
    folder: (ownerId) => `retailers/${ownerId ?? '_draft'}/documents`,
  },
};

/** Parsed form of a stored `appwrite://<bucketId>/<fileId>` reference. */
export interface AppwriteMediaRef {
  provider: 'appwrite';
  bucketId: string;
  fileId: string;
}

/** A legacy value: either a full Supabase Storage public URL, or a bare object path. */
export interface LegacyMediaRef {
  provider: 'legacy';
  /** The raw column value, rendered/served exactly as it always was. */
  value: string;
}

export type MediaRef = AppwriteMediaRef | LegacyMediaRef;

export interface UploadedMedia {
  /** Stable value to persist in the existing Supabase column. */
  ref: string;
  /** Appwrite file id (also embedded in `ref`). */
  fileId: string;
  /** Appwrite bucket id (also embedded in `ref`). */
  bucketId: string;
  /** Logical path recorded for auditing/migration, e.g. `products/<uuid>/gallery/<fileId>`. */
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
