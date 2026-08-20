/**
 * Deterministic, server-owned file naming.
 *
 * The browser never supplies a path, a folder, an owner id, or a file id.
 * It supplies a `MediaKind` plus (optionally) an entity id which the server
 * re-validates against the caller's role before anything is written.
 */

import { randomUUID } from 'node:crypto';

import { MEDIA_KIND_CONFIG, type MediaKind } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Appwrite file ids: max 36 chars, `a-z A-Z 0-9 . - _`, cannot start with a
 * special char. A bare UUID v4 satisfies all of that.
 */
export function newFileId(): string {
  return randomUUID();
}

/** Strip anything that could be used for traversal, header injection or shell tricks. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 120);
  return cleaned === '' ? 'file' : cleaned;
}

export function fileExtension(name: string): string {
  const cleaned = sanitizeFileName(name);
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0 || dot === cleaned.length - 1) return '';
  return cleaned.slice(dot + 1).toLowerCase();
}

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Logical path stored alongside the file for auditing and migration, e.g.
 * `products/6f1d…/gallery/9c2b…webp`. Appwrite storage is flat, so this is
 * metadata rather than a real directory — but it keeps parity with the
 * Supabase layout and makes the migration script verifiable.
 */
export function buildMediaPath(
  kind: MediaKind,
  ownerId: string | null,
  fileId: string,
  mimeType: string,
): string {
  const folder = MEDIA_KIND_CONFIG[kind].folder(ownerId);
  const ext = EXTENSION_BY_MIME[mimeType] ?? 'bin';
  return `${folder}/${fileId}.${ext}`;
}
