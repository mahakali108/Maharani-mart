import { UUID_RE, type StorageKind } from '@/lib/storage/types';

const SAFE_FILENAME = /[^a-zA-Z0-9._-]/g;

export function assertStableId(id: string, label = 'id'): string {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid ${label}.`);
  }
  return id;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base.replace(SAFE_FILENAME, '-').replace(/-+/g, '-').replace(/^\.+/, '');
  return cleaned.slice(0, 80) || 'file';
}

export function extensionForMime(mime: string, fallbackName: string): string {
  const fromName = fallbackName.includes('.') ? fallbackName.split('.').pop()?.toLowerCase() : undefined;
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'application/pdf':
      return 'pdf';
    default:
      return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : 'bin';
  }
}

function uniqueName(originalName: string, mime: string): string {
  const ext = extensionForMime(mime, originalName);
  const stem = sanitizeFilename(originalName.replace(/\.[^.]+$/, '')).slice(0, 40);
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : String(Date.now());
  return `${Date.now()}-${rand}-${stem}.${ext}`;
}

/**
 * Builds a Firebase object path from a stable owner id — never from a
 * user-controlled folder name (SKU, shop name, etc.).
 */
export function buildObjectPath(
  kind: StorageKind,
  ownerId: string,
  originalName: string,
  mime: string,
  variant: 'main' | 'gallery' = 'main'
): string {
  const id = assertStableId(ownerId, 'storage owner id');
  const filename = uniqueName(originalName, mime);

  switch (kind) {
    case 'product':
      return variant === 'gallery' ? `products/${id}/gallery/${filename}` : `products/${id}/${filename}`;
    case 'brand':
      return `brands/${id}/${filename}`;
    case 'category':
      return `categories/${id}/${filename}`;
    case 'banner':
      return `banners/${id}/${filename}`;
    case 'retailer_profile':
      return `retailers/${id}/profile/${filename}`;
    case 'retailer_document':
      return `retailers/${id}/documents/${filename}`;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown storage kind: ${_exhaustive}`);
    }
  }
}

export function ownerPrefix(kind: StorageKind, ownerId: string): string {
  const id = assertStableId(ownerId, 'storage owner id');
  switch (kind) {
    case 'product':
      return `products/${id}/`;
    case 'brand':
      return `brands/${id}/`;
    case 'category':
      return `categories/${id}/`;
    case 'banner':
      return `banners/${id}/`;
    case 'retailer_profile':
      return `retailers/${id}/profile/`;
    case 'retailer_document':
      return `retailers/${id}/documents/`;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown storage kind: ${_exhaustive}`);
    }
  }
}

export function assertPathOwned(path: string, kind: StorageKind, ownerId: string): string {
  const normalized = normalizeObjectPath(path);
  const prefix = ownerPrefix(kind, ownerId);
  if (!normalized.startsWith(prefix)) {
    throw new Error('Storage path is outside the allowed folder.');
  }
  return normalized;
}

export function normalizeObjectPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new Error('Invalid storage path.');
  }
  return trimmed;
}
