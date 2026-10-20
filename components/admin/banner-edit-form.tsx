'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { BANNER_STANDARD, MOBILE_BANNER_STANDARD } from '@/lib/retailer/banner-target';
import { BannerPreview } from '@/components/admin/banner-preview';
import { toBannerDateTimeLocal } from '@/lib/retailer/banner-target';
import { updateBannerAction, type BannerFormState } from '@/lib/admin/banners-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: BannerFormState = null;

interface Option {
  id: string;
  name: string;
}

export function BannerEditForm({
  bannerId,
  title,
  imageUrl: initialImageUrl,
  imageUrlMobile: initialImageMobileUrl,
  status: initialStatus,
  linkUrl,
  subtitle,
  ctaLabel,
  areaId,
  sortOrder,
  startsAt,
  endsAt,
  areas,
}: {
  bannerId: string;
  title: string;
  imageUrl: string;
  imageUrlMobile: string | null;
  status: 'draft' | 'published';
  linkUrl: string | null;
  subtitle?: string | null;
  ctaLabel?: string | null;
  areaId: string | null;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  areas: Option[];
}) {
  const boundAction = updateBannerAction.bind(null, bannerId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const [imageRef, setImageRef] = useState(initialImageUrl);
  const [imageMobileRef, setImageMobileRef] = useState(initialImageMobileUrl ?? '');
  const [titleValue, setTitleValue] = useState(title);
  const [subtitleValue, setSubtitleValue] = useState(subtitle ?? '');
  const [ctaValue, setCtaValue] = useState(ctaLabel ?? '');
  const [linkValue, setLinkValue] = useState(linkUrl ?? '');
  const [startsAtValue, setStartsAtValue] = useState(toBannerDateTimeLocal(startsAt, 'start'));
  const [endsAtValue, setEndsAtValue] = useState(toBannerDateTimeLocal(endsAt, 'end'));

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="imageUrl" value={imageRef} />
      <input type="hidden" name="imageUrlMobile" value={imageMobileRef} />

      <div>
        <Label>Desktop banner image</Label>
        {/* Artwork standard: the carousel reserves a 3:1 box and crops to fit. */}
        <p className="mb-2 text-[11px] leading-4 text-ink-400">
          Recommended {`${BANNER_STANDARD.width} × ${BANNER_STANDARD.height} px`} (3:1). The image is cropped to 3:1 on larger screens — never stretched.
        </p>
        <MediaUploadField
          kind="banner"
          ownerId={bannerId}
          hasExisting
          onUploaded={(media) => setImageRef(media.ref)}
        />
      </div>

      <div>
        <Label>Mobile banner image (optional)</Label>
        <p className="mb-2 text-[11px] leading-4 text-ink-400">
          Recommended {`${MOBILE_BANNER_STANDARD.width} × ${MOBILE_BANNER_STANDARD.height} px`} (4:3). Shown below 768 px. Leave empty to reuse the desktop artwork.
        </p>
        <MediaUploadField
          kind="banner"
          ownerId={bannerId}
          hasExisting={imageMobileRef !== ''}
          onUploaded={(media) => setImageMobileRef(media.ref)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" value={titleValue} onChange={(event) => setTitleValue(event.target.value)} maxLength={140} required />
        </div>
        <div>
          <Label htmlFor="subtitle">Subtitle (optional)</Label>
          <Input id="subtitle" name="subtitle" value={subtitleValue} onChange={(event) => setSubtitleValue(event.target.value)} maxLength={300} />
        </div>
        <div>
          <Label htmlFor="ctaLabel">Button label (optional)</Label>
          <Input id="ctaLabel" name="ctaLabel" value={ctaValue} onChange={(event) => setCtaValue(event.target.value)} maxLength={60} />
        </div>
        <div>
          <Label htmlFor="linkUrl">Target route or URL (optional)</Label>
          <Input id="linkUrl" name="linkUrl" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="/retailer/catalog or https://…" />
        </div>
        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" defaultValue={areaId ?? ''}>
            <option value="">— All areas —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Visibility</Label>
          <Select id="status" name="status" defaultValue={initialStatus}>
            <option value="draft">Draft — hidden from retailers</option>
            <option value="published">Published</option>
          </Select>
          <p className="mt-1 text-[11px] leading-4 text-ink-400">
            Drafts stay editable and are never shown on the storefront, even while active.
          </p>
        </div>
        <div>
          <Label htmlFor="sortOrder">Priority (lower number displays first)</Label>
          <Input id="sortOrder" name="sortOrder" type="number" min={0} max={1000000} step={1} defaultValue={sortOrder} required />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="startsAt">Starts at (IST)</Label>
            <Input id="startsAt" name="startsAt" type="datetime-local" step={60} value={startsAtValue} onChange={(event) => setStartsAtValue(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="endsAt">Ends at (IST)</Label>
            <Input id="endsAt" name="endsAt" type="datetime-local" step={60} value={endsAtValue} onChange={(event) => setEndsAtValue(event.target.value)} />
          </div>
        </div>
      </div>

      <BannerPreview
        title={titleValue}
        subtitle={subtitleValue}
        ctaLabel={ctaValue}
        imageUrl={imageRef}
        imageUrlMobile={imageMobileRef}
        linkUrl={linkValue}
      />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
