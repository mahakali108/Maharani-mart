'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { Trash2, Upload, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { uploadFile, buildPath } from '@/lib/storage/upload';
import { addProductImageAction, removeProductImageAction, reorderProductImageAction } from '@/lib/admin/products-actions';

interface ProductImage {
  id: string;
  image_url: string;
  sort_order: number;
}

export function ProductImageManager({
  productId,
  skuCode,
  images,
}: {
  productId: string;
  skuCode: string;
  images: ProductImage[];
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const path = buildPath(skuCode, file);
      const { publicUrl } = await uploadFile('product-images', file, path);
      if (!publicUrl) throw new Error('Upload succeeded but no public URL was returned.');
      await addProductImageAction(productId, publicUrl, images.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      {images.length === 0 ? (
        <p className="text-sm text-ink-500">No images uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((img, index) => (
            <div key={img.id} className="group relative aspect-square overflow-hidden rounded-xl border border-ink-100">
              <Image src={img.image_url} alt="" fill className="object-cover" unoptimized />
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(() => removeProductImageAction(img.id, productId))}
                className="absolute right-1.5 top-1.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
                aria-label="Remove image"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  disabled={isPending || index === 0}
                  onClick={() => startTransition(() => reorderProductImageAction(productId, img.id, 'up'))}
                  className="rounded-lg bg-black/60 p-1.5 text-white disabled:opacity-30"
                  aria-label="Move image earlier"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={isPending || index === images.length - 1}
                  onClick={() => startTransition(() => reorderProductImageAction(productId, img.id, 'down'))}
                  className="rounded-lg bg-black/60 p-1.5 text-white disabled:opacity-30"
                  aria-label="Move image later"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isUploading ? 'Uploading…' : 'Upload image'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </label>
    </div>
  );
}
