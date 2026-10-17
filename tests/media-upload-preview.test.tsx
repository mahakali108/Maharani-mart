/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * OPTIMISTIC UPLOAD PREVIEWS — regression for a verified dead-code defect.
 *
 * `ProductImageManager` rendered a "Pending local previews" grid driven by a
 * `localPreviews` state that was NEVER populated: `setLocalPreviews` was only
 * ever called with `[]`, so the optimistic preview UI could never appear while
 * an upload was in flight (and the raw <img> tripped @next/next/no-img-element).
 *
 * The fix adds an optional `onPreviewUrls` callback to `MediaUploadField`:
 *   - picked files are surfaced immediately as blob: object URLs,
 *   - the URLs are revoked and cleared (`[]`) once the batch settles,
 *   - `ProductImageManager` wires the callback into `setLocalPreviews`, so the
 *     pending-preview grid actually renders during uploads.
 *
 * These tests pin all three behaviours so the wiring cannot silently rot again.
 */

const uploadMediaAction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/media/actions', () => ({ uploadMediaAction }));
vi.mock('@/lib/media/optimize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/media/optimize')>();
  return {
    ...actual,
    optimizeImageForUpload: async (_kind: string, file: File) => file,
  };
});

const addProductImageAction = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock('@/lib/admin/products-actions', () => ({
  addProductImageAction,
  removeProductImageAction: vi.fn(),
  reorderProductImageAction: vi.fn(),
  setProductImagePrimaryAction: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    React.createElement('img', { src, alt, className }),
}));

import { MediaUploadField } from '@/components/media/media-upload-field';
import { ProductImageManager } from '@/components/admin/product-image-manager';

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
let createdUrls: string[];
let revokedUrls: string[];

function makeFile(name: string): File {
  return new File(['x'.repeat(16)], name, { type: 'image/png' });
}

/** Resolves only when the test releases it, so previews can be observed in flight. */
function deferredUpload() {
  let release!: (value: unknown) => void;
  const gate = new Promise((resolve) => { release = resolve; });
  uploadMediaAction.mockImplementation(async () => {
    await gate;
    return {
      ok: true,
      ref: 'media-ref-1',
      bucket: 'product-images',
      path: 'p/1.png',
      url: 'https://x.supabase.co/storage/v1/object/public/product-images/p/1.png',
      fileName: '1.png',
      mimeType: 'image/png',
      size: 16,
    };
  });
  return () => release(undefined);
}

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:preview-${createdUrls.length + 1}`;
    createdUrls.push(url);
    void blob;
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  }) as unknown as typeof URL.revokeObjectURL;
  uploadMediaAction.mockReset();
  addProductImageAction.mockClear();
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

describe('MediaUploadField optimistic previews', () => {
  it('emits blob preview URLs on pick, then clears and revokes them after the batch settles', async () => {
    const release = deferredUpload();
    const onPreviewUrls = vi.fn();
    const onUploaded = vi.fn();

    render(
      <MediaUploadField
        kind="product-gallery"
        ownerId="product-1"
        multiple
        onUploaded={onUploaded}
        onPreviewUrls={onPreviewUrls}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('front.png'), makeFile('back.png')] } });

    // Previews appear immediately, while uploads are still in flight.
    await waitFor(() => expect(onPreviewUrls).toHaveBeenCalledWith(['blob:preview-1', 'blob:preview-2']));
    expect(onUploaded).not.toHaveBeenCalled();

    release();

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onPreviewUrls).toHaveBeenLastCalledWith([]));
    expect(revokedUrls).toEqual(['blob:preview-1', 'blob:preview-2']);
    expect(uploadMediaAction).toHaveBeenCalledTimes(2);
  });

  it('clears and revokes previews even when the upload fails', async () => {
    uploadMediaAction.mockRejectedValue(new Error('network down'));
    const onPreviewUrls = vi.fn();
    const onUploaded = vi.fn();

    render(
      <MediaUploadField
        kind="product-gallery"
        ownerId="product-1"
        onUploaded={onUploaded}
        onPreviewUrls={onPreviewUrls}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('front.png')] } });

    await waitFor(() => expect(onPreviewUrls).toHaveBeenLastCalledWith([]));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(revokedUrls).toEqual(['blob:preview-1']);
    expect(screen.getByText('network down')).toBeTruthy();
  });

  it('does not create object URLs when no preview callback is provided', async () => {
    uploadMediaAction.mockResolvedValue({
      ok: true, ref: 'r', bucket: 'b', path: 'p', url: 'u', fileName: 'f', mimeType: 'image/png', size: 1,
    });
    const onUploaded = vi.fn();

    render(<MediaUploadField kind="product-gallery" ownerId="product-1" onUploaded={onUploaded} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('front.png')] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(createdUrls).toEqual([]);
  });
});

describe('ProductImageManager preview wiring (dead-code regression)', () => {
  it('renders the pending preview grid while an upload is in flight and persists on completion', async () => {
    const release = deferredUpload();

    render(<ProductImageManager productId="product-1" images={[]} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('front.png')] } });

    // The optimistic grid must actually appear mid-upload — this is what the
    // dead `localPreviews` state could never do before the fix.
    const preview = await screen.findByAltText('');
    expect(preview.getAttribute('src')).toBe('blob:preview-1');

    release();

    await waitFor(() => expect(addProductImageAction).toHaveBeenCalledWith('product-1', 'media-ref-1', 0));
    await waitFor(() => expect(screen.queryByAltText('')).toBeNull());
  });
});
