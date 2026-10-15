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
};

export interface CountedPortionMatch {
  count: number;
  size?: string;
  container: string;
  fullMatch: string;
  isParen: boolean;
}

const COUNTED_CONTAINER_WORDS = [
  'plate',
  'plates',
  'slice',
  'slices',
  'piece',
  'pieces',
  'serving',
  'servings',
  'bowl',
  'bowls',
  'portion',
  'portions',
] as const;

const COUNTED_SIZE_ADJECTIVES = ['small', 'medium', 'large', 'big'] as const;

const COUNTED_CONTAINER_PATTERN = COUNTED_CONTAINER_WORDS.join('|');
const COUNTED_SIZE_PATTERN = COUNTED_SIZE_ADJECTIVES.join('|');

const PAREN_COUNTED_REGEX = new RegExp(
  `\\(\\s*(?<![\\d.])([2-9]|1[0-9]|20)\\s*(?:(${COUNTED_SIZE_PATTERN})\\s+)?(${COUNTED_CONTAINER_PATTERN})\\s*\\)`,
  'i'
);

const BARE_COUNTED_REGEX = new RegExp(
  `(?:^|[\\s,;:\\-])(?<![\\d.])([2-9]|1[0-9]|20)\\s*(?:(${COUNTED_SIZE_PATTERN})\\s+)?(${COUNTED_CONTAINER_PATTERN})(?:\\s+of)?(?=$|[\\s,;:\\-\\)])`,
  'i'
);

export function extractCountedPortion(text: string | null | undefined): CountedPortionMatch | null {
  if (!text || typeof text !== 'string') return null;

  const parenMatch = text.match(PAREN_COUNTED_REGEX);
  if (parenMatch) {
    const count = parseInt(parenMatch[1], 10);
    if (count >= 2 && count <= 20) {
      return {
        count,
        size: parenMatch[2]?.toLowerCase(),
        container: parenMatch[3].toLowerCase(),
        fullMatch: parenMatch[0],
        isParen: true,
      };
    }
  }

  const bareMatch = text.match(BARE_COUNTED_REGEX);
  if (bareMatch) {
    const count = parseInt(bareMatch[1], 10);
    if (count >= 2 && count <= 20) {
      return {
        count,
        size: bareMatch[2]?.toLowerCase(),
        container: bareMatch[3].toLowerCase(),
        fullMatch: bareMatch[0].trim(),
        isParen: false,
      };
    }
  }

  return null;
}

export function isVolumeOrWeightUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const u = String(unit).trim().toLowerCase();
  return /\b(?:g|grams?|ml|milliliters?|oz|ounces?|cups?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|kg)\b/i.test(u);
}

export function isContainerWord(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const u = String(unit).trim().toLowerCase();
  return (COUNTED_CONTAINER_WORDS as readonly string[]).includes(u);
}

function applyCountedPortionToItem(item: ParsedNutritionItem): LocalParseItem {
  if (!item || !item.name) return item;
  if (isVolumeOrWeightUnit((item as LocalParseItem).servingUnit) || isVolumeOrWeightUnit(item.portion)) {
    return item;
  }

  let count: number | undefined;
  const portionInfo = extractCountedPortion(item.name) || extractCountedPortion(item.portion);
  if (portionInfo) {
    count = portionInfo.count;
  } else {
    const sUnit = (item as LocalParseItem).servingUnit;
    const sSize = (item as LocalParseItem).servingSize;
    if (sSize !== undefined && Number.isInteger(sSize) && sSize >= 2 && sSize <= 20 && isContainerWord(sUnit)) {
      count = sSize;
    }
  }

  if (count === undefined) return item;

  return {
    ...item,
    portion: `${count} unit`,
    servingSize: count,
    servingUnit: 'unit',
    amount: count,
    unit: 'unit',
  };
}

function applyCountedPortionToMeal(meal: ParsedNutritionMeal, candidatePrefix?: string): LocalParseMeal {
  if (!meal) return meal;

  const updatedMeal: LocalParseMeal = { ...meal };

  if (meal.items && meal.items.length > 0) {
    const updatedItems = meal.items.map((it) => applyCountedPortionToItem(it));
    updatedMeal.items = updatedItems;
    if (updatedItems.length === 1 && updatedItems[0].amount !== undefined) {
      updatedMeal.servingSize = updatedItems[0].amount;
      updatedMeal.servingUnit = 'unit';
      updatedMeal.amount = updatedItems[0].amount;
      updatedMeal.unit = 'unit';
    }
    return updatedMeal;
  }

  if (isVolumeOrWeightUnit(meal.servingUnit)) return meal;

  let count: number | undefined;
  const portionInfo = extractCountedPortion(meal.name) || extractCountedPortion(candidatePrefix);
  if (portionInfo) {
    count = portionInfo.count;
  } else if (
    meal.servingSize !== undefined &&
    Number.isInteger(meal.servingSize) &&
    meal.servingSize >= 2 &&
    meal.servingSize <= 20 &&
    isContainerWord(meal.servingUnit)
  ) {
    count = meal.servingSize;
  }

  if (count === undefined) return meal;

  updatedMeal.servingSize = count;
  updatedMeal.servingUnit = 'unit';
  updatedMeal.amount = count;
  updatedMeal.unit = 'unit';

  if (!updatedMeal.items || updatedMeal.items.length === 0) {
    updatedMeal.items = [
      {
        name: updatedMeal.name || 'Meal',
        portion: `${count} unit`,
        servingSize: count,
        servingUnit: 'unit',
        amount: count,
        unit: 'unit',
        calories: updatedMeal.calories,
        protein: updatedMeal.protein,
        carbs: updatedMeal.carbs,
        fat: updatedMeal.fat,
        fiber: updatedMeal.fiber ?? 0,
        isRange: false,
      },
    ];
  } else if (updatedMeal.items.length === 1) {
    updatedMeal.items = [
      {
        ...updatedMeal.items[0],
        portion: `${count} unit`,
        servingSize: count,
        servingUnit: 'unit',
        amount: count,
        unit: 'unit',
      },
    ];
  }

  return updatedMeal;
}

