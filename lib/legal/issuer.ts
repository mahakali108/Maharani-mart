import { BRAND, LEGAL_ISSUER_LINE } from '@/lib/brand';

/**
 * THE LEGAL ISSUER, AND WHAT IS STILL MISSING.
 *
 * Owner-approved: Ajay General (proprietorship) is the legal seller and invoice
 * issuer, trading under the Maharani Traders brand. That much is settled and is
 * stated in the customer-facing copy.
 *
 * What is NOT settled is the registered detail: the GSTIN and the registered
 * address have not been supplied. This module makes that gap explicit and
 * machine-checkable instead of letting a plausible-looking placeholder leak into
 * a tax document.
 *
 * A placeholder is never a value. `pending` entries are rendered as an
 * instruction, and `statutoryBlockIsComplete()` returns false so a caller can
 * refuse to publish rather than print a guess.
 */

/**
 * Just the slice of `process.env` this module reads. Deliberately structural
 * rather than `NodeJS.ProcessEnv` so a caller (or a test) can pass a minimal
 * object without fabricating NODE_ENV and the rest.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** A value the owner must supply. `value` stays null until they do. */
export interface OwnerSuppliedFact {
  readonly key: string;
  /** What the reader sees when the value is missing. Deliberately not a fake. */
  readonly placeholder: string;
  readonly value: string | null;
}

/**
 * Values the owner has confirmed. `COMPANY_*` environment variables are read at
 * call time so a deployment can supply them without a code change — but a blank
 * or obvious placeholder is treated as absent, not as a value.
 */
function configured(environment: EnvLike, key: string): string | null {
  const raw = environment[key]?.trim() ?? '';
  if (!raw) return null;
  // Refuse the configuration prompts that used to live in .env.local.example.
  if (/^(?:configure|tbd|todo|n\/?a|owner input required|placeholder)\b/i.test(raw)) return null;
  return raw;
}

export interface LegalIssuer {
  readonly legalName: string;
  readonly legalForm: string;
  readonly tradingStyle: string;
  /** "Ajay General (proprietorship), trading as Maharani Traders" */
  readonly issuerLine: string;
  readonly gstin: OwnerSuppliedFact;
  readonly registeredAddress: OwnerSuppliedFact;
  readonly supportPhone: OwnerSuppliedFact;
  readonly grievanceOfficer: OwnerSuppliedFact;
}

export function getLegalIssuer(environment: EnvLike = process.env): LegalIssuer {
  return {
    legalName: BRAND.legalName,
    legalForm: BRAND.legalForm,
    tradingStyle: BRAND.tradingStyle,
    issuerLine: LEGAL_ISSUER_LINE,
    gstin: {
      key: 'COMPANY_GSTIN',
      placeholder: 'GSTIN to be supplied by the owner before publication',
      value: configured(environment, 'COMPANY_GSTIN'),
    },
    registeredAddress: {
      key: 'COMPANY_ADDRESS',
      placeholder: 'Registered address to be supplied by the owner before publication',
      value: configured(environment, 'COMPANY_ADDRESS'),
    },
    supportPhone: {
      key: 'COMPANY_PHONE',
      placeholder: 'Support phone to be supplied by the owner before publication',
      value: configured(environment, 'COMPANY_PHONE'),
    },
    grievanceOfficer: {
      key: 'COMPANY_GRIEVANCE_OFFICER',
      placeholder: 'Grievance officer to be supplied by the owner before publication',
      value: configured(environment, 'COMPANY_GRIEVANCE_OFFICER'),
    },
  };
}

/** True only when every owner-supplied statutory fact is actually present. */
export function statutoryBlockIsComplete(issuer: LegalIssuer = getLegalIssuer()): boolean {
  return Boolean(
    issuer.gstin.value &&
      issuer.registeredAddress.value &&
      issuer.supportPhone.value &&
      issuer.grievanceOfficer.value,
  );
}

/**
 * The statutory block as label/value pairs, using an explicit placeholder for
 * anything still missing. A caller that needs a complete block must check
 * `statutoryBlockIsComplete()` first; this function will happily tell the reader
 * what is missing rather than invent it.
 */
export function statutoryBlock(issuer: LegalIssuer = getLegalIssuer()): { label: string; value: string }[] {
  const render = (fact: OwnerSuppliedFact) => fact.value ?? fact.placeholder;
  return [
    { label: 'Legal seller and invoice issuer', value: issuer.issuerLine },
    { label: 'Brand', value: BRAND.name },
    { label: 'GSTIN', value: render(issuer.gstin) },
    { label: 'Registered address', value: render(issuer.registeredAddress) },
    { label: 'Support phone', value: render(issuer.supportPhone) },
    { label: 'Grievance officer', value: render(issuer.grievanceOfficer) },
  ];
}
