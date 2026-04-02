import { reservoirSampling, calculateSampleSize } from '../../src/utils/reservoirSampling.js';

describe('reservoirSampling', () => {
  test('returns all items when sampleSize >= items.length', () => {
    const items = [1, 2, 3];
    expect(reservoirSampling(items, 5)).toEqual([1, 2, 3]);
    expect(reservoirSampling(items, 3)).toEqual([1, 2, 3]);
  });

  test('returns empty array when sampleSize is 0', () => {
    expect(reservoirSampling([1, 2, 3], 0)).toEqual([]);
  });

  test('returns empty array when sampleSize is negative', () => {
    expect(reservoirSampling([1, 2, 3], -1)).toEqual([]);
  });

  test('returns the requested number of items', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = reservoirSampling(items, 10);
    expect(result).toHaveLength(10);
  });

  test('S14: never returns duplicates across many runs', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    for (let run = 0; run < 50; run++) {
      const result = reservoirSampling(items, 20);
      const uniqueSet = new Set(result);
      expect(uniqueSet.size).toBe(result.length);
    }
  });

  test('all returned items exist in the original array', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const result = reservoirSampling(items, 5);
    for (const item of result) {
      expect(items).toContain(item);
    }
  });

  test('works with ObjectId-like strings (realistic usage)', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    const result = reservoirSampling(ids, 10);
    expect(result).toHaveLength(10);
    const unique = new Set(result);
    expect(unique.size).toBe(10);
  });
});

describe('calculateSampleSize', () => {
  test('S1: 10% of 100 = 10', () => {
    expect(calculateSampleSize(100, 10)).toBe(10);
  });

  test('rounds up fractional results (ceil)', () => {
    // 10% of 3 = 0.3 → ceil → 1
    expect(calculateSampleSize(3, 10)).toBe(1);
    // 10% of 11 = 1.1 → ceil → 2
    expect(calculateSampleSize(11, 10)).toBe(2);
  });

  test('never returns more than total', () => {
    expect(calculateSampleSize(5, 100)).toBe(5);
  });

  test('always returns at least 1 for positive inputs', () => {
    expect(calculateSampleSize(1, 1)).toBe(1);
    // 1% of 1 = 0.01 → ceil → 1
    expect(calculateSampleSize(1, 1)).toBeGreaterThanOrEqual(1);
  });

  test('throws for percentage of 0', () => {
    expect(() => calculateSampleSize(100, 0)).toThrow();
  });

  test('throws for negative percentage', () => {
    expect(() => calculateSampleSize(100, -5)).toThrow();
  });

  test('throws for percentage above 100', () => {
    expect(() => calculateSampleSize(100, 101)).toThrow();
  });

  test('100% of any count returns the full count', () => {
    expect(calculateSampleSize(50, 100)).toBe(50);
  });
});
