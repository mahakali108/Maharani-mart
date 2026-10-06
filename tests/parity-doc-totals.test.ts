import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The parity document must agree with itself.
 *
 * WHY: these totals are often copied into release notes without re-counting.
 * Keep the published summary mechanically tied to the feature rows so a later
 * parity update cannot silently leave misleading counts behind.
 */
const DOC = join(process.cwd(), 'docs/NATIVE_PWA_FEATURE_PARITY.md');
const STATUSES = ['IMPLEMENTED', 'PARTIAL', 'MISSING', 'BLOCKED', 'N/A'] as const;
const ROW = /^\|\s*([A-Z]+-\d+)\s*\|/;

function doc(): string {
  return readFileSync(DOC, 'utf8');
}

/** Every feature row, keyed by its ID, with the status cell. */
function featureRows(): { id: string; status: string }[] {
  return doc()
    .split('\n')
    .filter((line) => ROW.test(line))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return { id: cells[1]!, status: cells[6]! };
    });
}

/** The summary table, keyed by status. */
function statedTotals(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of doc().split('\n')) {
    const match = /^\|\s*(?:\*\*)?([A-Z/]+)(?:\*\*)?\s*\|\s*(?:\*\*)?(\d+)(?:\*\*)?\s*\|$/.exec(line.trim());
    if (match && (STATUSES as readonly string[]).includes(match[1]!)) {
      totals.set(match[1]!, Number(match[2]));
    }
  }
  return totals;
}

describe('the parity document agrees with itself', () => {
  it('has a feature table to check', () => {
    expect(featureRows().length).toBeGreaterThan(50);
  });

  it('uses only the defined statuses', () => {
    const invalid = featureRows().filter(
      (row) => !(STATUSES as readonly string[]).includes(row.status),
    );
    expect(invalid).toEqual([]);
  });

  it('gives every row a unique id', () => {
    const ids = featureRows().map((row) => row.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('states the totals its own rows add up to', () => {
    const counted = new Map<string, number>();
    for (const row of featureRows()) {
      counted.set(row.status, (counted.get(row.status) ?? 0) + 1);
    }
    const stated = statedTotals();

    for (const status of STATUSES) {
      expect(
        stated.get(status) ?? 0,
        `summary says ${stated.get(status) ?? 0} ${status}, rows say ${counted.get(status) ?? 0}`,
      ).toBe(counted.get(status) ?? 0);
    }

    const totalLine = /\|\s*\*\*Total rows\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/.exec(doc());
    expect(totalLine, 'the summary must state a total row count').not.toBeNull();
    expect(Number(totalLine![1])).toBe(featureRows().length);
  });

  it('explains every BLOCKED row in the backend-work section', () => {
    const blocked = featureRows().filter((row) => row.status === 'BLOCKED');
    expect(blocked.length).toBeGreaterThan(0);

    const section = doc().slice(doc().indexOf('## What is BLOCKED'));
    const unexplained = blocked.map((row) => row.id).filter((id) => !section.includes(id));
    expect(unexplained).toEqual([]);
  });
});
