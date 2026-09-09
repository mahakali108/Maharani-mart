'use client';

import { useTransition } from 'react';
import { Trash2, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import {
  addPackImageAction,
  removePackImageAction,
  reorderPackImageAction,
  setPackImagePrimaryAction,
} from '@/lib/admin/products-actions';

export interface PackImage {
  id: string;
  image_url: string;
  sort_order: number;
}

export function ProductPackImageManager({
  productId,
  packId,
  packName,
  images,
}: {
  productId: string;
  packId: string;
  packName: string;
  images: PackImage[];
}) {
  const [isPending, startTransition] = useTransition();
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Variant gallery for <strong>{packName}</strong> — when set, the retailer sees this gallery when viewing this size.
        Falls back to the product gallery when empty. First image is the primary for thumbnails and legacy readers.
      </p>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-500">
          No variant images yet — the product gallery is used as fallback.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((img, index) => (
            <div key={img.id} className="group relative overflow-hidden rounded-xl border border-ink-100 bg-white">
              <div className="relative aspect-square">
                <StoredImage
                  src={img.image_url}
                  alt={`${packName} image ${index + 1}`}
                  size="thumb"
                  fill
                  className="object-contain p-2"
                />
                {index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    Primary
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => removePackImageAction(img.id, packId, productId))}
                  className="absolute right-1.5 top-1.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
                  aria-label="Remove variant image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-ink-100 bg-ink-50/50 px-1.5 py-1.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => startTransition(() => reorderPackImageAction(productId, packId, img.id, 'up'))}
                    className="rounded-lg bg-white p-1.5 text-ink-600 shadow-sm disabled:opacity-30 hover:bg-ink-100"
                    aria-label="Move image earlier"
                    title="Move earlier"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === sorted.length - 1}
                    onClick={() => startTransition(() => reorderPackImageAction(productId, packId, img.id, 'down'))}
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
                  onClick={() => startTransition(() => setPackImagePrimaryAction(packId, productId, img.id))}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-ink-700 shadow-sm hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30"
                  aria-label="Set as primary variant image"
                  title="Set as primary"
                >
                  <Star className="h-3 w-3" /> Primary
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MediaUploadField
        kind="product-gallery"
        ownerId={productId}
        multiple
        hasExisting={sorted.length > 0}
        label={`Upload images for ${packName}`}
        replaceLabel="Add more variant images"
        onUploaded={(media) => addPackImageAction(packId, productId, media.ref, sorted.length)}
      />
      <p className="text-[11px] text-ink-400">
        Images use the existing product-images bucket (PNG/JPEG/WebP, 5 MB each). Select several at once, reorder, set primary, or delete. Existing images are kept until removed. The legacy single image_url stays in sync for older readers.
      </p>
    </div>
  );
}
