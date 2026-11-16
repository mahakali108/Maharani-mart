import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIGRATION_RESERVATIONS,
  classifyMigrationGaps,
  reservedPrefixes,
} from './helpers/migration-reservations';

/**
 * The migration-gap rule itself.
 *
 * Two suites enforce it against the real directory
 * (`migration-catalog-invariants`, `retailer-enterprise-upgrade`). This file
 * proves the rule still DETECTS things: a gap nobody reserved must be reported,
 * and a "never authored" number that suddenly exists must be reported too. A
 * registry that silently accepted everything would be a suppression, not a test.
 */

const root = join(__dirname, '..');

describe('migration reservations', () => {
  it('is a reviewed registry: unique four-digit prefixes with a real reason', () => {
    const prefixes = MIGRATION_RESERVATIONS.map((entry) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const entry of MIGRATION_RESERVATIONS) {
      expect(entry.prefix, entry.prefix).toMatch(/^\d{4}$/);
      expect(entry.reason.length, entry.prefix).toBeGreaterThan(30);
      expect(['never-authored', 'authored-elsewhere']).toContain(entry.state);
    }
    expect(reservedPrefixes().size).toBe(prefixes.length);
  });

  it('reports a gap that nobody reserved', () => {
    // 0001, 0002, 0004 — 0003 is missing and is not in the registry.
    const gaps = classifyMigrationGaps([1, 2, 4]);
    expect(gaps.undocumented).toEqual([3]);
  });

  it('reports a reserved number that must never be authored', () => {
    // 0061 is 'never-authored'; a file with that prefix means the reservation is
    // stale or a number was reused. It must fail, not pass quietly. The sequence
    // below is complete apart from the registered skips.
    const allPresent = Array.from({ length: 104 }, (_, index) => index + 1);
    const gaps = classifyMigrationGaps(allPresent);
    expect(gaps.presentDespiteReservation).toEqual(['0061', '0075', '0076']);
  });

  it('accepts a reserved number that is authored on another branch, present or not', () => {
    const absent = classifyMigrationGaps([102, 104]);
    expect(absent.undocumented).toEqual([]);
    expect(absent.absentButReserved).toContain('0103');

    const present = classifyMigrationGaps([102, 103, 104]);
    expect(present.undocumented).toEqual([]);
    expect(present.presentAndReserved).toEqual(['0103']);
  });

  it('does not treat a branch cut before a merge as a gap', () => {
    // see also: the real branch, which ends at 0102 or 0103 depending on merges
    // Highest number wins: nothing after 0102 exists on a branch cut at 0102.
    const gaps = classifyMigrationGaps([101, 102]);
    expect(gaps.undocumented).toEqual([]);
  });

  it('agrees with the real directory', () => {
    const numbers = readdirSync(join(root, 'supabase/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .map((file) => Number(file.slice(0, 4)));
    const gaps = classifyMigrationGaps(numbers);
    expect(gaps.undocumented).toEqual([]);
    expect(gaps.presentDespiteReservation).toEqual([]);
  });
});
