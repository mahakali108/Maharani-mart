'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Layers,
  Loader2,
  Package,
  Plus,
  Trash2,
} from 'lucide-react';
import { savePackPricingAction, type LooseTierFormRow } from '@/lib/admin/products-actions';
import {
  calculateCaseLoosePrice,
  findLooseCoverageGaps,
  inclusiveMaxQuantity,
  looseTierDraftToRow,
  maxLooseQuantity,
  piecePriceFromCase,
  suggestedQuantities,
  validateLooseTierSet,
  type LooseTierDraft,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Admin editor for ONE pack's complete pricing configuration.
 *
 *   units per case  →  how many pieces make a full case
 *   case price      →  GST-inclusive price of a full case (source of truth)
 *   loose tiers     →  min qty | max qty | ₹/pc for a remainder below a case
 *
 * The rule it configures — and the only rule the storefront uses — is: full
 * cases are ALWAYS billed at the case price, and the leftover pieces are billed
 * at the tier that covers the REMAINDER count. So this screen never asks for a
 * per-piece case rate, and it never lets a loose slab reach a full case (that
 * would silently reprice cases).
 *
 * Validation and the live preview both call `lib/retailer/case-pricing`
 * directly — the same module the retailer cart and the server-side quote use —
 * so what the admin previews is by construction what the retailer is billed.
 * The server action re-runs the identical checks; nothing here is trusted.
 */

/** A stored pricing row of this pack (any rule type). */
export interface PackPricingTier {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: 'default' | 'case' | 'bulk' | 'loose';
  label: string | null;
}

/** Draft row in the editor — quantities in pieces, range inclusive. */
interface TierDraftRow {
  key: string;
  id: string | null;
  minQty: string;
  maxQty: string;
  price: string;
  label: string;
}

function money(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function draftFromTier(tier: PackPricingTier, unitsPerCase: number): TierDraftRow {
  const max = inclusiveMaxQuantity(tier.max_quantity, unitsPerCase);
  return {
    key: tier.id,
    id: tier.id,
    minQty: String(tier.min_quantity),
    maxQty: max > tier.min_quantity ? String(max) : '',
    price: String(tier.price_per_piece),
    label: tier.label ?? 'Loose pieces',
  };
}

function emptyDraft(index: number): TierDraftRow {
  return { key: `new-${index}-${Date.now()}`, id: null, minQty: '', maxQty: '', price: '', label: 'Loose pieces' };
}

export function PackCasePricing({
  packId,
  productId,
  packName,
  unitsPerCase,
  casePrice,
  mrp,
  moq,
  allowLoosePieces,
  gstPercent,
  tiers,
}: {
  packId: string;
  productId: string;
  packName: string;
  unitsPerCase: number;
  casePrice: number;
  mrp: number | null;
  moq: number;
  allowLoosePieces: boolean;
  gstPercent: number;
  tiers: PackPricingTier[];
}) {
  const [units, setUnits] = useState(String(unitsPerCase));
  const [price, setPrice] = useState(String(casePrice));
  const [mrpValue, setMrpValue] = useState(String(mrp ?? casePrice));
  const [moqValue, setMoqValue] = useState(String(moq));
  const [looseAllowed, setLooseAllowed] = useState(allowLoosePieces);
  const [acknowledgeGaps, setAcknowledgeGaps] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'notice'; text: string } | null>(null);

  const unitsNumber = Number.parseInt(units, 10);
  const safeUnits = Number.isFinite(unitsNumber) && unitsNumber >= 1 ? unitsNumber : 1;
  const ceiling = maxLooseQuantity(safeUnits);

  const [drafts, setDrafts] = useState<TierDraftRow[]>(() => {
    const editable = tiers
      .filter((tier) => tier.rule_type === 'loose' || (tier.rule_type !== 'case' && tier.min_quantity < safeUnits))
      .sort((a, b) => a.min_quantity - b.min_quantity)
      .map((tier) => draftFromTier(tier, safeUnits));
    return editable;
  });
  const [previewQty, setPreviewQty] = useState(String(Math.max(moq, 1)));

  // Legacy slabs are never silently dropped: the two lists below tell the admin
  // exactly what saving will deactivate (anything overlapping loose territory)
  // and what simply stops mattering (bulk slabs at or above a full case, which
  // the case price always wins).
  const legacyOverlapping = tiers.filter(
    (tier) => tier.rule_type !== 'loose' && tier.rule_type !== 'case' && tier.min_quantity <= ceiling
  );
  const legacyInert = tiers.filter(
    (tier) => tier.rule_type !== 'loose' && tier.rule_type !== 'case' && tier.min_quantity > ceiling
  );

  function toFormRows(): LooseTierFormRow[] {
    return converted.map((entry, index) => ({
      id: drafts[index]?.id ?? null,
      minQty: entry.draft.minQty,
      maxQty: entry.draft.maxQty,
      pricePerPiece: entry.draft.pricePerPiece,
      label: (drafts[index]?.label ?? '').trim() || null,
    }));
  }

  const converted = draftsToRows(drafts, safeUnits);

  /** Validated drafts, or the messages that explain why they are not. */
  const validationErrors = validateLooseTierSet(
    converted.map((entry) => entry.draft),
    safeUnits
  );

  // Preview tiers come from the drafts the admin is looking at, converted with
  // the SAME helper the server uses, so the preview reflects unsaved work.
  const previewTiers: PricingTier[] = validationErrors.length === 0 ? converted.map((entry) => entry.row) : [];
  const gaps = validationErrors.length === 0 ? findLooseCoverageGaps(previewTiers, safeUnits) : [];
  const canSave =
    !isPending &&
    Number.isFinite(unitsNumber) &&
    unitsNumber >= 1 &&
    Number.parseFloat(price) > 0 &&
    validationErrors.length === 0 &&
    (looseAllowed || drafts.length === 0) &&
    (gaps.length === 0 || drafts.length === 0 || acknowledgeGaps);

  function updateDraft(key: string, patch: Partial<TierDraftRow>) {
    setFeedback(null);
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  function moveDraft(index: number, direction: -1 | 1) {
    setDrafts((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const moved = next[index]!;
      next[index] = next[target]!;
      next[target] = moved;
      return next;
    });
  }

  function handleSubmit() {
    if (!canSave) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await savePackPricingAction({
        packId,
        productId,
        packName,
        unitsPerCase: unitsNumber,
        casePrice: Number.parseFloat(price),
        mrp: Number.parseFloat(mrpValue) || 0,
        moq: Math.max(1, Number.parseInt(moqValue, 10) || 1),
        allowLoosePieces: looseAllowed,
        acknowledgeGaps,
        tiers: toFormRows(),
      });
      if (result && 'error' in result && result.error) {
        setFeedback({ tone: 'error', text: result.error });
      } else if (result && 'notice' in result && result.notice) {
        setFeedback({ tone: 'notice', text: result.notice });
      } else {
        setFeedback({ tone: 'notice', text: 'Pricing saved. Retailers see the new case and loose rates immediately.' });
      }
    });
  }

  const previewPricing = calculateCaseLoosePrice({
    quantity: Number.parseInt(previewQty, 10) || 0,
    unitsPerCase: safeUnits,
    casePrice: Number.parseFloat(price) || 0,
    tiers: previewTiers.length > 0 ? previewTiers : tiers,
    gstPercent,
    moq: Math.max(1, Number.parseInt(moqValue, 10) || 1),
    allowLoosePieces: looseAllowed,
  });
  const quickQuantities = suggestedQuantities({
    unitsPerCase: safeUnits,
    moq: Math.max(1, Number.parseInt(moqValue, 10) || 1),
    tiers: previewTiers.length > 0 ? previewTiers : tiers,
    allowLoosePieces: looseAllowed,
  });

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-primary-200 bg-primary-50/40 p-3">
      {/* ------------------------------------------------------------------ */}
      {/* Case configuration                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary-700">
          <Package className="h-3.5 w-3.5" aria-hidden="true" /> Case &amp; loose piece pricing
        </p>
        <span className="text-[9px] text-ink-400">
          GST {Number.isFinite(gstPercent) ? gstPercent : 0}% included in every price — never added later
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Label htmlFor={`units-${packId}`}>Pcs per case</Label>
          <Input
            id={`units-${packId}`}
            type="number"
            min={1}
            step={1}
            value={units}
            disabled={isPending}
            onChange={(event) => setUnits(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`case-price-${packId}`}>Case price ₹ (incl. GST)</Label>
          <Input
            id={`case-price-${packId}`}
            type="number"
            min={0}
            step="0.01"
            value={price}
            disabled={isPending}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`mrp-${packId}`}>MRP ₹ / piece</Label>
          <Input
            id={`mrp-${packId}`}
            type="number"
            min={0}
            step="0.01"
            value={mrpValue}
            disabled={isPending}
            onChange={(event) => setMrpValue(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`moq-${packId}`}>MOQ (pcs)</Label>
          <Input
            id={`moq-${packId}`}
            type="number"
            min={1}
            step={1}
            value={moqValue}
            disabled={isPending}
            onChange={(event) => setMoqValue(event.target.value)}
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-xs text-ink-600">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-primary-600"
          checked={looseAllowed}
          disabled={isPending}
          onChange={(event) => setLooseAllowed(event.target.checked)}
        />
        <span>
          <strong className="font-semibold text-ink-800">Allow loose pieces.</strong> When on, a retailer can order
          any quantity — only the complete cases use the case price and the remainder uses the loose tiers below. When
          off, this pack is sold in full cases of {safeUnits} pcs only.
        </span>
      </label>

      <p className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px] text-ink-500">
        Derived per-piece rate inside a case: <strong className="text-ink-800">{money(piecePriceFromCase(Number.parseFloat(price) || 0, safeUnits))}</strong>{' '}
        — display only; a case is always billed at {money(Number.parseFloat(price) || 0)}, and loose pieces are never
        billed at the case price.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Loose tier editor                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-2 rounded-lg border border-ink-100 bg-white p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-500">
            <Layers className="h-3 w-3" aria-hidden="true" /> Loose piece tiers (1–{ceiling} pcs)
          </p>
          <button
            type="button"
            disabled={isPending || ceiling < 1 || !looseAllowed}
            onClick={() => setDrafts((current) => [...current, emptyDraft(current.length)])}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-ink-200 px-2 text-[10px] font-semibold text-ink-600 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add tier
          </button>
        </div>

        {ceiling < 1 ? (
          <p className="text-[11px] text-ink-500">
            A pack of 1 pc per case has no loose remainder to price — every order is a full case.
          </p>
        ) : drafts.length === 0 ? (
          <p className="text-[11px] text-ink-500">
            No loose tiers: remainders are priced at the derived case rate ({money(piecePriceFromCase(Number.parseFloat(price) || 0, safeUnits))}/pc).
            Add a tier to give small quantities their own rate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-ink-100 text-left text-[9px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Min pcs</th>
                  <th className="px-2 py-1.5 font-medium">Max pcs</th>
                  <th className="px-2 py-1.5 font-medium">₹ / pc</th>
                  <th className="px-2 py-1.5 font-medium">Label</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {drafts.map((draft, index) => (
                  <tr key={draft.key}>
                    <td className="px-1.5 py-1">
                      <Input
                        aria-label={`Minimum pieces for loose tier ${index + 1} of ${packName}`}
                        type="number"
                        min={1}
                        max={ceiling}
                        step={1}
                        value={draft.minQty}
                        disabled={isPending || !looseAllowed}
                        onChange={(event) => updateDraft(draft.key, { minQty: event.target.value })}
                        className="h-8 w-20"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input
                        aria-label={`Maximum pieces for loose tier ${index + 1} of ${packName}`}
                        type="number"
                        min={1}
                        max={ceiling}
                        step={1}
                        value={draft.maxQty}
                        placeholder={String(ceiling)}
                        disabled={isPending || !looseAllowed}
                        onChange={(event) => updateDraft(draft.key, { maxQty: event.target.value })}
                        className="h-8 w-20"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input
                        aria-label={`Price per piece for loose tier ${index + 1} of ${packName}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.price}
                        disabled={isPending || !looseAllowed}
                        onChange={(event) => updateDraft(draft.key, { price: event.target.value })}
                        className="h-8 w-24"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input
                        aria-label={`Label for loose tier ${index + 1} of ${packName}`}
                        value={draft.label}
                        disabled={isPending}
                        onChange={(event) => updateDraft(draft.key, { label: event.target.value })}
                        className="h-8 w-full min-w-24"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          disabled={isPending || index === 0}
                          onClick={() => moveDraft(index, -1)}
                          aria-label={`Move loose tier ${index + 1} up`}
                          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isPending || index === drafts.length - 1}
                          onClick={() => moveDraft(index, 1)}
                          aria-label={`Move loose tier ${index + 1} down`}
                          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setDrafts((current) => current.filter((row) => row.key !== draft.key))}
                          aria-label={`Remove loose tier ${index + 1} of ${packName}`}
                          className="rounded p-1 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {validationErrors.length > 0 ? (
          <ul role="alert" className="space-y-0.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-2 text-[11px] font-medium text-primary-700">
            {validationErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}

        {gaps.length > 0 && drafts.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Nothing prices{' '}
                {gaps.map((gap, i) => `${i > 0 ? ', ' : ''}${gap.min}${gap.max > gap.min ? `–${gap.max}` : ''} pc${gap.max > gap.min ? 's' : ''}`).join(', ')}{' '}
                of {packName}. Retailers ordering those loose quantities will be blocked at checkout rather than
                silently repriced.
              </span>
            </p>
            <label className="mt-1.5 flex items-start gap-1.5 font-semibold">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 accent-amber-600"
                checked={acknowledgeGaps}
                onChange={(event) => setAcknowledgeGaps(event.target.checked)}
              />
              Save anyway with these gaps explicit
            </label>
          </div>
        ) : null}

        {legacyOverlapping.length > 0 ? (
          <p className="text-[10px] text-ink-500">
            Overlapping legacy rule(s) on this pack:{' '}
            {legacyOverlapping.map((row) => `${row.label ?? row.rule_type} (from ${row.min_quantity} pcs)`).join(', ')}.
            Saving deactivates them so the loose tiers above own 1–{ceiling} pcs; orders already placed keep their
            stored prices.
          </p>
        ) : null}
        {legacyInert.length > 0 ? (
          <p className="text-[10px] text-ink-400">
            {legacyInert.map((row) => `${row.label ?? row.rule_type} (from ${row.min_quantity} pcs)`).join(', ')}{' '}
            no longer changes any price — a full case is always billed at the case price, and a remainder is always
            below {safeUnits} pcs.
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Preview — the production pricing function, nothing else             */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-ink-100 bg-white p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Preview (same function as checkout)</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {quickQuantities.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreviewQty(String(value))}
              className={`h-7 rounded-lg border px-2 text-[10px] font-bold transition ${
                previewQty === String(value)
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-primary-300'
              }`}
            >
              {value % safeUnits === 0 && value >= safeUnits
                ? `${value / safeUnits} Case${value / safeUnits === 1 ? '' : 's'}`
                : `${value} pcs`}
            </button>
          ))}
          <Input
            aria-label={`Preview quantity in pieces for ${packName}`}
            type="number"
            min={1}
            step={1}
            value={previewQty}
            onChange={(event) => setPreviewQty(event.target.value)}
            className="h-7 w-24 text-[11px]"
          />
        </div>
        <ul className="mt-2 space-y-1 text-[11px]">
          {previewPricing.fullCases > 0 ? (
            <li className="flex items-baseline justify-between gap-2 text-ink-600">
              <span>
                {previewPricing.fullCases} Case{previewPricing.fullCases === 1 ? '' : 's'} × {money(previewPricing.casePrice)}
              </span>
              <span>{money(previewPricing.caseSubtotal)}</span>
            </li>
          ) : null}
          {previewPricing.looseQuantity > 0 && previewPricing.looseUnitPrice !== null ? (
            <li className="flex items-baseline justify-between gap-2 text-ink-600">
              <span>
                {previewPricing.looseQuantity} loose pcs × {money(previewPricing.looseUnitPrice)}
                <span className="ml-1 text-[9px] text-ink-400">
                  ({previewPricing.loosePriceSource === 'tier' ? 'loose tier' : 'derived from case price'})
                </span>
              </span>
              <span>{money(previewPricing.looseSubtotal)}</span>
            </li>
          ) : null}
          <li className="flex items-baseline justify-between gap-2 border-t border-ink-100 pt-1 text-xs font-bold text-ink-900">
            <span>
              Total incl. GST · Cases: {previewPricing.fullCases} · Loose: {previewPricing.looseQuantity}
            </span>
            <span>{money(previewPricing.total)}</span>
          </li>
          <li className="text-[9px] text-ink-400">
            GST component already inside it: {money(previewPricing.gst)} (net {money(previewPricing.subtotal)})
          </li>
          {!previewPricing.orderable ? (
            <li className="font-semibold text-primary-700" role="alert">
              {previewPricing.message}
            </li>
          ) : null}
        </ul>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Save                                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {feedback ? (
          <p
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`flex-1 rounded-lg border px-2.5 py-2 text-[11px] font-medium ${
              feedback.tone === 'error'
                ? 'border-primary-200 bg-primary-50 text-primary-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {feedback.text}
          </p>
        ) : (
          <p className="flex-1 text-[10px] text-ink-400">
            Saving writes the pack fields and this exact set of loose tiers. Cases are always priced by the case
            price; the tier list may never reach a full case.
          </p>
        )}
        <div className="flex items-center gap-2">
          {!canSave && validationErrors.length === 0 && !isPending ? (
            <span className="text-[10px] font-semibold text-amber-700">
              {gaps.length > 0 && drafts.length > 0 && !acknowledgeGaps
                ? 'Acknowledge the uncovered quantities to save'
                : 'Complete the loose tiers (min, max and ₹/pc) to save'}
            </span>
          ) : null}
          <Button
            type="button"
            disabled={!canSave}
            onClick={handleSubmit}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 text-xs font-bold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {isPending ? 'Saving…' : 'Save pricing'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The editor's inclusive drafts, converted to stored-shaped rows with the
 * engine's own `looseTierDraftToRow` — the identical call the server action
 * makes. The preview, the gap warning and the saved rows therefore describe the
 * same configuration; there is no second implementation of the conversion here.
 */
function draftsToRows(drafts: TierDraftRow[], unitsPerCase: number): { draft: LooseTierDraft; row: PricingTier }[] {
  return drafts.map((draft) => {
    const parsed: LooseTierDraft = {
      minQty: Number.parseInt(draft.minQty, 10),
      maxQty: Number.parseInt(draft.maxQty, 10),
      pricePerPiece: Number.parseFloat(draft.price),
    };
    if (!Number.isFinite(parsed.maxQty)) parsed.maxQty = null;
    return { draft: parsed, row: { ...looseTierDraftToRow(parsed, unitsPerCase), id: draft.id ?? undefined, label: draft.label || 'Loose pieces', is_active: true, rule_type: 'loose' as const } };
  });
}
