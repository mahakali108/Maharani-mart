'use client';

import { useTransition } from 'react';
import { Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import { addProductImageAction, removeProductImageAction, reorderProductImageAction } from '@/lib/admin/products-actions';

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

  return (
    <div className="space-y-4">
      {images.length === 0 ? (
        <p className="text-sm text-ink-500">No images uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((img, index) => (
            <div key={img.id} className="group relative aspect-square overflow-hidden rounded-xl border border-ink-100">
              <StoredImage src={img.image_url} alt="" size="thumb" fill className="object-cover" />
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

      <MediaUploadField
        kind="product-gallery"
        ownerId={productId}
        onUploaded={(media) => addProductImageAction(productId, media.ref, images.length)}
      />
    </div>
  );
}
