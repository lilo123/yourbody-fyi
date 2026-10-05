import { describe, it, expect } from 'vitest';
import {
  formatWeight,
  formatSet,
  formatVolume,
  toDisplayWeight,
  resolveWeightInput,
  parseWeightInput,
  lbToKg,
  kgToLb,
  convertWeight,
  weightUnitLabel,
} from './weight';

describe('weight utilities (src/utils/weight.ts)', () => {
  describe('lb <-> kg math', () => {
    it('converts lb to kg accurately', () => {
      expect(lbToKg(220.462)).toBeCloseTo(100, 1);
      expect(lbToKg(0)).toBe(0);
    });

    it('converts kg to lb accurately', () => {
      expect(kgToLb(100)).toBeCloseTo(220.462, 1);
      expect(kgToLb(0)).toBe(0);
    });

    it('convertWeight converts between units with rounding (lb 0.5, kg 0.1)', () => {
      expect(convertWeight(100, 'lb', 'kg')).toBe(45.4);
      expect(convertWeight(225, 'lb', 'kg')).toBe(102.1);
      expect(convertWeight(45.5, 'kg', 'lb')).toBe(100.5);
      expect(convertWeight(100, 'lb', 'lb')).toBe(100);
      expect(convertWeight(50, 'kg', 'kg')).toBe(50);
    });
  });

  describe('weightUnitLabel', () => {
    it('returns canonical label for active unit', () => {
      expect(weightUnitLabel('lb')).toBe('lbs');
      expect(weightUnitLabel('kg')).toBe('kg');
      expect(weightUnitLabel()).toBe('lbs');
    });
  });

  describe('formatWeight', () => {
    it('formats 0 or null as BW by default', () => {
      expect(formatWeight(0)).toBe('BW');
      expect(formatWeight(null)).toBe('BW');
      expect(formatWeight(undefined)).toBe('BW');
    });

    it('formats positive weight in lb', () => {
      expect(formatWeight(100, 'lb')).toBe('100');
      expect(formatWeight(100.5, 'lb')).toBe('100.5');
    });

    it('formats weight in kg with 0.1 rounding and drops trailing .0', () => {
      expect(formatWeight(220.462, 'kg')).toBe('100');
      expect(formatWeight(100, 'kg')).toBe('45.4');
      expect(formatWeight(225, 'kg')).toBe('102.1');
      expect(formatWeight(kgToLb(100), 'kg')).toBe('100');
    });

    it('appends unit when showUnit is true', () => {
      expect(formatWeight(100, 'lb', { showUnit: true })).toBe('100 lbs');
      expect(formatWeight(100, 'kg', { showUnit: true })).toBe('45.4 kg');
      expect(formatWeight(225, 'kg', { showUnit: true })).toBe('102.1 kg');
      expect(formatWeight(kgToLb(100), 'kg', { showUnit: true })).toBe('100 kg');
      expect(formatWeight(0, 'lb', { showUnit: true })).toBe('BW');
      expect(formatWeight(0, 'kg', { showUnit: true })).toBe('BW');
    });
  });

  describe('formatSet', () => {
    it('formats standard weight and reps using multiplication sign ×', () => {
      expect(formatSet(100, 8)).toBe('100×8');
      expect(formatSet(185, 5)).toBe('185×5');
    });

    it('formats 0 lbs / bodyweight as BW×reps consistently', () => {
      expect(formatSet(0, 8)).toBe('BW×8');
      expect(formatSet(null, 10)).toBe('BW×10');
      expect(formatSet(undefined, 6)).toBe('BW×6');
    });

    it('formats kg sets correctly', () => {
      expect(formatSet(220.462, 8, 'kg')).toBe('100×8');
      expect(formatSet(225, 5, 'kg')).toBe('102.1×5');
      expect(formatSet(kgToLb(100), 5, 'kg')).toBe('100×5');
      expect(formatSet(0, 8, 'kg')).toBe('BW×8');
    });

    it('handles missing reps gracefully', () => {
      expect(formatSet(100, null)).toBe('100');
      expect(formatSet(225, null, 'kg')).toBe('102.1');
      expect(formatSet(0, null)).toBe('BW');
    });
  });

  describe('formatVolume', () => {
    it('formats volume with integer en-US grouping and unit label', () => {
      expect(formatVolume(13500, 'lb')).toBe('13,500 lbs');
      expect(formatVolume(13500, 'kg')).toBe('6,124 kg');
    });

    it('handles zero and null volume gracefully', () => {
      expect(formatVolume(0, 'lb')).toBe('0 lbs');
      expect(formatVolume(0, 'kg')).toBe('0 kg');
      expect(formatVolume(null, 'lb')).toBe('0 lbs');
      expect(formatVolume(undefined, 'kg')).toBe('0 kg');
    });
  });

  describe('toDisplayWeight (input prefill)', () => {
    it('keeps lb value unrounded for input prefill', () => {
      expect(toDisplayWeight(225, 'lb')).toBe(225);
      expect(toDisplayWeight(135.5, 'lb')).toBe(135.5);
      expect(toDisplayWeight(0, 'lb')).toBe(0);
    });

    it('rounds kg value to 0.1 decimal for input prefill', () => {
      expect(toDisplayWeight(225, 'kg')).toBe(102.1);
      expect(toDisplayWeight(kgToLb(100), 'kg')).toBe(100);
      expect(toDisplayWeight(0, 'kg')).toBe(0);
    });
  });

  describe('resolveWeightInput', () => {
    it('preserves exact originalLb if draft matches prefilled string in active unit', () => {
      expect(resolveWeightInput('102.1', 'kg', 225)).toBe(225);
      expect(resolveWeightInput(' 102.1 ', 'kg', 225)).toBe(225);
      expect(resolveWeightInput('225', 'lb', 225)).toBe(225);
      expect(resolveWeightInput(' 225 ', 'lb', 225)).toBe(225);
    });

    it('parses as new value when draft differs from prefill', () => {
      const parsedKg = resolveWeightInput('100', 'kg', 225);
      expect(parsedKg).toBeCloseTo(220.46226218, 5);

      const parsedLb = resolveWeightInput('230', 'lb', 225);
      expect(parsedLb).toBe(230);
    });

    it('parses directly when originalLb is not provided', () => {
      const parsedKg = resolveWeightInput('100', 'kg');
      expect(parsedKg).toBeCloseTo(220.46226218, 5);
      expect(resolveWeightInput('135', 'lb')).toBe(135);
    });

    it('handles BW and empty inputs', () => {
      expect(resolveWeightInput('BW', 'kg', 0)).toBe(0);
      expect(resolveWeightInput('0', 'kg', 0)).toBe(0);
      expect(resolveWeightInput('', 'kg', 225)).toBeNull();
    });
  });

  describe('parseWeightInput (RD-1)', () => {
    it('parses numeric strings in lb', () => {
      expect(parseWeightInput('135')).toBe(135);
      expect(parseWeightInput('135.5')).toBe(135.5);
    });

    it('parses BW / bw / 0 as 0', () => {
      expect(parseWeightInput('BW')).toBe(0);
      expect(parseWeightInput('bw')).toBe(0);
      expect(parseWeightInput('0')).toBe(0);
    });

    it('parses kg input and converts to canonical lb at full precision', () => {
      const canonicalLb = parseWeightInput('100', 'kg');
      expect(canonicalLb).toBeCloseTo(220.46226218, 5);
    });

    it('returns null for invalid inputs', () => {
      expect(parseWeightInput('')).toBeNull();
      expect(parseWeightInput('abc')).toBeNull();
      expect(parseWeightInput('-5')).toBeNull();
    });
  });
});
