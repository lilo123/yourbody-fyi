import { describe, it, expect } from 'vitest';
import * as newCatalog from './exerciseCatalog';
import * as oldGhostSets from './ghostSets';
import { isValidUUID } from './uuid';

describe('Exercise Catalog Utilities (src/utils/exerciseCatalog.ts)', () => {
  describe('Re-export reference identity', () => {
    it('re-exports the exact array reference from ghostSets', () => {
      expect(oldGhostSets.DEFAULT_EXERCISES_LIST).toBe(newCatalog.DEFAULT_EXERCISES_LIST);
    });
  });

  describe('DEFAULT_EXERCISES_LIST content and validity', () => {
    it('contains exactly 12 standard default exercises', () => {
      expect(newCatalog.DEFAULT_EXERCISES_LIST).toHaveLength(12);
    });

    it('has valid RFC 4122 UUID identifiers for all exercises', () => {
      for (const ex of newCatalog.DEFAULT_EXERCISES_LIST) {
        expect(isValidUUID(ex.id)).toBe(true);
        expect(ex.name.trim().length).toBeGreaterThan(0);
        expect(ex.body_parts.length).toBeGreaterThan(0);
      }
    });

    it('contains expected core exercises and body parts', () => {
      const names = newCatalog.DEFAULT_EXERCISES_LIST.map((e) => e.name);
      expect(names).toContain('Incline Bench Press');
      expect(names).toContain('Cable Lateral Raises');
      expect(names).toContain('Dips');
      expect(names).toContain('Leg Extension Machine');
      expect(names).toContain('Lat Pull Down');
      expect(names).toContain('Seated Cable Row');
      expect(names).toContain('Inclined Bicep Curl');
      expect(names).toContain('Leg Curl');
      expect(names).toContain('Face Pulls');
      expect(names).toContain('Weighted Sit-Up');
    });
  });
});
