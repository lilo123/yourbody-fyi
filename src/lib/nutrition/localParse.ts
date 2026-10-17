/**
 * Nutrition Block Local Parser (D-OFF-6 / N4 Grammar)
 *
 * Device wrapper delegating to the shared rule-based nutrition parser core.
 * Preserves the exact public API for client callers while enabling shared
 * parser execution across device and server edge functions.
 */

import {
  parseNutritionText as parseNutritionTextCore,
  parseLocaleNumber,
  LOCAL_PARSE_GRAMMAR_DOC,
  PARSER_VERSION,
  type NutritionRejectReason,
  type ParsedNutritionMeal,
  type ParsedNutritionItem,
  type NutritionParseResult,
  type ParseConfidence,
  type MacroKind,
  type CalorieCorrection,
} from '../../../supabase/functions/_shared/nutritionParser.ts';

export type LocalParseRejectReason = NutritionRejectReason;

export interface LocalParseItem extends ParsedNutritionItem {
  amount?: number;
  unit?: string;
  servingSize?: number;
  servingUnit?: string;
}

export interface LocalParseMeal extends Omit<ParsedNutritionMeal, 'items'> {
  amount?: number;
  unit?: string;
  items?: LocalParseItem[];
}

export type LocalParseResult =
  | { ok: true; meal: LocalParseMeal }
  | { ok: false; reason: LocalParseRejectReason };

export {
  LOCAL_PARSE_GRAMMAR_DOC,
  parseLocaleNumber,
  PARSER_VERSION,
  type NutritionRejectReason,
  type ParsedNutritionMeal,
  type ParsedNutritionItem,
  type NutritionParseResult,
  type ParseConfidence,
  type MacroKind,
  type CalorieCorrection,
};

const COUNTED_CONTAINER_WORDS = new Set([
  'plate', 'plates', 'slice', 'slices', 'piece', 'pieces',
  'serving', 'servings', 'bowl', 'bowls', 'portion', 'portions',
]);

const COUNTED_PORTION_REGEX =
  /(?:\((?:([2-9]|1[0-9]|20)\s*(?:(small|medium|large|big)\s+)?(plates?|slices?|pieces?|servings?|bowls?|portions?))\)|(?:^|[\s,;:\-])([2-9]|1[0-9]|20)\s*(?:(small|medium|large|big)\s+)?(plates?|slices?|pieces?|servings?|bowls?|portions?)(?:\s+of)?(?=$|[\s,;:\-\)]))/i;

export function extractCountedPortion(text: string | null | undefined): { count: number; container: string; size?: string } | null {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(COUNTED_PORTION_REGEX);
  if (!match) return null;
  const countStr = match[1] || match[4];
  const size = (match[2] || match[5])?.toLowerCase();
  const container = (match[3] || match[6])?.toLowerCase();
  if (!countStr || !container) return null;
  const count = parseInt(countStr, 10);
  if (count >= 2 && count <= 20) {
    return { count, container, ...(size ? { size } : {}) };
  }
  return null;
}

export function isVolumeOrWeightUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return /\b(?:g|grams?|ml|milliliters?|oz|ounces?|cups?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|kg)\b/i.test(
    String(unit).trim().toLowerCase()
  );
}

function detectCount(
  name?: string,
  portion?: string,
  servingSize?: number,
  servingUnit?: string
): number | null {
  if (isVolumeOrWeightUnit(servingUnit) || isVolumeOrWeightUnit(portion)) {
    return null;
  }
  const fromName = extractCountedPortion(name);
  if (fromName) return fromName.count;

  const fromPortion = extractCountedPortion(portion);
  if (fromPortion) return fromPortion.count;

  if (
    servingSize !== undefined &&
    Number.isInteger(servingSize) &&
    servingSize >= 2 &&
    servingSize <= 20 &&
    servingUnit &&
    COUNTED_CONTAINER_WORDS.has(servingUnit.toLowerCase())
  ) {
    return servingSize;
  }

  return null;
}

function applyCountedPortion(meal: ParsedNutritionMeal): LocalParseMeal {
  if (meal.items && meal.items.length > 0) {
    let anyChanged = false;
    const items: LocalParseItem[] = meal.items.map((it) => {
      const count = detectCount(
        it.name,
        it.portion,
        (it as LocalParseItem).servingSize,
        (it as LocalParseItem).servingUnit
      );
      if (count !== null) {
        anyChanged = true;
        return {
          ...it,
          portion: `${count} unit`,
          servingSize: count,
          servingUnit: 'unit',
          amount: count,
          unit: 'unit',
        };
      }
      return it;
    });

    if (!anyChanged) return meal;

    const updated: LocalParseMeal = { ...meal, items };
    if (items.length === 1 && items[0].amount !== undefined) {
      updated.amount = items[0].amount;
      updated.unit = 'unit';
      updated.servingSize = items[0].amount;
      updated.servingUnit = 'unit';
    }
    return updated;
  }

  const count = detectCount(meal.name, undefined, meal.servingSize, meal.servingUnit);
  if (count === null) return meal;

  return {
    ...meal,
    servingSize: count,
    servingUnit: 'unit',
    amount: count,
    unit: 'unit',
  };
}

/**
 * Device nutrition parser wrapper.
 * Pure post-processing: keeps core parsing, confidence, and line validation exact,
 * while ensuring items with counted portions (2-20 plates, slices, etc.) stage amount=count, unit="unit".
 */
export function parseNutritionText(text: string): NutritionParseResult & { meal?: LocalParseMeal } {
  const result = parseNutritionTextCore(text);
  if (result.meal) {
    return {
      ...result,
      meal: applyCountedPortion(result.meal),
    };
  }
  return result;
}

/**
 * Parses a nutrition block text. Returns ok: true ONLY for 'exact' confidence
 * (every non-empty line understood, all hard validations pass, no skipped lines).
 */
export function parseNutritionBlock(text: string): LocalParseResult {
  const result = parseNutritionText(text);
  if (result.confidence === 'exact' && result.meal && (!result.meal.items || result.meal.items.length <= 1)) {
    return {
      ok: true,
      meal: result.meal,
    };
  }
  if (result.meal?.items && result.meal.items.length > 1) {
    return {
      ok: false,
      reason: 'MULTIPLE_FOODS',
    };
  }
  return {
    ok: false,
    reason: result.reason ?? 'UNEXPLAINED_CONTENT',
  };
}
