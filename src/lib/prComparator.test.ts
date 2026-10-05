import { describe, it, expect } from 'vitest';
import { e1rm, comparePrSets, pickPrSet } from './prComparator';
import { lbToKg } from '../utils/weight';

describe('prComparator', () => {
  describe('e1rm formula (Epley)', () => {
    it('calculates expected e1rm values', () => {
      // 100 * (1 + 3/30) = 110
      expect(e1rm(100, 3)).toBe(110);
      // 90 * (1 + 10/30) = 120
      expect(e1rm(90, 10)).toBe(120);
      // 184 * (1 + 12/30) = 257.6
      expect(e1rm(184, 12)).toBe(257.6);
      // 196 * (1 + 9/30) = 254.8
      expect(e1rm(196, 9)).toBe(254.8);
    });

    it('returns 0 for bodyweight / zero / negative weight', () => {
      expect(e1rm(0, 10)).toBe(0);
      expect(e1rm(-50, 10)).toBe(0);
    });

    it('handles 0 reps by returning weight', () => {
      expect(e1rm(100, 0)).toBe(100);
    });
  });

  describe('comparePrSets in weight mode', () => {
    it('ranks higher weight first', () => {
      const a = { weight: 100, reps: 3 };
      const b = { weight: 90, reps: 10 };
      expect(comparePrSets(a, b, 'weight')).toBeLessThan(0); // a wins
      expect(comparePrSets(b, a, 'weight')).toBeGreaterThan(0);
    });

    it('tie-breaks equal weight with more reps', () => {
      const a = { weight: 100, reps: 5 };
      const b = { weight: 100, reps: 3 };
      expect(comparePrSets(a, b, 'weight')).toBeLessThan(0); // a wins
    });

    it('tie-breaks equal weight and reps with earlier date', () => {
      const a = { weight: 100, reps: 5, date: '2026-01-01' };
      const b = { weight: 100, reps: 5, date: '2026-02-01' };
      expect(comparePrSets(a, b, 'weight')).toBeLessThan(0); // a wins
    });

    it('tie-breaks with created_at, set_index, and id', () => {
      const a = { weight: 100, reps: 5, date: '2026-01-01', created_at: '2026-01-01T10:00:00Z', set_index: 1, id: 'a' };
      const b = { weight: 100, reps: 5, date: '2026-01-01', created_at: '2026-01-01T10:00:00Z', set_index: 2, id: 'b' };
      expect(comparePrSets(a, b, 'weight')).toBeLessThan(0); // a wins on set_index
    });
  });

  describe('comparePrSets in e1rm mode (Matrix)', () => {
    it('100x3 vs 90x10 -> e1rm picks 90x10', () => {
      const set100x3 = { weight: 100, reps: 3 }; // e1rm 110
      const set90x10 = { weight: 90, reps: 10 }; // e1rm 120
      expect(comparePrSets(set90x10, set100x3, 'e1rm')).toBeLessThan(0); // 90x10 wins
      expect(comparePrSets(set100x3, set90x10, 'e1rm')).toBeGreaterThan(0);
    });

    it('>12 reps excluded when weighted', () => {
      const ineligible = { weight: 100, reps: 15 }; // e1rm 150, but reps > 12
      const eligible = { weight: 80, reps: 10 };   // e1rm 106.67
      expect(comparePrSets(eligible, ineligible, 'e1rm')).toBeLessThan(0); // eligible wins
    });

    it('bodyweight 0 -> reps decide', () => {
      const bw10 = { weight: 0, reps: 10 };
      const bw20 = { weight: 0, reps: 20 };
      expect(comparePrSets(bw20, bw10, 'e1rm')).toBeLessThan(0); // bw20 wins
    });

    it('equal e1rm -> heavier weight wins', () => {
      // 100 * (1 + 6/30) = 120
      // 90 * (1 + 10/30) = 120
      const set100x6 = { weight: 100, reps: 6 };
      const set90x10 = { weight: 90, reps: 10 };
      expect(e1rm(set100x6.weight, set100x6.reps)).toBe(e1rm(set90x10.weight, set90x10.reps));
      expect(comparePrSets(set100x6, set90x10, 'e1rm')).toBeLessThan(0); // 100x6 wins
    });

    it('only-ineligible sets -> weight ranking fallback', () => {
      const set100x15 = { weight: 100, reps: 15 };
      const set90x20 = { weight: 90, reps: 20 };
      // Both sets have reps > 12. Fallback to weight ranking: 100x15 wins
      expect(comparePrSets(set100x15, set90x20, 'e1rm')).toBeLessThan(0);
    });

    it('ranking is unit-invariant (kg vs lb)', () => {
      const setAlb = { weight: 220, reps: 3 }; // e1rm = 220 * 1.1 = 242
      const setBlb = { weight: 198, reps: 10 }; // e1rm = 198 * 1.3333 = 264
      const setAkg = { weight: lbToKg(220), reps: 3 };
      const setBkg = { weight: lbToKg(198), reps: 10 };

      const cmpLb = comparePrSets(setAlb, setBlb, 'e1rm');
      const cmpKg = comparePrSets(setAkg, setBkg, 'e1rm');

      // Set B should win in both lb and kg
      expect(cmpLb).toBeGreaterThan(0);
      expect(cmpKg).toBeGreaterThan(0);
    });
  });

  describe('pickPrSet', () => {
    it('returns null on empty sets', () => {
      expect(pickPrSet([], 'weight')).toBeNull();
      expect(pickPrSet([], 'e1rm')).toBeNull();
    });

    it('picks winner according to active mode', () => {
      const sets = [
        { id: '1', weight: 100, reps: 3, date: '2026-03-01' },
        { id: '2', weight: 90, reps: 10, date: '2026-03-02' },
      ];

      expect(pickPrSet(sets, 'weight')?.id).toBe('1');
      expect(pickPrSet(sets, 'e1rm')?.id).toBe('2');
    });
  });
});
