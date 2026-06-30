import { expect, test, describe } from 'vitest';
import { mergeProgressSnapshots } from './progressMigration';
import { normalizeStickerId, normalizeOwnedCount } from './stickerValidation';

describe('Sticker Validation', () => {
  test('normalizeStickerId', () => {
    expect(normalizeStickerId('BRA_1')).toBe('BRA_1');
    expect(normalizeStickerId('bra-1')).toBe('BRA_1');
    expect(normalizeStickerId(' BRA 1 ')).toBe('BRA_1');
    expect(normalizeStickerId('BRA_01')).toBe('BRA_1');
    expect(normalizeStickerId('INVALID_999')).toBe(null); // Assuming INVALID_999 is not in map
  });

  test('normalizeOwnedCount', () => {
    expect(normalizeOwnedCount(1)).toBe(1);
    expect(normalizeOwnedCount('2')).toBe(2);
    expect(normalizeOwnedCount(2.5)).toBe(2);
    expect(normalizeOwnedCount(-5)).toBe(0);
    expect(normalizeOwnedCount(NaN)).toBe(0);
    expect(normalizeOwnedCount(Infinity)).toBe(0);
    expect(normalizeOwnedCount(9999)).toBe(999);
  });
});

describe('Merge Progress Snapshots', () => {
  test('merge uses Math.max across all sources', () => {
    const firestore = { 'BRA_1': 1, 'BRA_2': 0, 'BRA_3': 3 };
    const localV2 = { 'BRA_1': 2, 'BRA_2': 1, 'BRA_3': 1 };
    const legacyOwned = { 'BRA_4': 1 };
    const legacyRepeated = { 'BRA_4': 2, 'BRA_5': 2 };

    const merged = mergeProgressSnapshots(firestore, localV2, legacyOwned, legacyRepeated);

    expect(merged['BRA_1']).toBe(2); // localV2 is higher
    expect(merged['BRA_2']).toBe(1); // localV2 is higher
    expect(merged['BRA_3']).toBe(3); // firestore is higher
    expect(merged['BRA_4']).toBe(2); // legacyRepeated is higher
    expect(merged['BRA_5']).toBe(2); // legacyRepeated
  });

  test('preserves count 2+', () => {
    const firestore = { 'BRA_1': 5 };
    const localV2 = { 'BRA_1': 1 };
    const merged = mergeProgressSnapshots(firestore, localV2, {}, {});
    expect(merged['BRA_1']).toBe(5);
  });

  test('handles empty inputs', () => {
    const merged = mergeProgressSnapshots({}, {}, {}, {});
    expect(Object.keys(merged).length).toBe(0);
  });

  test('ignores invalid IDs during merge', () => {
    const firestore = { 'INVALID_ID': 5, 'BRA_1': 1 };
    const merged = mergeProgressSnapshots(firestore, {}, {}, {});
    expect(merged['INVALID_ID']).toBeUndefined();
    expect(merged['BRA_1']).toBe(1);
  });
});