function trySanitizeForCore(text: string): { sanitizedText: string; originalPrefix?: string } | null {
  const portionInfo = extractCountedPortion(text);
  if (!portionInfo) return null;

  const lines = text.split(/\r?\n/);
  const firstLine = lines[0]?.trim() || '';

  // If conversational prose markers are present anywhere, do not attempt sanitization
  if (
    /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+for|today\s+i|for\s+(?:breakfast|lunch|dinner|snack|dessert)|recipe\s+for|ingredients:?|which\s+was|about|approx|burned|workout)\b/i.test(
      firstLine
    )
  ) {
    return null;
  }

  let modifiedFirstLine = firstLine;
  let originalPrefix: string | undefined = undefined;

  // If portion is in parentheses (e.g. "Spaghetti Allo Scoglio (2 small plates)"),
  // strip the parentheses for core parser
  if (portionInfo.isParen && firstLine.includes(portionInfo.fullMatch)) {
    const colonIdx = firstLine.indexOf(':');
    const dashIdx = firstLine.indexOf(' - ');
    if (colonIdx !== -1) {
      originalPrefix = firstLine.slice(0, colonIdx).trim().replace(/^[-*•+]\s*/, '');
    } else if (dashIdx !== -1) {
      originalPrefix = firstLine.slice(0, dashIdx).trim().replace(/^[-*•+]\s*/, '');
    } else {
      const kcalMatch = firstLine.match(
        /(?:^|[\s—–])(\d+(?:\.\d+)?)\s*(?:kcal|calories?|cals?)\b/i
      );
      if (kcalMatch && kcalMatch.index !== undefined) {
        originalPrefix = firstLine.slice(0, kcalMatch.index).trim().replace(/^[-*•+]\s*/, '');
      } else {
        originalPrefix = firstLine;
      }
    }
    modifiedFirstLine = firstLine.replace(portionInfo.fullMatch, '').replace(/\s+/g, ' ').trim();
  }

  // If there is no ':' or ' - ' before the first calorie match, insert ': ' before the calorie match
  const hasDelimiter = /[:|—–]|\s+-\s+/.test(modifiedFirstLine);
  if (!hasDelimiter) {
    const kcalMatch = modifiedFirstLine.match(
      /(?:^|\s+)(\d+(?:\.\d+)?)\s*(?:kcal|calories?|cals?)\b/i
    );
    if (kcalMatch && kcalMatch.index !== undefined) {
      const foodPart = modifiedFirstLine.slice(0, kcalMatch.index).trim();
      const kcalPart = modifiedFirstLine.slice(kcalMatch.index).trim();
      if (foodPart && kcalPart) {
        if (!originalPrefix) {
          originalPrefix = foodPart;
        }
        modifiedFirstLine = `${foodPart}: ${kcalPart}`;
      }
    }
  }

  if (modifiedFirstLine === firstLine && !originalPrefix) {
    return null;
  }

  const modifiedLines = [modifiedFirstLine, ...lines.slice(1)];
  return {
    sanitizedText: modifiedLines.join('\n'),
    originalPrefix,
  };
}

/**
 * Device nutrition parser wrapper.
 * Preserves counted portions in item names (e.g. "Spaghetti Allo Scoglio (2 small plates)")
 * and stages amount = count, unit = "unit", keeping total kcal/macros exactly as pasted.
 */
export function parseNutritionText(text: string): NutritionParseResult & { meal?: LocalParseMeal } {
  let res: NutritionParseResult = parseNutritionTextCore(text);

  if (res.confidence !== 'exact') {
    const sanitizedInfo = trySanitizeForCore(text);
    if (sanitizedInfo) {
      const resSanitized = parseNutritionTextCore(sanitizedInfo.sanitizedText);
      const isExact = resSanitized.confidence === 'exact';
      const isCaloriesOnlyValid =
        resSanitized.confidence === 'partial' &&
        resSanitized.reason === 'MISSING_MACRO' &&
        resSanitized.skippedLines.length === 0 &&
        resSanitized.meal !== undefined &&
        (resSanitized.meal.calories ?? 0) > 0 &&
        !/(?:protein|carbs?|fat)\b/i.test(text);

      if ((isExact || isCaloriesOnlyValid) && resSanitized.meal) {
        const foodName = sanitizedInfo.originalPrefix || resSanitized.meal.name;
        res = {
          ...resSanitized,
          confidence: 'exact',
          meal: {
            ...resSanitized.meal,
            name: foodName,
          },
        };
      }
    }
  }

  if (res.meal) {
    const firstLine = text.trim().split(/\r?\n/)[0]?.trim() || '';
    const prefixMatch = firstLine.match(/^([^:|—–]+)(?:[:|—–]|\s+-\s+)(.+)$/);
    const candidatePrefix = prefixMatch ? prefixMatch[1].trim().replace(/^[-*•+]\s*/, '') : undefined;

    res.meal = applyCountedPortionToMeal(res.meal, candidatePrefix);

    if (candidatePrefix) {
      const barePortion = extractCountedPortion(candidatePrefix);
      if (barePortion && !isVolumeOrWeightUnit(barePortion.container)) {
        res.meal.name = candidatePrefix;
        if (res.meal.items && res.meal.items.length === 1) {
          res.meal.items[0].name = candidatePrefix;
        }
      }
    }
  }

  return res as NutritionParseResult & { meal?: LocalParseMeal };
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
