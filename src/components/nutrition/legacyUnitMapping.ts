import type { CanonicalUnit } from '../../utils/unitConverter';

const GRAM_PATTERN = /^(g|gr|gm|gms|gram|grams|gramme|grammes)\.?$/i;
const ML_PATTERN = /^(ml|mls|milliliter|milliliters|millilitre|millilitres)\.?$/i;

/**
 * Maps legacy free-text unit strings to canonical units ('g' | 'ml' | 'unit').
 * Case-insensitive, trims whitespace.
 * Grams spellings (g, gram, grams, gr, gm, ...) -> 'g'
 * Millilitre spellings (ml, milliliter(s), millilitre(s), mL, ...) -> 'ml'
 * Anything else -> 'unit'
 */
export function mapLegacyUnit(raw: string | null | undefined): CanonicalUnit {
  if (raw == null) return 'unit';
  const trimmed = raw.trim();
  if (!trimmed) return 'unit';
  if (GRAM_PATTERN.test(trimmed)) return 'g';
  if (ML_PATTERN.test(trimmed)) return 'ml';
  return 'unit';
}
