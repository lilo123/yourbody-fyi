/**
 * Nutrition Block Local Parser (D-OFF-6 / N4 Grammar)
 *
 * Device wrapper delegating to the shared rule-based nutrition parser core.
 * Preserves the exact public API for client callers while enabling shared
 * parser execution across device and server edge functions.
 */

import {
  parseNutritionText,
  parseLocaleNumber,
  LOCAL_PARSE_GRAMMAR_DOC,
  NUTRITION_PARSER_VERSION,
  PARSER_VERSION,
  type NutritionRejectReason,
  type ParsedNutritionMeal,
  type NutritionParseResult,
  type ParseConfidence,
  type MacroKind,
} from '../../../supabase/functions/_shared/nutritionParser.ts';

export type LocalParseRejectReason = NutritionRejectReason;
export type LocalParseMeal = ParsedNutritionMeal;

export type LocalParseResult =
  | { ok: true; meal: LocalParseMeal }
  | { ok: false; reason: LocalParseRejectReason };

export {
  LOCAL_PARSE_GRAMMAR_DOC,
  parseNutritionText,
  parseLocaleNumber,
  NUTRITION_PARSER_VERSION,
  PARSER_VERSION,
  type NutritionRejectReason,
  type ParsedNutritionMeal,
  type NutritionParseResult,
  type ParseConfidence,
  type MacroKind,
};

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
