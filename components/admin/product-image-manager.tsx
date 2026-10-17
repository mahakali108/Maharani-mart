'use client';

import { useTransition, useState } from 'react';
import { Trash2, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import {
  addProductImageAction,
  removeProductImageAction,
  reorderProductImageAction,
  setProductImagePrimaryAction,
} from '@/lib/admin/products-actions';

interface ProductImage {
  id: string;
  image_url: string;
  sort_order: number;
}

export function ProductImageManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImage[];
}) {
  const [isPending, startTransition] = useTransition();
  const [localPreviews, setLocalPreviews] = useState<string[]>([]);

  // Show quick client previews while uploads are in flight (replaced by server images on revalidation)
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Product gallery — shown when a variant has no dedicated gallery. First image is the primary. Upload front,
        back, side, ingredients or any packaging angle.
      </p>

      {sorted.length === 0 ? (
        <p className="text-sm text-ink-500">No images uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((img, index) => (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-xl border border-ink-100 bg-white"
            >
              <div className="relative aspect-square">
                <StoredImage src={img.image_url} alt={`Product image ${index + 1}`} size="thumb" fill className="object-contain p-2" />
                {index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    Primary
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => removeProductImageAction(img.id, productId))}
                  className="absolute right-1.5 top-1.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
                  aria-label="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-ink-100 bg-ink-50/50 px-1.5 py-1.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => startTransition(() => reorderProductImageAction(productId, img.id, 'up'))}
                    className="rounded-lg bg-white p-1.5 text-ink-600 shadow-sm disabled:opacity-30 hover:bg-ink-100"
                    aria-label="Move image earlier"
                    title="Move earlier"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === sorted.length - 1}
                    onClick={() => startTransition(() => reorderProductImageAction(productId, img.id, 'down'))}
                    className="rounded-lg bg-white p-1.5 text-ink-600 shadow-sm disabled:opacity-30 hover:bg-ink-100"
                    aria-label="Move image later"
                    title="Move later"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isPending || index === 0}
                  onClick={() => startTransition(() => setProductImagePrimaryAction(productId, img.id))}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-ink-700 shadow-sm hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30"
                  aria-label="Set as primary image"
                  title="Set as primary"
                >
                  <Star className="h-3 w-3" /> Primary
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending local previews (optimistic while uploading) */}
      {localPreviews.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 opacity-60 sm:grid-cols-4">
          {localPreviews.map((src, i) => (
            <div key={`preview-${i}`} className="aspect-square overflow-hidden rounded-xl border border-dashed border-ink-200 bg-ink-50">
              {/* eslint-disable-next-line @next/next/no-img-element -- transient blob: upload preview; next/image cannot optimize object URLs */}
              <img src={src} alt="" className="h-full w-full object-contain p-2" />
            </div>
          ))}
        </div>
      ) : null}

      <MediaUploadField
        kind="product-gallery"
        ownerId={productId}
        multiple
        hasExisting={sorted.length > 0}
        label="Upload images"
        replaceLabel="Add more images"
        onUploaded={(media) => {
          // Preview URL cleanup: the MediaUploadField handles upload, we persist URL
          setLocalPreviews([]);
          return addProductImageAction(productId, media.ref, sorted.length);
        }}
        onPreviewUrls={setLocalPreviews}
      />
      <p className="text-[11px] text-ink-400">
        Images are stored in the product-images bucket (5 MB max each, PNG/JPEG/WebP). You can select several at once,
        reorder with the arrows, set any image as primary, or delete. Existing images are preserved until you remove them.
      </p>
    </div>
  );
}
