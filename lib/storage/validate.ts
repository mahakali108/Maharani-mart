import { STORAGE_PROFILES, type StorageKind } from '@/lib/storage/types';

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ValidatedFile {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  width?: number;
  height?: number;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((value, index) => bytes[index] === value);
}

export function sniffMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'application/pdf';
  }

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256)).trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

export function readImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && bytes.length >= 24) {
      return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1] ?? 0;
        const size = readUInt16BE(bytes, offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.length) {
          return { height: readUInt16BE(bytes, offset + 5), width: readUInt16BE(bytes, offset + 7) };
        }
        offset += 2 + size;
      }
    }
    if (mime === 'image/webp' && bytes.length >= 30) {
      const fourcc = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
      if (fourcc === 'VP8X') {
        return {
          width: 1 + (readUInt32LE(bytes, 24) & 0xffffff),
          height: 1 + (readUInt32LE(bytes, 27) & 0xffffff),
        };
      }
      if (fourcc === 'VP8 ' && bytes.length >= 30) {
        return {
          width: readUInt16BE(bytes, 26) & 0x3fff,
          height: readUInt16BE(bytes, 28) & 0x3fff,
        };
      }
      if (fourcc === 'VP8L' && bytes.length >= 25) {
        const bits = readUInt32LE(bytes, 21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

const MIME_TO_EXT: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
  'application/pdf': ['pdf'],
};

export function validateStoredFile(
  kind: StorageKind,
  bytes: Uint8Array,
  declaredName: string,
  declaredType?: string
): ValidatedFile {
  const profile = STORAGE_PROFILES[kind];
  if (bytes.byteLength === 0) {
    throw new Error('The file is empty.');
  }
  if (bytes.byteLength > profile.maxBytes) {
    const mb = Math.round(profile.maxBytes / (1024 * 1024));
    throw new Error(`File is too large. Maximum size is ${mb} MB.`);
  }

  const mime = sniffMime(bytes);
  if (!mime || !profile.allowedMimes.includes(mime)) {
    throw new Error('This file type is not allowed.');
  }

  if (declaredType && declaredType !== mime && !(declaredType === 'image/jpg' && mime === 'image/jpeg')) {
    // Browser MIME is advisory only — sniffed bytes win. Reject only obviously hostile mismatches
    // such as a PDF declared as an image when this kind does not allow PDFs.
    if (declaredType === 'application/pdf' && mime !== 'application/pdf') {
      throw new Error('File contents do not match the declared type.');
    }
  }

  const ext = (declaredName.split('.').pop() ?? '').toLowerCase();
  const allowedExt = MIME_TO_EXT[mime] ?? [];
  if (ext && allowedExt.length > 0 && !allowedExt.includes(ext)) {
    throw new Error('File extension does not match the file contents.');
  }

  const dimensions = mime.startsWith('image/') && mime !== 'image/svg+xml' ? readImageDimensions(bytes, mime) : null;
  if (dimensions) {
    const maxEdge = Math.max(profile.maxWidth, profile.maxHeight) * 2;
    if (dimensions.width > maxEdge || dimensions.height > maxEdge) {
      throw new Error(`Image dimensions are too large (${dimensions.width}×${dimensions.height}).`);
    }
    if (dimensions.width < 1 || dimensions.height < 1) {
      throw new Error('Image dimensions are invalid.');
    }
  }

  return {
    bytes,
    mime,
    extension: allowedExt[0] ?? ext ?? 'bin',
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

export async function fileToBytes(file: File | Blob): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}
