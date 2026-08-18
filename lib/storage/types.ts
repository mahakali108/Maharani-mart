/**
 * Storage kinds used by the Firebase-backed file layer.
 * Metadata (which product/brand/banner a file belongs to) stays in Supabase.
 */
export type StorageKind = 'product' | 'brand' | 'category' | 'banner' | 'retailer_profile' | 'retailer_document';

export type StorageVisibility = 'public' | 'private';

export interface StorageObjectRef {
  /** Firebase Storage object path, e.g. products/{id}/gallery/…. */
  path: string;
  kind: StorageKind;
  visibility: StorageVisibility;
}

export interface StorageUploadResult {
  path: string;
  /** Usable public URL for public objects. Null for private objects. */
  url: string | null;
}

export interface ImageOptimizeProfile {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  maxBytes: number;
  allowedMimes: readonly string[];
  allowSvg?: boolean;
  allowPdf?: boolean;
}

export const STORAGE_PROFILES: Record<StorageKind, ImageOptimizeProfile> = {
  product: {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8,
    maxBytes: 5 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  brand: {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.82,
    maxBytes: 2 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    allowSvg: true,
  },
  category: {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.82,
    maxBytes: 2 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  banner: {
    maxWidth: 2400,
    maxHeight: 1200,
    quality: 0.85,
    maxBytes: 5 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  retailer_profile: {
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.8,
    maxBytes: 2 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  retailer_document: {
    maxWidth: 2000,
    maxHeight: 2000,
    quality: 0.82,
    maxBytes: 10 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    allowPdf: true,
  },
};

export const FIREBASE_PATH_PREFIXES = ['products/', 'brands/', 'categories/', 'banners/', 'retailers/'] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
