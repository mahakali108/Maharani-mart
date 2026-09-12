'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSchemeAction, updateSchemeAction, type SchemeActionResult } from '@/lib/admin/schemes-actions';

export interface SchemeInitial {
  id?: string;
  name: string;
  description: string;
  isFestival: boolean;
  startsAt: string;
  endsAt: string;
}

/**
 * Create or edit a scheme. `startsAt`/`endsAt` are datetime-local strings;
 * the server converts and validates them (end must be after start).
 */
export function SchemeForm({ initial }: { initial?: SchemeInitial }) {
  const isEdit = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isFestival, setIsFestival] = useState(initial?.isFestival ?? false);
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? '');
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? '');
  const [result, setResult] = useState<SchemeActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const payload = {
        name,
        description: description || undefined,
        isFestival,
        startsAt,
        endsAt,
      };
      const outcome = isEdit && initial?.id
        ? await updateSchemeAction(initial.id, payload)
        : await createSchemeAction(payload);
      setResult(outcome);
      if ('success' in outcome && !isEdit) {
        setName('');
        setDescription('');
        setIsFestival(false);
        setStartsAt('');
        setEndsAt('');
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {result && 'error' in result && result.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{result.error}</div>
      ) : null}
      {result && 'success' in result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {isEdit ? 'Scheme updated.' : 'Scheme created.'}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="scheme-name">Name</Label>
          <Input id="scheme-name" type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={isPending} required />
        </div>
        <div>
          <Label htmlFor="scheme-festival">Type</Label>
          <label className="flex h-10 items-center gap-2 text-sm text-ink-700">
            <input
              id="scheme-festival"
              type="checkbox"
              checked={isFestival}
              onChange={(e) => setIsFestival(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
            />
            Festival scheme
          </label>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="scheme-description">Description (optional)</Label>
          <Input
            id="scheme-description"
            type="text"
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="scheme-starts">Starts at</Label>
          <Input id="scheme-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={isPending} required />
        </div>
        <div>
          <Label htmlFor="scheme-ends">Ends at</Label>
          <Input id="scheme-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={isPending} required />
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isEdit ? 'Save changes' : 'Create scheme'}
      </Button>
    </form>
  );
}
