import 'server-only';

/**
 * Server-side file validation.
 *
 * The browser's `File.type` is attacker-controlled and is NEVER trusted here.
 * Every accepted MIME type is confirmed by sniffing the file's magic bytes,
 * and image dimensions are parsed straight out of the container headers so a
 * decompression-bomb can be rejected before anything reaches Appwrite.
 */

import { fileExtension, sanitizeFileName } from './paths';
import { MEDIA_KIND_CONFIG, type MediaKind } from './types';

export interface ValidatedFile {
  bytes: Buffer;
  /** MIME type proven by magic bytes — this is what gets sent to Appwrite. */
  mimeType: string;
  fileName: string;
  size: number;
  width: number | null;
  height: number | null;
}

export type ValidationResult =
  | { ok: true; file: ValidatedFile }
  | { ok: false; error: string };

const ALLOWED_EXTENSIONS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

/** Detect the real content type from the leading bytes of the file. */
export function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // PDF: "%PDF-"
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';

  return null;
}

/** Parse intrinsic pixel dimensions without decoding the image. */
export function readImageDimensions(
  bytes: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png') return readPngSize(bytes);
    if (mimeType === 'image/jpeg') return readJpegSize(bytes);
    if (mimeType === 'image/webp') return readWebpSize(bytes);
  } catch {
    return null;
  }
  return null;
}

function readPngSize(bytes: Buffer): { width: number; height: number } | null {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR", w, h
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2; // skip SOI
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = bytes.readUInt16BE(offset + 2);

    // SOF0..SOF15, excluding DHT (C4), JPGA (C8) and DAC (CC)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }

    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function readWebpSize(bytes: Buffer): { width: number; height: number } | null {
  const format = bytes.toString('ascii', 12, 16);

  if (format === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes.readUIntLE(24, 3) & 0xffffff);
    const height = 1 + (bytes.readUIntLE(27, 3) & 0xffffff);
    return { width, height };
  }

  if (format === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }

  if (format === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  return null;
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(0)} MB`
    : `${Math.ceil(value / 1024)} KB`;
}

/**
 * Full validation pipeline for one upload.
 *
 * Order matters: size is checked before the buffer is materialised where
 * possible, then content sniffing, then extension agreement, then dimensions.
 */
export async function validateUpload(kind: MediaKind, file: File): Promise<ValidationResult> {
  const config = MEDIA_KIND_CONFIG[kind];

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'No file was received.' };
  }

  if (file.size > config.maxBytes) {
    return {
      ok: false,
      error: `${config.label} must be ${formatBytes(config.maxBytes)} or smaller (received ${formatBytes(file.size)}).`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Guard against a lying Content-Length / streamed body.
  if (bytes.length > config.maxBytes) {
    return {
      ok: false,
      error: `${config.label} must be ${formatBytes(config.maxBytes)} or smaller.`,
    };
  }

  const sniffed = sniffMimeType(bytes);
  if (!sniffed) {
    return { ok: false, error: 'Unrecognised file format. Upload a JPG, PNG, WebP or PDF.' };
  }

  if (!config.mimeTypes.includes(sniffed)) {
    const allowed = config.mimeTypes.map((m) => m.split('/')[1]?.toUpperCase()).join(', ');
    return { ok: false, error: `${config.label} must be one of: ${allowed}.` };
  }

  const fileName = sanitizeFileName(file.name);
  const extension = fileExtension(fileName);
  const expected = ALLOWED_EXTENSIONS[sniffed] ?? [];
  if (extension !== '' && !expected.includes(extension)) {
    return {
      ok: false,
      error: `File extension ".${extension}" does not match the actual file contents (${sniffed}).`,
    };
  }

  let width: number | null = null;
  let height: number | null = null;

  if (sniffed !== 'application/pdf') {
    const dimensions = readImageDimensions(bytes, sniffed);
    if (!dimensions) {
      return { ok: false, error: 'Could not read the image dimensions — the file may be corrupt.' };
    }
    if (dimensions.width < 1 || dimensions.height < 1) {
      return { ok: false, error: 'Image has invalid dimensions.' };
    }
    if (dimensions.width > config.maxDimension || dimensions.height > config.maxDimension) {
      return {
        ok: false,
        error: `Image is too large (${dimensions.width}×${dimensions.height}px). Maximum is ${config.maxDimension}px on each side.`,
      };
    }
    width = dimensions.width;
    height = dimensions.height;
  }

  return {
    ok: true,
    file: { bytes, mimeType: sniffed, fileName, size: bytes.length, width, height },
  };
}
