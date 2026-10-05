import { describe, it, expect } from 'vitest';
import corpus from '../../supabase/tests/fixtures/portion_corpus.json';
import {
  convertPortion,
  parseQuantityInput,
  shortUnitLabel,
  MAX_QUANTITY,
  UNIT_VOCABULARY,
  CANONICAL_UNITS,
} from './unitConverter';

interface CorpusRow {
  portion: string;
  quantity: number;
  unit: string;
  confidence: string;
  group: string;
  note?: string;
}

const rows = corpus as CorpusRow[];

describe('convertPortion — the shared corpus', () => {
  // supabase/tests/fixtures/portion_corpus.json is also asserted against the
  // SQL converter by scripts/check-portion-parity.sh. Both must pass or the
  // backfill and the client disagree about what a portion string means.
  it.each(rows.map((r) => [r.portion, r] as const))('%j', (_portion, row) => {
    const result = convertPortion(row.portion);
    expect(result.quantity).toBeCloseTo(row.quantity, 10);
    expect(result.unit).toBe(row.unit);
    expect(result.confidence).toBe(row.confidence);
  });

  it('covers all 17 real production portion strings', () => {
    expect(rows.filter((r) => r.group === 'real')).toHaveLength(17);
  });

  it('produces the measured confidence distribution over the real corpus', () => {
    const real = rows.filter((r) => r.group === 'real').map((r) => convertPortion(r.portion));
    expect(real.filter((r) => r.confidence === 'high')).toHaveLength(10);
    expect(real.filter((r) => r.confidence === 'medium')).toHaveLength(7);
  });
});

describe('convertPortion — rule order and traps', () => {
  it("avoids the '1 cup (unsweetened)' trap: a parenthesis without a number+unit is not a mass hint", () => {
    expect(convertPortion('1 cup (unsweetened)')).toMatchObject({ quantity: 1, unit: 'unit' });
  });

  it('gives the parenthesised hint priority over the leading number', () => {
    expect(convertPortion('1 g (2 g)')).toMatchObject({ quantity: 2, unit: 'g', confidence: 'high' });
  });

  it('does not throw on any malformed numeric', () => {
    const hostile = ['1..5 g', '..', '.', '-', '-5', '1e', 'e3', 'NaN g', 'Infinity g', '1.2.3 g'];
    for (const input of hostile) {
      expect(() => convertPortion(input)).not.toThrow();
      expect(Number.isFinite(convertPortion(input).quantity)).toBe(true);
    }
  });

  it('never returns a non-finite or negative quantity for any corpus entry', () => {
    for (const row of rows) {
      const { quantity } = convertPortion(row.portion);
      expect(Number.isFinite(quantity)).toBe(true);
      expect(quantity).toBeGreaterThan(0);
      expect(quantity).toBeLessThanOrEqual(MAX_QUANTITY);
    }
  });

  it('flags rather than reinterprets the give-up cases', () => {
    expect(convertPortion('-5 g').reason).toBe('negative');
    expect(convertPortion('1/2 cup').reason).toBe('fraction');
    expect(convertPortion('999999999 g').reason).toBe('out-of-range');
    expect(convertPortion('1..5 g').reason).toBe('unparseable');
    expect(convertPortion('').reason).toBe('empty');
  });

  it('pins the two JS/Python divergences', () => {
    // Python float('1e3') is 1000 and JS parseFloat('1e3') is also 1000, but we
    // deliberately reject exponent notation rather than silently read 1000 g
    // out of a portion string a human never typed.
    expect(convertPortion('1e3 g')).toMatchObject({ quantity: 1, unit: 'unit', confidence: 'low' });
    // Python float('\u0663') is 3.0. JS Number('\u0663') is 3 too, but our
    // regex only accepts ASCII digits, so this degrades safely instead of
    // asserting a mass we cannot round-trip.
    expect(convertPortion('\u0663 g')).toMatchObject({ quantity: 1, unit: 'unit', confidence: 'low' });
  });

  it('treats null, undefined and blank input as the default portion', () => {
    for (const input of [null, undefined, '', '   ', '\t\n']) {
      expect(convertPortion(input)).toMatchObject({ quantity: 1, unit: 'unit', confidence: 'default' });
    }
  });

  it('normalises kg, mg and l onto the canonical g / ml', () => {
    expect(convertPortion('2 kg')).toMatchObject({ quantity: 2000, unit: 'g' });
    expect(convertPortion('250 mg')).toMatchObject({ quantity: 0.25, unit: 'g' });
    expect(convertPortion('2 l')).toMatchObject({ quantity: 2000, unit: 'ml' });
  });

  it('only ever emits a canonical unit', () => {
    for (const row of rows) {
      expect(CANONICAL_UNITS).toContain(convertPortion(row.portion).unit);
    }
  });
});

describe('shortUnitLabel', () => {
  it('is total over the eight-value production serving-unit vocabulary', () => {
    const labels = UNIT_VOCABULARY.map((u) => shortUnitLabel(u));
    expect(labels).toEqual(['srv', 'g', 'ml', 'meal', 'bowl', 'bar', 'egg', 'plate']);
    // The chip is max-w-[64px]; every label must be short enough not to clip.
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(5);
  });

  it('covers the canonical component units', () => {
    expect(CANONICAL_UNITS.map(shortUnitLabel)).toEqual(['g', 'ml', 'unit']);
  });

  it('passes unknown units through and is case- and whitespace-insensitive', () => {
    expect(shortUnitLabel('  Serving ')).toBe('srv');
    expect(shortUnitLabel('Large Egg')).toBe('egg');
    expect(shortUnitLabel('scoop')).toBe('scoop');
    expect(shortUnitLabel('')).toBe('unit');
    expect(shortUnitLabel(null)).toBe('unit');
  });
});

describe('parseQuantityInput — the numeric form-field path', () => {
  // A rendered <input type="number"> normalises '\u0663', '12.' and '1..5' to
  // the empty string before JS sees them. '1e3' and '-5' pass straight through,
  // which is what this guard is for.
  it('accepts the values a number input really produces', () => {
    expect(parseQuantityInput('12.5')).toBe(12.5);
    expect(parseQuantityInput('0')).toBe(0);
    expect(parseQuantityInput(150)).toBe(150);
    expect(parseQuantityInput('1e3')).toBe(1000);
  });

  it('rejects the values that must not become a quantity', () => {
    expect(parseQuantityInput('-5')).toBeNull();
    expect(parseQuantityInput('')).toBeNull();
    expect(parseQuantityInput('   ')).toBeNull();
    expect(parseQuantityInput(null)).toBeNull();
    expect(parseQuantityInput(undefined)).toBeNull();
    expect(parseQuantityInput('abc')).toBeNull();
    expect(parseQuantityInput('1..5')).toBeNull();
    expect(parseQuantityInput(NaN)).toBeNull();
    expect(parseQuantityInput(Infinity)).toBeNull();
    expect(parseQuantityInput('999999999')).toBeNull();
  });
});
