/**
 * Migration-number reservations — the ONE registry of numbers that are
 * deliberately absent from `supabase/migrations`, and the reason for each.
 *
 * Why a registry instead of a list of numbers pasted into each test:
 *   - the migration set must stay contiguous, because a number that is skipped
 *     by accident usually means a migration was lost in a merge or a rebase;
 *   - a few numbers ARE deliberately skipped, and each skip has a different
 *     life-cycle: some were never authored at all, one was authored on another
 *     branch/PR and arrives (or does not) with that merge.
 *
 * Two states, deliberately distinguished so nothing is hidden:
 *
 *   'never-authored'     — must stay absent for ever. If a file with that
 *                          prefix appears, the reservation is stale and the test
 *                          fails: it is not a licence to reuse the number.
 *   'authored-elsewhere' — implemented on another branch/PR. It may be present
 *                          or absent depending on merge order; both states are
 *                          correct, and the entry documents which work owns it.
 *
 * This is the only place where a skip is allowed. A gap that is not listed here
 * fails the suite (see `tests/migration-reservations.test.ts`).
 */

export type MigrationReservationState = 'never-authored' | 'authored-elsewhere';

export type MigrationReservation = {
  /** Four-digit prefix, exactly as used in the file name. */
  prefix: string;
  state: MigrationReservationState;
  /** Why the number is not in the repository. Reviewed with the migration set. */
  reason: string;
};

export const MIGRATION_RESERVATIONS: readonly MigrationReservation[] = [
  {
    prefix: '0061',
    state: 'never-authored',
    reason:
      'Never committed. Migrations 0062–0068 were applied to the live project under those ' +
      'identities, so renumbering them to fill the hole would corrupt migration history.',
  },
  {
    prefix: '0075',
    state: 'never-authored',
    reason: 'Data-retention archive, ON HOLD pending review (docs/readiness migration notes).',
  },
  {
    prefix: '0076',
    state: 'never-authored',
    reason:
      'Banner alt_text proposal, deliberately deferred; 0077 (banner draft artwork) skips over ' +
      'it rather than taking a number a reviewed, pending change was already designed against.',
  },
  {
    prefix: '0103',
    state: 'authored-elsewhere',
    reason:
      'Security-advisor remediation, authored on fix/supabase-security-advisor-0103 and merged ' +
      'to main as PR #127 (live migration version 20261115155706). Absent on branches cut ' +
      'before that merge; the website-content migrations start at 0104 and never collide with it.',
  },
];

export function reservedPrefixes(): Set<string> {
  return new Set(MIGRATION_RESERVATIONS.map((entry) => entry.prefix));
}

export type GapClassification = {
  /** Numbers missing from the set with NO reservation — always a failure. */
  undocumented: number[];
  /** 'never-authored' reservations that unexpectedly have a file — a failure. */
  presentDespiteReservation: string[];
  /** Reservations that are legitimately absent here. */
  absentButReserved: string[];
  /** Reservations that are present (only 'authored-elsewhere' may be). */
  presentAndReserved: string[];
};

/**
 * Compare the migration numbers on disk with the reservations.
 *
 * `numbers` may be unsorted. Only the covered span (lowest…highest) is checked,
 * so a set that ends early — a branch cut before a merge — reports nothing above
 * itself, and the suite on such a branch stays green for the right reason.
 */
export function classifyMigrationGaps(numbers: readonly number[]): GapClassification {
  const present = new Set(numbers);
  // Only the span the set actually covers: a branch cut before a merge ends
  // early and must not report everything above it as missing.
  const lowest = numbers.length > 0 ? Math.min(...numbers) : 1;
  const highest = numbers.length > 0 ? Math.max(...numbers) : 0;
  const reserved = reservedPrefixes();

  const gaps: number[] = [];
  for (let number = lowest; number <= highest; number += 1) {
    if (present.has(number)) continue;
    if (reserved.has(String(number).padStart(4, '0'))) continue;
    gaps.push(number);
  }

  const presentDespiteReservation: string[] = [];
  const absentButReserved: string[] = [];
  const presentAndReserved: string[] = [];
  for (const entry of MIGRATION_RESERVATIONS) {
    const number = Number(entry.prefix);
    if (!present.has(number)) {
      absentButReserved.push(entry.prefix);
      continue;
    }
    if (entry.state === 'never-authored') presentDespiteReservation.push(entry.prefix);
    else presentAndReserved.push(entry.prefix);
  }

  return { undocumented: gaps, presentDespiteReservation, absentButReserved, presentAndReserved };
}
