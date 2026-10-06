import { describe, it, expect } from 'vitest';
import {
  cleanSearchText,
  normalizeSearch,
  parseBodyPartTokens,
  matchesExerciseSearch,
} from './normalizeSearch';

describe('normalizeSearch utility', () => {
  describe('cleanSearchText', () => {
    it('folds diacritics via NFD', () => {
      expect(cleanSearchText('Élévation Latérale')).toBe('elevation laterale');
      expect(cleanSearchText('Développé Couché')).toBe('developpe couche');
    });

    it('converts to lowercase', () => {
      expect(cleanSearchText('BENCH PRESS')).toBe('bench press');
    });

    it('collapses spaces and punctuation', () => {
      expect(cleanSearchText('   Lat   --  Pull   Down   ')).toBe('lat pull down');
      expect(cleanSearchText('Bicep / Tricep')).toBe('bicep tricep');
    });

    it('handles null and undefined gracefully', () => {
      expect(cleanSearchText(null)).toBe('');
      expect(cleanSearchText(undefined)).toBe('');
      expect(cleanSearchText('')).toBe('');
    });
  });

  describe('expandSearchAliases and normalizeSearch', () => {
    it('expands rdl to romanian deadlift', () => {
      expect(normalizeSearch('rdl')).toBe('romanian deadlift');
      expect(normalizeSearch('RDL')).toBe('romanian deadlift');
      expect(normalizeSearch('r.d.l.')).toBe('romanian deadlift');
    });

    it('expands ohp to overhead press', () => {
      expect(normalizeSearch('ohp')).toBe('overhead press');
      expect(normalizeSearch('OHP')).toBe('overhead press');
    });

    it('expands compound queries like db rdl', () => {
      expect(normalizeSearch('db rdl')).toBe('dumbbell romanian deadlift');
      expect(normalizeSearch('bb bench')).toBe('barbell bench');
    });

    it('leaves non-aliased queries intact while cleaning', () => {
      expect(normalizeSearch('zercher squat')).toBe('zercher squat');
      expect(normalizeSearch('incline bench')).toBe('incline bench');
    });
  });

  describe('parseBodyPartTokens', () => {
    it('splits on commas and slashes, trimming whitespace and deduplicating', () => {
      expect(parseBodyPartTokens('Chest / Triceps')).toEqual(['Chest', 'Triceps']);
      expect(parseBodyPartTokens('Back, Biceps, Core')).toEqual(['Back', 'Biceps', 'Core']);
      expect(parseBodyPartTokens('Chest, Chest / Shoulders')).toEqual(['Chest', 'Shoulders']);
    });

    it('handles body_parts array and delimited strings', () => {
      const tokens = parseBodyPartTokens(['Back', 'Arms', 'Chest / Shoulders']);
      expect(tokens).toEqual(['Back', 'Arms', 'Chest', 'Shoulders']);
    });
  });

  describe('matchesExerciseSearch', () => {
    it('prefix matches "zer" to Zercher Squat', () => {
      const zercher = { name: 'Zercher Squat', body_parts: ['Legs'] };
      const bench = { name: 'Bench Press', body_parts: ['Chest'] };

      expect(matchesExerciseSearch(zercher, 'zer')).toBe(true);
      expect(matchesExerciseSearch(zercher, 'zer sq')).toBe(true);
      expect(matchesExerciseSearch(bench, 'zer')).toBe(false);
    });

    it('matches "rdl" to Romanian Deadlift via alias expansion', () => {
      const rdl = { name: 'Romanian Deadlift', body_parts: ['Legs'] };
      expect(matchesExerciseSearch(rdl, 'rdl')).toBe(true);
      expect(matchesExerciseSearch(rdl, 'romanian')).toBe(true);
      expect(matchesExerciseSearch(rdl, 'deadlift')).toBe(true);
    });

    it('matches "ohp" to Overhead Press', () => {
      const ohp = { name: 'Overhead Press', body_parts: ['Shoulders'] };
      expect(matchesExerciseSearch(ohp, 'ohp')).toBe(true);
    });

    it('enforces token boundary on body parts (Back chip does not match Lower Back)', () => {
      const lowerBackOnly = { name: 'Hyperextensions', body_parts: ['Lower Back'] };
      const backExercise = { name: 'Pull-up', body_parts: ['Back'] };

      expect(matchesExerciseSearch(lowerBackOnly, '', 'Back')).toBe(false);
      expect(matchesExerciseSearch(backExercise, '', 'Back')).toBe(true);
    });

    it('filters by equipment correctly', () => {
      const cableRow = { name: 'Seated Cable Row', equipment: 'cable', body_parts: ['Back'] };
      const barbellRow = { name: 'Bent Over Row', equipment: 'barbell', body_parts: ['Back'] };

      expect(matchesExerciseSearch(cableRow, '', null, 'cable')).toBe(true);
      expect(matchesExerciseSearch(barbellRow, '', null, 'cable')).toBe(false);
    });
  });
});
