/**
 * Shared Rule-Based Nutrition Parser Core
 *
 * Pure TypeScript nutrition parser with confidence levels, weight extraction,
 * and robust cleanup. Valid for both Deno edge functions and Vite/tsc client builds.
 * Zero external dependencies, zero imports.
 */

export const PARSER_VERSION = '2026.10';

export type ParseConfidence = 'exact' | 'lenient' | 'partial' | 'none';
export type MacroKind = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber';

export type NutritionRejectReason =
  | 'EMPTY_INPUT'
  | 'NOT_A_NUTRITION_BLOCK'
  | 'MISSING_MACRO'
  | 'DUPLICATE_MACRO'
  | 'SECOND_CALORIES_LINE'
  | 'INVALID_MACRO_UNIT'
  | 'KJ_WITHOUT_KCAL'
  | 'VALUE_OUT_OF_RANGE'
  | 'KCAL_INCONSISTENT'
  | 'NAME_CONTAINS_DIGITS'
  | 'NAME_MULTIPLE_ITEMS'
  | 'UNEXPLAINED_CONTENT'
  | 'MULTIPLE_FOODS'
  | (string & {});

export interface ParsedNutritionItem {
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  isRange?: boolean;
}

export interface ParsedNutritionMeal {
  name?: string;
  servingSize?: number;
  servingUnit?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  items?: ParsedNutritionItem[];
  explanation?: string;
}

export interface NutritionParseResult {
  confidence: ParseConfidence;
  meal?: ParsedNutritionMeal;
  reason?: NutritionRejectReason;
  hint?: string;
  skippedLines: string[];
  modifiers: string[];
  foundMacros?: MacroKind[];
}

export const LOCAL_PARSE_GRAMMAR_DOC = `### Local Nutrition Block Grammar (D-OFF-6 / N4)

Local parsing applies ONLY when the ENTIRE input is a single nutrition block.
False positives are worse than misses: when in doubt, reject.

1. **Lines & Structure**:
   - Optional **NAME** line: first non-empty line only, <=60 chars, NO digits,
     no conjunctions/list markers ('and', 'with', 'plus', '&', '+', ',', ';', '/').
   - Optional **SERVING** line: \`Serving( size)?: <num> <unit>\` or \`Per <num> <unit>\` / \`Per serving\`.
   - **HEADER NOISE**: \`Nutrition Facts\`, \`Amount Per Serving\`, \`% Daily Value*\`, etc. ignored.
   - **IGNORABLE SUB-ROWS**: Saturated/trans fat, cholesterol, sodium, sugars, added sugars, salt, vitamins.
   - **MACRO LINES**: Exactly one of each of the 4 macros (Calories, Protein, Carbs, Fat); optional Fiber.

2. **Macro Forms**:
   - Calories: \`Calories[:]? <num>( kcal)?\`, \`Energy <num> kcal\` (kJ alone rejected; if both, kcal wins).
   - Protein: \`Protein[:]? <num>( g)?\`, \`P<num>\`, \`30g protein\`.
   - Carbs: \`(Total )?Carb(s|ohydrate(s)?)[:]? <num>( g)?\`, \`C<num>\`, \`40g carbs\`.
   - Fat: \`(Total )?Fat[:]? <num>( g)?\` (not sat/trans fat), \`F<num>\`, \`8g fat\`.
   - Fiber (optional): \`(Dietary )?Fib(er|re)[:]? <num>( g)?\`.
   - Compact: \`350 kcal | 30g protein | 40g carbs | 8g fat\` or \`P30 C40 F8 350kcal\`.
   - Separators: \`|\`, \`,\`, \`/\`, \`·\`, \`;\`, or whitespace.

3. **Units & Numbers**:
   - Numbers: standard \`.\` or comma decimal \`,\` (e.g. \`8,5 g\`), locale thousands separators (\`1,000\`, \`1.000\`).
   - Bounds: \`0 <= calories <= 5000\`, \`0 <= macro <= 500 g\`.
   - Units: macros must be in \`g\` or unitless; \`mg\` or \`oz\` rejected.

4. **Consistency & Rejection**:
   - Consistency check: \`|4*P + 4*C + 9*F - kcal| <= max(60, 25% * kcal)\`.
   - Reject: missing any macro, second calories line, duplicate macro with different value,
     name with digits or multiple items/conjunctions, leftover words, prose, multiple foods.`;

interface ExtractedMacroToken {
  kind: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'ignorable' | 'kj_only';
  value: number;
  invalidUnit?: boolean;
  isRange?: boolean;
  ambiguous?: boolean;
}

interface ParsedServingLine {
  matched: boolean;
  size?: number;
  unit?: string;
  source: 'per_basis' | 'serving_size' | 'consumed_weight';
  basisLabel?: string;
  isRange?: boolean;
  ambiguous?: boolean;
}

function roundToOneDecimal(val: number): number {
  return Math.round(val * 10) / 10;
}

export interface ParsedNumberResult {
  value: number | null;
  ambiguous: boolean;
}

/**
 * Locale number parser handling thousands separators and decimal marks.
 *
 * Locale rule:
 * - A comma or dot followed by exactly 3 digits (and then a non-digit / end) is a thousands separator:
 *   '1,000' = '1.000' = 1000; '1,234.5' = 1234.5; '1.234,5' = 1234.5.
 * - A comma/dot followed by 1-2 digits is a decimal mark ('2,5 g' = 2.5; '2.5 g' = 2.5).
 * - Anything that still cannot be read unambiguously (e.g. '1,0000', mixed/inconsistent groups)
 *   returns ambiguous: true and can never produce an "exact" grade.
 */
export function parseLocaleNumber(raw: string): ParsedNumberResult {
  const cleaned = raw.trim();
  if (!cleaned) return { value: null, ambiguous: false };

  let isNegative = false;
  let digitsPart = cleaned;
  if (digitsPart.startsWith('-')) {
    isNegative = true;
    digitsPart = digitsPart.slice(1).trim();
  } else if (digitsPart.startsWith('+')) {
    digitsPart = digitsPart.slice(1).trim();
  }

  // Strip optional trailing unit (e.g. "g", "kcal", "cal", "cals", "ml", "oz", "%")
  digitsPart = digitsPart.replace(/\s*[a-zA-Z%]+$/, '').trim();

  if (!digitsPart) return { value: null, ambiguous: false };

  // Integer digits with no comma or period
  if (/^\d+$/.test(digitsPart)) {
    const val = Number(digitsPart);
    return { value: isNegative ? -val : val, ambiguous: false };
  }

  const hasComma = digitsPart.includes(',');
  const hasDot = digitsPart.includes('.');

  // Both comma and dot present
  if (hasComma && hasDot) {
    const lastComma = digitsPart.lastIndexOf(',');
    const lastDot = digitsPart.lastIndexOf('.');

    if (lastComma < lastDot) {
      // US style: comma is thousands, dot is decimal (e.g. 1,234.5)
      const [intPart, decPart] = digitsPart.split('.');
      const intGroups = intPart.split(',');
      const validInt =
        intGroups.length > 1 &&
        intGroups[0].length >= 1 &&
        intGroups[0].length <= 3 &&
        intGroups.slice(1).every((group) => group.length === 3 && /^\d{3}$/.test(group));
      const validDec =
        (decPart.length === 1 || decPart.length === 2) && /^\d+$/.test(decPart);

      if (validInt && validDec) {
        const val = Number(intGroups.join('') + '.' + decPart);
        return { value: isNegative ? -val : val, ambiguous: false };
      }
      const rawNum = Number(digitsPart.replace(/,/g, ''));
      return {
        value: Number.isFinite(rawNum) ? (isNegative ? -rawNum : rawNum) : null,
        ambiguous: true,
      };
    } else {
      // EU style: dot is thousands, comma is decimal (e.g. 1.234,5)
      const [intPart, decPart] = digitsPart.split(',');
      const intGroups = intPart.split('.');
      const validInt =
        intGroups.length > 1 &&
        intGroups[0].length >= 1 &&
        intGroups[0].length <= 3 &&
        intGroups.slice(1).every((group) => group.length === 3 && /^\d{3}$/.test(group));
      const validDec =
        (decPart.length === 1 || decPart.length === 2) && /^\d+$/.test(decPart);

      if (validInt && validDec) {
        const val = Number(intGroups.join('') + '.' + decPart);
        return { value: isNegative ? -val : val, ambiguous: false };
      }
      const rawNum = Number(digitsPart.replace(/\./g, '').replace(',', '.'));
      return {
        value: Number.isFinite(rawNum) ? (isNegative ? -rawNum : rawNum) : null,
        ambiguous: true,
      };
    }
  }

  // Only commas
  if (hasComma && !hasDot) {
    const parts = digitsPart.split(',');
    if (parts.length === 2) {
      const [left, right] = parts;
      if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        if (right.length === 3) {
          // Exactly 3 digits -> thousands separator (e.g. 1,000 = 1000)
          const val = Number(left + right);
          return { value: isNegative ? -val : val, ambiguous: false };
        } else if (right.length === 1 || right.length === 2) {
          // 1-2 digits -> decimal mark (e.g. 12,5 = 12.5)
          const val = Number(left + '.' + right);
          return { value: isNegative ? -val : val, ambiguous: false };
        } else {
          // >= 4 digits -> ambiguous (e.g. 1,0000)
          const val = Number(left + right);
          return { value: isNegative ? -val : val, ambiguous: true };
        }
      }
    } else if (parts.length > 2) {
      const valid =
        parts[0].length >= 1 &&
        parts[0].length <= 3 &&
        parts.slice(1).every((part) => part.length === 3 && /^\d{3}$/.test(part));
      const val = Number(parts.join(''));
      return { value: isNegative ? -val : val, ambiguous: !valid };
    }
  }

  // Only dots
  if (hasDot && !hasComma) {
    const parts = digitsPart.split('.');
    if (parts.length === 2) {
      const [left, right] = parts;
      if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        if (right.length === 3) {
          // Exactly 3 digits -> thousands separator (e.g. 1.000 = 1000)
          const val = Number(left + right);
          return { value: isNegative ? -val : val, ambiguous: false };
        } else if (right.length === 1 || right.length === 2) {
          // 1-2 digits -> decimal mark (e.g. 12.5 = 12.5)
          const val = Number(left + '.' + right);
          return { value: isNegative ? -val : val, ambiguous: false };
        } else {
          // >= 4 digits -> ambiguous (e.g. 1.0000)
          const val = Number(left + '.' + right);
          return { value: isNegative ? -val : val, ambiguous: true };
        }
      }
    } else if (parts.length > 2) {
      const valid =
        parts[0].length >= 1 &&
        parts[0].length <= 3 &&
        parts.slice(1).every((part) => part.length === 3 && /^\d{3}$/.test(part));
      const val = Number(parts.join(''));
      return { value: isNegative ? -val : val, ambiguous: !valid };
    }
  }

  return { value: null, ambiguous: false };
}

/**
 * Parses a number or range (e.g. '600-700', '600–700', '30 to 35').
 * For ranges, computes the midpoint and marks isRange: true.
 */
export function parseNumberOrRange(raw: string): {
  value: number | null;
  isRange: boolean;
  ambiguous: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, isRange: false, ambiguous: false };

  // Match range: "600-700", "600–700", "600—700", "30 to 35"
  const rangeMatch = trimmed.match(
    /^(\d+(?:[.,]\d+)*)\s*(?:g|kcal|cals?|calories?)?\s*(?:[-–—]|\bto\b)\s*(\d+(?:[.,]\d+)*)\s*(?:g|kcal|cals?|calories?)?$/i
  );
  if (rangeMatch) {
    const low = parseLocaleNumber(rangeMatch[1]);
    const high = parseLocaleNumber(rangeMatch[2]);
    if (low.value !== null && high.value !== null) {
      const midpoint = roundToOneDecimal((low.value + high.value) / 2);
      return {
        value: midpoint,
        isRange: true,
        ambiguous: low.ambiguous || high.ambiguous,
      };
    }
  }

  // Match estimate with trailing +: "800+", "50+"
  const plusMatch = trimmed.match(/^(\d+(?:[.,]\d+)*)\s*\+$/);
  if (plusMatch) {
    const base = parseLocaleNumber(plusMatch[1]);
    return {
      value: base.value,
      isRange: true,
      ambiguous: base.ambiguous,
    };
  }

  const single = parseLocaleNumber(trimmed);
  return {
    value: single.value,
    isRange: false,
    ambiguous: single.ambiguous,
  };
}

function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return 'g';
  const unit = rawUnit.trim().toLowerCase();
  const stripped = unit.replace(/[()]/g, '');
  if (stripped === 'g' || stripped === 'gram' || stripped === 'grams') return 'g';
  if (stripped === 'ml' || stripped === 'milliliter' || stripped === 'milliliters') return 'ml';
  if (stripped === 'oz' || stripped === 'ounce' || stripped === 'ounces') return 'oz';
  return unit;
}

function isInvalidMacroUnit(rawUnit?: string): boolean {
  if (!rawUnit) return false;
  const unit = rawUnit.trim().toLowerCase().replace(/[()]/g, '');
  return (
    unit === 'mg' ||
    unit === 'milligram' ||
    unit === 'milligrams' ||
    unit === 'oz' ||
    unit === 'ounce' ||
    unit === 'ounces' ||
    unit === 'kg' ||
    unit === 'ml' ||
    unit === 'lb' ||
    unit === 'lbs'
  );
}

function cleanLine(rawLine: string): string {
  let line = rawLine.trim();

  // 1. Strip markdown bold and double underscores first: **text** or __text__
  line = line.replace(/\*\*/g, '').replace(/__/g, '');

  // 2. Strip leading bullets, numbered markers, and emoji bullets (e.g. 🔥 Calories: 650, 🥩 Protein: 40g)
  // \p{Extended_Pictographic} handles all standard Unicode emoji symbols.
  line = line.replace(
    /^(?:[\*•\-+]|\d+[.)]|\p{Extended_Pictographic}|\p{Emoji_Presentation})+\s*/gu,
    ''
  );

  // 3. Strip approximation markers: ~, ≈, approx., approx, approximately, about
  line = line.replace(/[~≈]/g, ' ');
  line = line.replace(/\b(?:approximately|approx\.?|about)(?=\s|$|[0-9])/gi, ' ');

  // 4. Collapse extra whitespace created by stripping and trim
  line = line.replace(/\s+/g, ' ').trim();

  // 5. Strip trailing colon if this is a label line with a trailing colon
  if (line.endsWith(':')) {
    line = line.slice(0, -1).trim();
  }

  return line;
}

function extractInlineModifier(line: string): { cleanedLine: string; modifier?: string } {
  const parenMatch = line.match(
    /\s*\(((?:ate\s+half|had\s+half|half\s+portion|half|1\/2|x\s*\d+|\d+\s*x|two\s+of|\d+\s+of|double))\)\s*$/i
  );
  if (parenMatch) {
    const rawMod = parenMatch[1].trim();
    let canonical = rawMod.toLowerCase();
    if (/^x\s*\d+$/i.test(canonical) || /^\d+\s*x$/i.test(canonical)) {
      const numDigits = canonical.replace(/[^0-9]/g, '');
      canonical = `x${numDigits}`;
    } else if (canonical === '1/2') {
      canonical = 'half';
    } else if (canonical === 'double' || canonical === '2 of') {
      canonical = 'two of';
    }
    const cleanedLine = line.replace(parenMatch[0], '').trim();
    return { cleanedLine, modifier: canonical };
  }
  return { cleanedLine: line };
}

function tryMatchModifierLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^ate\s+half$/i.test(trimmed)) return 'ate half';
  if (/^had\s+half$/i.test(trimmed)) return 'had half';
  if (/^half\s+portion$/i.test(trimmed)) return 'half portion';
  if (/^half$/i.test(trimmed)) return 'half';
  if (/^1\/2$/i.test(trimmed)) return 'half';
  if (/^x\s*2$/i.test(trimmed) || /^2\s*x$/i.test(trimmed)) return 'x2';
  if (/^x\s*(\d+)$/i.test(trimmed)) {
    const match = trimmed.match(/^x\s*(\d+)$/i);
    return `x${match![1]}`;
  }
  if (/^(\d+)\s*x$/i.test(trimmed)) {
    const match = trimmed.match(/^(\d+)\s*x$/i);
    return `x${match![1]}`;
  }
  if (/^two\s+of$/i.test(trimmed) || /^2\s+of$/i.test(trimmed)) return 'two of';
  if (/^three\s+of$/i.test(trimmed) || /^3\s+of$/i.test(trimmed)) return 'three of';
  if (/^double$/i.test(trimmed)) return 'two of';
  return null;
}

function isHeaderNoise(line: string): boolean {
  return (
    /^nutrition\s+facts\b/i.test(line) ||
    /^nutrition\s+information\b/i.test(line) ||
    /^typical\s+values\b/i.test(line) ||
    /^amount\s+per\s+serving\b/i.test(line) ||
    /^amount\s+per\s+\d+\s*(?:g|ml|oz)\b/i.test(line) ||
    /^%\s*(?:daily\s+value|dv)\*?/i.test(line) ||
    /^\*\s*(?:percent|the\s+%)?\s*daily\s+values?\b/i.test(line) ||
    /^\*\s*reference\s+intake\b/i.test(line) ||
    /^\d+\s+servings?\s+per\s+container\b/i.test(line) ||
    /^servings?\s+per\s+container\b/i.test(line) ||
    /^about\s+\d+\s+servings?\s+per\s+container\b/i.test(line) ||
    /^[-=_*~]{2,}$/.test(line)
  );
}

function isIgnorableSubRow(line: string): boolean {
  const trimmed = line.trim();
  if (
    /^(?:of\s+which\s+)?sat(?:urates?|urated\s+fat)?(?:\s*\(?[^)]*\)?)?[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^sat(?:urated)?\s+fat[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) return true;
  if (/^trans\s+fat(?:ty\s+acids?)?[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) {
    return true;
  }
  if (
    /^(?:polyunsaturated|monounsaturated)\s+fat[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^cholesterol[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:mg|milligrams?)\b/i.test(trimmed)) return true;
  if (/^sodium[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:mg|milligrams?|g)\b/i.test(trimmed)) return true;
  if (/^salt[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?|mg)\b/i.test(trimmed)) return true;
  if (/^potassium[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:mg|g)\b/i.test(trimmed)) return true;
  if (/^(?:total\s+)?sugars?[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) return true;
  if (/^(?:of\s+which\s+)?sugars?[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) {
    return true;
  }
  if (
    /^(?:includes\s+)?(?:\d+(?:[.,]\d+)?\s*g\s+)?added\s+sugars?[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^includes\s+-?\d+(?:[.,]\d+)?\s*g\s+added\s+sugars\b/i.test(trimmed)) return true;
  if (
    /^(?:vitamin\s+[a-z0-9]+|calcium|iron|zinc|magnesium|folate)[:=\s—–-]+-?\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|iu|%)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (
    /^\s*(?:sat\s+fat|saturated|trans|polyunsaturated|monounsaturated|includes|cholesterol|sodium|sugars|salt)\b/i.test(
      line
    )
  ) {
    return true;
  }
  if (/^\d+\s*%(?:\s+daily\s+value)?\*?$/i.test(trimmed)) return true;

  return false;
}

function tryParseServingOrWeightLine(line: string): ParsedServingLine {
  const trimmed = line.trim();

  // 1. Explicit consumed weight / net weight / weight labels
  const consumedWeightMatch = trimmed.match(
    /^(?:consumed\s+weight|net\s+weight|weight)(?:[:=\s—–]+|\s+-\s+)(\d+(?:[.,]\d+)*(?:\s*(?:[-–—]|\bto\b)\s*\d+(?:[.,]\d+)*)?)\s*([a-zA-Z]+)?$/i
  );
  if (consumedWeightMatch) {
    const numRes = parseNumberOrRange(consumedWeightMatch[1]);
    const unit = normalizeUnit(consumedWeightMatch[2]);
    return {
      matched: true,
      size: numRes.value ?? 1,
      unit,
      source: 'consumed_weight',
      isRange: numRes.isRange,
      ambiguous: numRes.ambiguous,
    };
  }

  // 2. Pattern: "Per 100g", "Per 100 g", "Per 100ml"
  const perNumMatch = trimmed.match(/^per\s+(\d+(?:[.,]\d+)*)\s*([a-zA-Z]+)?$/i);
  if (perNumMatch) {
    const numRes = parseNumberOrRange(perNumMatch[1]);
    const unit = perNumMatch[2] ? normalizeUnit(perNumMatch[2]) : 'serving';
    const size = numRes.value ?? 1;
    const basisLabel = size === 100 && unit === 'g' ? 'per 100g' : `per ${size}${unit}`;
    return {
      matched: true,
      size,
      unit,
      source: 'per_basis',
      basisLabel,
      isRange: numRes.isRange,
      ambiguous: numRes.ambiguous,
    };
  }

  // 3. Pattern: "Per serving", "Per portion"
  if (/^per\s+(?:serving|portion)$/i.test(trimmed)) {
    return {
      matched: true,
      size: 1,
      unit: 'serving',
      source: 'per_basis',
      basisLabel: 'per serving',
    };
  }

  // 4. Pattern: "Serving size: 1 cup (240ml)", "Serving size 1 bar (60g)", "Serving Size: 30g"
  const servingSizeMatch = trimmed.match(/^serving(?:\s+size)?(?:[:=\s—–]+|\s+-\s+)(.+)$/i);
  if (servingSizeMatch) {
    const rest = servingSizeMatch[1].trim();
    const numMatch = rest.match(/^(\d+(?:[.,]\d+)*(?:\s*(?:[-–—]|\bto\b)\s*\d+(?:[.,]\d+)*)?)\s*(.*)$/);
    if (numMatch) {
      const numRes = parseNumberOrRange(numMatch[1]);
      const rawUnit = numMatch[2].trim();
      const unit = rawUnit ? normalizeUnit(rawUnit) : 'serving';
      return {
        matched: true,
        size: numRes.value ?? 1,
        unit,
        source: 'serving_size',
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
    return {
      matched: true,
      size: 1,
      unit: rest || 'serving',
      source: 'serving_size',
    };
  }

  return { matched: false, source: 'serving_size' };
}

/**
 * Checks whether a line or segment represents a summary row.
 * Summary row labels: any label containing 'total', plus Sum / Overall / Combined.
 */
export function isSummaryRowLabel(text: string): boolean {
  const cleaned = cleanLine(text).trim();
  if (/total/i.test(cleaned)) {
    return true;
  }
  if (/^(?:sum|overall|combined)\b/i.test(cleaned)) {
    return true;
  }
  return false;
}

function tryMatchMacroToken(rawSegment: string): ExtractedMacroToken | null {
  const segment = rawSegment.trim();
  if (!segment) return null;

  if (isIgnorableSubRow(segment)) {
    return { kind: 'ignorable', value: 0 };
  }

  // Standalone percentage token like "16%"
  if (/^\d+\s*%(?:\s+dv)?\*?$/i.test(segment)) {
    return { kind: 'ignorable', value: 0 };
  }

  // Label separator regex: handles colon, equals, whitespace, em-dash, en-dash, or spaced hyphen
  const sep = '(?:[:=\\s—–]+|\\s+-\\s+)';
  // Number or range regex: matches numbers with commas/dots or ranges like 600-700, or estimates like 800+
  const numOrRange = '(-?\\d+(?:[.,]\\d+)*(?:\\s*\\+)?(?:\\s*(?:[-–—]|\\bto\\b)\\s*\\d+(?:[.,]\\d+)*(?:\\s*\\+)?)?)';

  // 1. Calories / Energy
  const energyKjKcalMatch = segment.match(
    new RegExp(
      `^(?:total\\s+)?energy${sep}(?:(\\d+(?:[.,]\\d+)*)\\s*kj\\s*(?:[/,\\s]+|\\s+))?${numOrRange}\\s*(?:\\((?:kcal|cals?|calories?|cal)\\)|kcal|cals?|calories?|cal)?(?:\\s*(?:[/,\\s]+|\\s+)(\\d+(?:[.,]\\d+)*)\\s*kj)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (energyKjKcalMatch) {
    const numRes = parseNumberOrRange(energyKjKcalMatch[2]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const energyKjOnlyMatch = segment.match(
    new RegExp(`^(?:total\\s+)?energy${sep}(-?\\d+(?:[.,]\\d+)*)\\s*kj(?:\\s+\\d+\\s*%)?$`, 'i')
  );
  if (energyKjOnlyMatch) {
    const kjVal = parseLocaleNumber(energyKjOnlyMatch[1]).value;
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  const dualKjKcalMatch = segment.match(
    new RegExp(
      `^(?:(\\d+(?:[.,]\\d+)*)\\s*kj\\s*[/,]\\s*)?${numOrRange}\\s*kcal(?:\\s*[/,]\\s*(\\d+(?:[.,]\\d+)*)\\s*kj)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (dualKjKcalMatch && dualKjKcalMatch[2]) {
    const numRes = parseNumberOrRange(dualKjKcalMatch[2]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // Calorie line variations: 'Total Calories', 'Energy: 650 Cal', '650 (kcal)', em dash 'Calories — 650'
  const caloriesMatch = segment.match(
    new RegExp(
      `^(?:total\\s+)?(?:calories?|cals?|cal|energy)${sep}${numOrRange}\\s*(?:\\((?:kcal|cals?|calories?|cal)\\)|kcal|cals?|calories?|cal)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (caloriesMatch) {
    const numRes = parseNumberOrRange(caloriesMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const caloriesKjMatch = segment.match(
    new RegExp(`^(?:total\\s+)?(?:calories?|cals?)${sep}(-?\\d+(?:[.,]\\d+)*)\\s*kj(?:\\s+\\d+\\s*%)?$`, 'i')
  );
  if (caloriesKjMatch) {
    const kjVal = parseLocaleNumber(caloriesKjMatch[1]).value;
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  // Standalone or numFirst calories (e.g. '650 kcal', '650 (kcal)', '520 kcals', '300 cals', '600-700 kcal')
  const numFirstCaloriesMatch = segment.match(
    new RegExp(
      `^${numOrRange}\\s*(?:\\((?:kcals?|cals?|calories?|cal)\\)|kcals?|cals?|calories?)(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (numFirstCaloriesMatch) {
    const numRes = parseNumberOrRange(numFirstCaloriesMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const shorthandKcalMatch = segment.match(/^(\d+(?:[.,]\d+)*)kcals?$/i);
  if (shorthandKcalMatch) {
    const numRes = parseLocaleNumber(shorthandKcalMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: false,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const calShorthandMatch = segment.match(/^cals?(?:[:=\s—–]+|\s+-\s+)(\d+(?:[.,]\d+)*)$/i);
  if (calShorthandMatch) {
    const numRes = parseLocaleNumber(calShorthandMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'calories',
        value: numRes.value,
        isRange: false,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // 2. Protein ('Total Protein', 'Protein — 40g', '40 g of protein', ranges '30 to 35 g', alias 'Protien')
  const proteinMatch = segment.match(
    new RegExp(
      `^(?:total\\s+)?(?:protein|prot|protien)${sep}${numOrRange}\\s*([a-zA-Z%()]+)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (proteinMatch) {
    const numRes = parseNumberOrRange(proteinMatch[1]);
    const unit = proteinMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'protein',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // Num-first protein (e.g. '30g protein', '30 g of protein', '30 of protein')
  const numFirstProteinMatch = segment.match(
    new RegExp(
      `^${numOrRange}\\s*(?:g|grams?|\\(g\\)|\\(grams?\\))?\\s*(?:of\\s+)?(?:protein|prot|protien)(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (numFirstProteinMatch) {
    const numRes = parseNumberOrRange(numFirstProteinMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'protein',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const pShorthandMatch = segment.match(/^p(?:[:=\s—–]+|\s+-\s+)?(-?\d+(?:[.,]\d+)*)\s*([a-zA-Z%()]+)?$/i);
  if (pShorthandMatch) {
    const numRes = parseLocaleNumber(pShorthandMatch[1]);
    const unit = pShorthandMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'protein',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        ambiguous: numRes.ambiguous,
      };
    }
  }
  const pTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)*)\s*(?:g\s*)?p$/i);
  if (pTrailingMatch) {
    const numRes = parseLocaleNumber(pTrailingMatch[1]);
    if (numRes.value !== null) {
      return { kind: 'protein', value: numRes.value, ambiguous: numRes.ambiguous };
    }
  }

  // 3. Carbohydrates ('Total Carbs', 'Carbs — 45g', '40 g of carbs', ranges '60-70g')
  const carbsMatch = segment.match(
    new RegExp(
      `^(?:total\\s+)?(?:carbohydrates?|carbs?|carb)${sep}${numOrRange}\\s*([a-zA-Z%()]+)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (carbsMatch) {
    const numRes = parseNumberOrRange(carbsMatch[1]);
    const unit = carbsMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'carbs',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // Num-first carbs (e.g. '40g carbs', '40 g of carbs', '40 g of carbohydrate')
  const numFirstCarbsMatch = segment.match(
    new RegExp(
      `^${numOrRange}\\s*(?:g|grams?|\\(g\\)|\\(grams?\\))?\\s*(?:of\\s+)?(?:total\\s+)?(?:carbohydrates?|carbs?|carb)(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (numFirstCarbsMatch) {
    const numRes = parseNumberOrRange(numFirstCarbsMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'carbs',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const cShorthandMatch = segment.match(/^c(?:[:=\s—–]+|\s+-\s+)?(-?\d+(?:[.,]\d+)*)\s*([a-zA-Z%()]+)?$/i);
  if (cShorthandMatch) {
    const numRes = parseLocaleNumber(cShorthandMatch[1]);
    const unit = cShorthandMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'carbs',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        ambiguous: numRes.ambiguous,
      };
    }
  }
  const cTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)*)\s*(?:g\s*)?c$/i);
  if (cTrailingMatch) {
    const numRes = parseLocaleNumber(cTrailingMatch[1]);
    if (numRes.value !== null) {
      return { kind: 'carbs', value: numRes.value, ambiguous: numRes.ambiguous };
    }
  }

  // 4. Fat ('Total Fat', 'Fat — 25g', '8 g of fat', ranges '20-25g')
  const fatMatch = segment.match(
    new RegExp(
      `^(?!.*(?:saturated|trans|polyunsaturated|monounsaturated|\\bsat\\b))(?:total\\s+)?fat${sep}${numOrRange}\\s*([a-zA-Z%()]+)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (fatMatch) {
    const numRes = parseNumberOrRange(fatMatch[1]);
    const unit = fatMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'fat',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // Num-first fat (e.g. '8g fat', '8 g of fat')
  const numFirstFatMatch = segment.match(
    new RegExp(
      `^${numOrRange}\\s*(?:g|grams?|\\(g\\)|\\(grams?\\))?\\s*(?:of\\s+)?(?:total\\s+)?fat(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (numFirstFatMatch) {
    const numRes = parseNumberOrRange(numFirstFatMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'fat',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const fShorthandMatch = segment.match(/^f(?:[:=\s—–]+|\s+-\s+)?(-?\d+(?:[.,]\d+)*)\s*([a-zA-Z%()]+)?$/i);
  if (fShorthandMatch) {
    const numRes = parseLocaleNumber(fShorthandMatch[1]);
    const unit = fShorthandMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'fat',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        ambiguous: numRes.ambiguous,
      };
    }
  }
  const fTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)*)\s*(?:g\s*)?f$/i);
  if (fTrailingMatch) {
    const numRes = parseLocaleNumber(fTrailingMatch[1]);
    if (numRes.value !== null) {
      return { kind: 'fat', value: numRes.value, ambiguous: numRes.ambiguous };
    }
  }

  // 5. Fiber ('Total Fiber', 'Dietary Fiber', 'Fiber — 5g', '5 g of fiber')
  const fiberMatch = segment.match(
    new RegExp(
      `^(?:total\\s+)?(?:dietary\\s+)?(?:fibres?|fibers?|fib)${sep}${numOrRange}\\s*([a-zA-Z%()]+)?(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (fiberMatch) {
    const numRes = parseNumberOrRange(fiberMatch[1]);
    const unit = fiberMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'fiber',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  // Num-first fiber (e.g. '5g fiber', '5 g of fiber')
  const numFirstFiberMatch = segment.match(
    new RegExp(
      `^${numOrRange}\\s*(?:g|grams?|\\(g\\)|\\(grams?\\))?\\s*(?:of\\s+)?(?:dietary\\s+)?(?:fibres?|fibers?|fib)(?:\\s+\\d+\\s*%)?$`,
      'i'
    )
  );
  if (numFirstFiberMatch) {
    const numRes = parseNumberOrRange(numFirstFiberMatch[1]);
    if (numRes.value !== null) {
      return {
        kind: 'fiber',
        value: numRes.value,
        isRange: numRes.isRange,
        ambiguous: numRes.ambiguous,
      };
    }
  }

  const fibShorthandMatch = segment.match(/^fib(?:[:=\s—–]+|\s+-\s+)?(-?\d+(?:[.,]\d+)*)\s*([a-zA-Z%()]+)?$/i);
  if (fibShorthandMatch) {
    const numRes = parseLocaleNumber(fibShorthandMatch[1]);
    const unit = fibShorthandMatch[2];
    if (numRes.value !== null) {
      return {
        kind: 'fiber',
        value: numRes.value,
        invalidUnit: isInvalidMacroUnit(unit),
        ambiguous: numRes.ambiguous,
      };
    }
  }

  return null;
}

function splitLineIntoSegments(line: string): string[] {
  const trimmed = line.trim();

  // 1. Entire line is already a single valid macro token
  const singleMatch = tryMatchMacroToken(trimmed);
  if (singleMatch) {
    return [trimmed];
  }

  // 2. Delimiter: "|"
  if (trimmed.includes('|')) {
    return trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  }

  // 3. Delimiter: ";"
  if (trimmed.includes(';')) {
    return trimmed.split(';').map((part) => part.trim()).filter(Boolean);
  }

  // 4. Delimiter: "·"
  if (trimmed.includes('·')) {
    return trimmed.split('·').map((part) => part.trim()).filter(Boolean);
  }

  // 5. Delimiter: "/" (only if not kJ/kcal dual energy or ratio)
  if (
    trimmed.includes('/') &&
    !/(?:kj\s*[/,]\s*-?\d+\s*kcal|-?\d+\s*kcal\s*[/,]\s*-?\d+\s*kj)/i.test(trimmed)
  ) {
    return trimmed.split('/').map((part) => part.trim()).filter(Boolean);
  }

  // 6. Delimiter: comma followed by whitespace (preserves decimal commas like "8,5 g")
  if (/,\s+/.test(trimmed)) {
    return trimmed.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  }

  // 7. Whitespace split for compact shorthand (e.g. "P30 C40 F8 350kcal" or "350kcal P30 C40 F8")
  const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1 && spaceTokens.every((token) => tryMatchMacroToken(token) !== null)) {
    return spaceTokens;
  }

  // 8. Keyword-delimited without commas
  const keywordSplit = trimmed.split(
    /(?<=\S)\s+(?=(?:total\s+calories?|calories?|cal|energy|total\s+protein|protein|prot|total\s+fat|fat|total\s+carbs?|total\s+carbohydrates?|carbohydrates?|carbs?|total\s+fiber|dietary\s+fiber|fib(?:er|re)?|p\s*\d+|\d+\s*p|c\s*\d+|\d+\s*c|f\s*\d+|\d+\s*f|\d+\s*kcal)\b)/i
  );
  if (keywordSplit.length > 1) {
    return keywordSplit.map((part) => part.trim()).filter(Boolean);
  }

  return [trimmed];
}

function tryParseMultiItemLine(rawLine: string): ParsedNutritionItem | null {
  const cleaned = cleanLine(rawLine);
  if (!cleaned) return null;

  // Must have macro indicators
  const hasMacros = /(?:kcal|cal|\bp\b|\bprotein\b|\bc\b|\bcarbs?\b|\bf\b|\bfat\b)/i.test(cleaned);
  if (!hasMacros) return null;

  let nameAndPortion = '';
  let macroSegments: string[] = [];

  if (cleaned.includes('|')) {
    const parts = cleaned.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    if (parts[0].includes(':')) {
      const colonIdx = parts[0].indexOf(':');
      const preColon = parts[0].slice(0, colonIdx).trim();
      const postColon = parts[0].slice(colonIdx + 1).trim();
      if (/(?:kcal|cal|\bp\b|\bprotein\b|\bc\b|\bcarbs?\b|\bf\b|\bfat\b)/i.test(postColon)) {
        nameAndPortion = preColon;
        macroSegments = [postColon, ...parts.slice(1)];
      }
    }

    if (!nameAndPortion) {
      if (/(?:kcal|cal|\bp\b|\bprotein\b)/i.test(parts[0])) return null;

      if (
        parts.length > 2 &&
        !/(?:kcal|cal|\bp\b|\bprotein\b|\bc\b|\bcarbs?\b|\bf\b|\bfat\b)/i.test(parts[1])
      ) {
        nameAndPortion = parts[0] + ': ' + parts[1];
        macroSegments = parts.slice(2);
      } else {
        nameAndPortion = parts[0];
        macroSegments = parts.slice(1);
      }
    }
  } else if (cleaned.includes(':')) {
    const colonIndex = cleaned.indexOf(':');
    nameAndPortion = cleaned.slice(0, colonIndex);
    macroSegments = splitLineIntoSegments(cleaned.slice(colonIndex + 1));
  } else {
    return null;
  }

  let itemName = nameAndPortion.trim();
  let portion = '1 serving';

  if (nameAndPortion.includes(':')) {
    const subParts = nameAndPortion.split(':');
    itemName = subParts[0].trim();
    portion = subParts.slice(1).join(':').trim() || '1 serving';
  } else if (nameAndPortion.includes(' - ')) {
    const subParts = nameAndPortion.split(' - ');
    itemName = subParts[0].trim();
    portion = subParts.slice(1).join(' - ').trim() || '1 serving';
  }

  // Reject if itemName is a section header or summary row
  if (
    /^(?:food(?:\s+item)?|meal(?:\s+name)?|dish(?:\s+name)?|component\s+breakdown|ingredients)$/i.test(
      itemName
    ) ||
    isSummaryRowLabel(itemName)
  ) {
    return null;
  }

  let itemCalories: number | undefined;
  let itemProtein: number | undefined;
  let itemCarbs: number | undefined;
  let itemFat: number | undefined;
  let itemFiber: number | undefined;
  let hasRangeToken = false;

  for (const segment of macroSegments) {
    const token = tryMatchMacroToken(segment);
    if (!token || token.kind === 'ignorable' || token.invalidUnit) continue;

    if (token.isRange) {
      hasRangeToken = true;
    }

    if (token.kind === 'calories' && itemCalories === undefined) {
      if (token.value >= 0 && token.value <= 5000) itemCalories = token.value;
    } else if (token.kind === 'protein' && itemProtein === undefined) {
      if (token.value >= 0 && token.value <= 500) itemProtein = token.value;
    } else if (token.kind === 'carbs' && itemCarbs === undefined) {
      if (token.value >= 0 && token.value <= 500) itemCarbs = token.value;
    } else if (token.kind === 'fat' && itemFat === undefined) {
      if (token.value >= 0 && token.value <= 500) itemFat = token.value;
    } else if (token.kind === 'fiber' && itemFiber === undefined) {
      if (token.value >= 0 && token.value <= 500) itemFiber = token.value;
    }
  }

  // Strict: each item MUST have all 4 macros
  if (
    itemCalories === undefined ||
    itemProtein === undefined ||
    itemCarbs === undefined ||
    itemFat === undefined
  ) {
    return null;
  }

  // Per-item consistency check: |4P + 4C + 9F - kcal| <= max(60, 25% * kcal)
  const expectedKcal = 4 * itemProtein + 4 * itemCarbs + 9 * itemFat;
  const maxDiscrepancy = Math.max(60, 0.25 * itemCalories);
  if (Math.abs(expectedKcal - itemCalories) > maxDiscrepancy) {
    return null;
  }

  return {
    name: itemName,
    portion,
    calories: roundToOneDecimal(itemCalories),
    protein: roundToOneDecimal(itemProtein),
    carbs: roundToOneDecimal(itemCarbs),
    fat: roundToOneDecimal(itemFat),
    fiber: roundToOneDecimal(itemFiber ?? 0),
    isRange: hasRangeToken,
  };
}

/**
 * Detects whether lines contain 2 or more distinct meal labels.
 * Categories: breakfast/morning, lunch/midday/afternoon, dinner/evening/supper, snack, meal 1/meal 2.
 */
function hasMultipleMealLabels(lines: string[]): boolean {
  const mealCategories = new Set<string>();

  for (const rawLine of lines) {
    const cleaned = cleanLine(rawLine).trim();
    if (!cleaned) continue;

    const m = cleaned.match(/\b(breakfast|morning|lunch|midday|afternoon|dinner|supper|evening|snack|meal\s*\d+)\b/i);
    if (m) {
      const word = m[1].toLowerCase().replace(/\s+/g, '');
      if (word === 'breakfast' || word === 'morning') {
        mealCategories.add('breakfast');
      } else if (word === 'lunch' || word === 'midday' || word === 'afternoon') {
        mealCategories.add('lunch');
      } else if (word === 'dinner' || word === 'supper' || word === 'evening') {
        mealCategories.add('dinner');
      } else if (word === 'snack') {
        mealCategories.add('snack');
      } else if (/^meal\d+$/.test(word)) {
        mealCategories.add(word);
      }
    }
  }

  return mealCategories.size >= 2;
}

/**
 * Markdown Table Parser.
 * Parses markdown tables: header + separator + item rows + Total row cross-check.
 */
export function tryParseMarkdownTable(rawLines: string[]): NutritionParseResult | null {
  const tableLines = rawLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('|'));

  if (tableLines.length < 3) {
    return null;
  }

  const parseCells = (row: string): string[] => {
    let clean = row.trim();
    if (clean.startsWith('|')) clean = clean.slice(1);
    if (clean.endsWith('|')) clean = clean.slice(0, -1);
    return clean.split('|').map((c) => c.replace(/[*_`]/g, '').trim());
  };

  const headerCells = parseCells(tableLines[0]);
  let nameCol = -1;
  let calCol = -1;
  let pCol = -1;
  let cCol = -1;
  let fCol = -1;
  let fibCol = -1;

  for (let i = 0; i < headerCells.length; i++) {
    const colName = headerCells[i].toLowerCase();
    if (/^(?:item|food|dish|name|ingredient)$/i.test(colName) && nameCol === -1) {
      nameCol = i;
    } else if (/^(?:calories?|cal|cals?|energy|kcal)$/i.test(colName)) {
      calCol = i;
    } else if (/^(?:protein|prot)$/i.test(colName)) {
      pCol = i;
    } else if (/^(?:carbs?|carbohydrates?)$/i.test(colName)) {
      cCol = i;
    } else if (/^fat$/i.test(colName)) {
      fCol = i;
    } else if (/^(?:dietary\s+)?(?:fib(?:er|re)?)$/i.test(colName)) {
      fibCol = i;
    }
  }

  if (calCol === -1 || pCol === -1 || cCol === -1 || fCol === -1) {
    return null;
  }
  if (nameCol === -1) {
    nameCol = 0;
  }

  // Verify separator row: e.g. | --- | --- | ...
  const sepCells = parseCells(tableLines[1]);
  const isSeparator = sepCells.every((cell) => /^:?-+:?$/.test(cell));
  if (!isSeparator) {
    return null;
  }

  const items: ParsedNutritionItem[] = [];
  let declaredCalories: number | undefined;
  const unreadableLines: string[] = [];

  for (let rowIdx = 2; rowIdx < tableLines.length; rowIdx++) {
    const row = tableLines[rowIdx];
    const cells = parseCells(row);
    if (cells.length === 0 || cells.every((c) => !c)) continue;

    const firstCell = cells[nameCol] || cells[0] || '';
    if (isSummaryRowLabel(firstCell)) {
      const calRes = parseLocaleNumber(cells[calCol] || '');
      if (calRes.value !== null) {
        declaredCalories = calRes.value;
      }
      continue;
    }

    const itemName = cells[nameCol] || `Item ${items.length + 1}`;
    const calVal = parseLocaleNumber(cells[calCol] || '').value;
    const pVal = parseLocaleNumber(cells[pCol] || '').value;
    const cVal = parseLocaleNumber(cells[cCol] || '').value;
    const fVal = parseLocaleNumber(cells[fCol] || '').value;
    const fibVal = fibCol !== -1 ? parseLocaleNumber(cells[fibCol] || '').value : 0;

    if (calVal === null || pVal === null || cVal === null || fVal === null) {
      unreadableLines.push(row);
      continue;
    }

    items.push({
      name: itemName,
      portion: '1 serving',
      calories: roundToOneDecimal(calVal),
      protein: roundToOneDecimal(pVal),
      carbs: roundToOneDecimal(cVal),
      fat: roundToOneDecimal(fVal),
      fiber: roundToOneDecimal(fibVal ?? 0),
    });
  }

  // Never drop an unreadable item line from a multi-item list
  if (unreadableLines.length > 0) {
    const firstLine = unreadableLines[0].trim();
    const prefix = 'Unreadable line: ';
    const available = 60 - prefix.length;
    const truncated =
      firstLine.length > available ? `${firstLine.slice(0, available - 3)}...` : firstLine;
    return {
      confidence: 'none',
      reason: `${prefix}${truncated}`,
      skippedLines: unreadableLines,
      modifiers: [],
    };
  }

  // Structural post-condition
  if (items.length >= 2) {
    let summaryItemIndex = -1;
    for (let k = 0; k < items.length; k++) {
      const candidate = items[k];
      const otherItems = items.filter((_, idx) => idx !== k);
      const otherSumCal = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.calories, 0));
      const otherSumP = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.protein, 0));
      const otherSumC = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.carbs, 0));
      const otherSumF = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.fat, 0));

      const calDiff = Math.abs(candidate.calories - otherSumCal);
      const maxCalTol = Math.max(30, 0.05 * otherSumCal);

      if (calDiff <= maxCalTol) {
        const pDiff = Math.abs(candidate.protein - otherSumP);
        const cDiff = Math.abs(candidate.carbs - otherSumC);
        const fDiff = Math.abs(candidate.fat - otherSumF);
        const maxPTol = Math.max(5, 0.1 * otherSumP);
        const maxCTol = Math.max(5, 0.1 * otherSumC);
        const maxFTol = Math.max(5, 0.1 * otherSumF);

        if (pDiff <= maxPTol && cDiff <= maxCTol && fDiff <= maxFTol) {
          summaryItemIndex = k;
          break;
        }
      }
    }

    if (summaryItemIndex !== -1) {
      const summaryItem = items[summaryItemIndex];
      items.splice(summaryItemIndex, 1);
      if (declaredCalories === undefined) {
        declaredCalories = summaryItem.calories;
      }
    }
  }

  // If table has no Total row, it cannot be cross-checked as a meal -> MULTIPLE_FOODS
  if (declaredCalories === undefined) {
    return {
      confidence: 'none',
      reason: 'MULTIPLE_FOODS',
      skippedLines: [],
      modifiers: [],
    };
  }

  const sumCal = roundToOneDecimal(items.reduce((total, it) => total + it.calories, 0));
  const sumP = roundToOneDecimal(items.reduce((total, it) => total + it.protein, 0));
  const sumC = roundToOneDecimal(items.reduce((total, it) => total + it.carbs, 0));
  const sumF = roundToOneDecimal(items.reduce((total, it) => total + it.fat, 0));
  const sumFib = roundToOneDecimal(items.reduce((total, it) => total + it.fiber, 0));

  // Totals vs items: within 5% or 30 kcal (whichever is larger) items win silently; beyond that grade lenient
  const diff = Math.abs(declaredCalories - sumCal);
  const maxTolerance = Math.max(30, 0.05 * sumCal);
  let isLenient = false;
  let hintText: string | undefined;

  if (diff > maxTolerance) {
    isLenient = true;
    hintText = `Items add up to ${sumCal}, total says ${declaredCalories}`;
  }

  const mealTitle = items.map((it) => it.name).join(', ');
  const explanation =
    items.map((it) => `${it.calories} kcal (${it.name})`).join(' + ') + ` = ${sumCal} kcal`;

  const meal: ParsedNutritionMeal = {
    name: mealTitle,
    calories: sumCal,
    protein: sumP,
    carbs: sumC,
    fat: sumF,
    fiber: sumFib,
    items,
    explanation,
  };

  const foundMacros: MacroKind[] = ['calories', 'protein', 'carbs', 'fat'];
  if (sumFib > 0) foundMacros.push('fiber');

  return {
    confidence: isLenient ? 'lenient' : 'exact',
    meal,
    hint: hintText,
    skippedLines: [],
    modifiers: hintText ? [hintText] : [],
    foundMacros,
  };
}

function tryParseMultiItemBlock(rawLines: string[]): NutritionParseResult | null {
  // Reject multi-meal pastes
  if (hasMultipleMealLabels(rawLines)) {
    return {
      confidence: 'none',
      reason: 'Looks like more than one meal: log them one at a time',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Check if markdown table first
  const tableResult = tryParseMarkdownTable(rawLines);
  if (tableResult) {
    return tableResult;
  }

  let declaredTitle: string | undefined;
  let declaredServingSize: number | undefined;
  let declaredServingUnit: string | undefined;

  let declaredCalories: number | undefined;
  let hasBreakdownHeader = false;
  let hadBulletedOrNumberedItem = false;

  const items: ParsedNutritionItem[] = [];
  const skippedLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('===') || trimmed.startsWith('+++') || trimmed.startsWith('---')) continue;
    if (/^(?:Component Breakdown|Breakdown|Ingredients|Totals?):?$/i.test(trimmed)) {
      hasBreakdownHeader = true;
      continue;
    }

    // Check title headers: Food Item:, Meal Name:, Dish Name:, Meal:, Dish:, Title:, Food:
    const titleMatch = trimmed.match(
      /^(?:Food\s+Item|Meal\s+Name|Dish\s+Name|Meal|Dish|Title|Food):\s*([^\n\r+]+)/i
    );
    if (titleMatch) {
      declaredTitle = titleMatch[1].trim();
      continue;
    }

    // Check portion size headers: Total Portion Size:, Portion Size:, Serving Size:, Total Size:
    const portionMatch = trimmed.match(
      /^(?:Total\s+Portion\s+Size|Portion\s+Size|Serving\s+Size|Total\s+Size):\s*([\d.,]+)\s*([a-zA-Z%]+)?/i
    );
    if (portionMatch) {
      const sizeVal = parseLocaleNumber(portionMatch[1]).value;
      if (sizeVal !== null) {
        declaredServingSize = sizeVal;
        declaredServingUnit = portionMatch[2] ? normalizeUnit(portionMatch[2]) : undefined;
      }
      continue;
    }

    // Summary rows like 'Subtotal', 'Sub-total', 'Sub total', 'Sum', 'Overall', 'Meal total', 'Total', etc.
    const cleanedLine = cleanLine(trimmed);
    const prefixMatch = cleanedLine.match(/^([^:|—–]+)(?:[:|—–]|\s+-\s+)(.*)$/);
    const candidateLabel = prefixMatch ? prefixMatch[1].trim() : cleanedLine;

    if (isSummaryRowLabel(candidateLabel)) {
      const calMatch = cleanedLine.match(/(?:calories?|cal|cals?|energy|kcal)?\s*[:=\s—–]*([\d.,]+)\s*(?:kcal|cals?|calories?|cal)?/i);
      if (calMatch) {
        const calVal = parseLocaleNumber(calMatch[1]).value;
        if (calVal !== null && calVal > 0 && calVal <= 5000 && declaredCalories === undefined) {
          declaredCalories = calVal;
        }
      }
      if (cleanedLine.includes('|') || cleanedLine.includes(',')) {
        const segs = splitLineIntoSegments(prefixMatch ? prefixMatch[2] : cleanedLine);
        for (const seg of segs) {
          const tok = tryMatchMacroToken(seg);
          if (tok && tok.kind === 'calories' && declaredCalories === undefined) {
            declaredCalories = tok.value;
            break;
          }
        }
      }
      continue;
    }

    // Single-macro header lines (e.g. "Total Protein: 40g", "Protein: 40g")
    // ONLY if the line is not an item (no kcal or at most 1 macro)
    const isSingleMacro =
      /^(?:(?:total\s+)?(?:protein|prot|protien|carbs?|carbohydrates?|fat|fiber|fib|fibre)|calories?|cal|cals?|kcal|energy)(?:[:=\s—–]+|\s+-\s+)[\d.,]+/i.test(
        cleanedLine
      ) &&
      !/(?:kcal|cals?|calories?|cal)\b/i.test(cleanedLine) &&
      (cleanedLine.match(/[\d.,]+\s*(?:g|grams?)/gi) || []).length <= 1;

    if (isSingleMacro) {
      continue;
    }

    if (/^(?:[*•\-+]|\d+[.)])\s+/.test(rawLine.trim())) {
      hadBulletedOrNumberedItem = true;
    }

    // Try parsing as multi-item line
    const parsedItem = tryParseMultiItemLine(rawLine);
    if (parsedItem) {
      items.push(parsedItem);
      continue;
    }

    skippedLines.push(rawLine);
  }

  // Structural post-condition:
  // If one item row's kcal and macros equal the sum of all the other item rows
  // (within the tolerance), it is a summary row (cross-check only), whatever its label.
  if (items.length >= 2) {
    let summaryItemIndex = -1;
    for (let k = 0; k < items.length; k++) {
      const candidate = items[k];
      const otherItems = items.filter((_, idx) => idx !== k);
      const otherSumCal = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.calories, 0));
      const otherSumP = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.protein, 0));
      const otherSumC = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.carbs, 0));
      const otherSumF = roundToOneDecimal(otherItems.reduce((acc, it) => acc + it.fat, 0));

      const calDiff = Math.abs(candidate.calories - otherSumCal);
      const maxCalTol = Math.max(30, 0.05 * otherSumCal);

      if (calDiff <= maxCalTol) {
        const pDiff = Math.abs(candidate.protein - otherSumP);
        const cDiff = Math.abs(candidate.carbs - otherSumC);
        const fDiff = Math.abs(candidate.fat - otherSumF);
        const maxPTol = Math.max(5, 0.1 * otherSumP);
        const maxCTol = Math.max(5, 0.1 * otherSumC);
        const maxFTol = Math.max(5, 0.1 * otherSumF);

        if (pDiff <= maxPTol && cDiff <= maxCTol && fDiff <= maxFTol) {
          summaryItemIndex = k;
          break;
        }
      }
    }

    if (summaryItemIndex !== -1) {
      const summaryItem = items[summaryItemIndex];
      items.splice(summaryItemIndex, 1);
      if (declaredCalories === undefined) {
        declaredCalories = summaryItem.calories;
      }
    }
  }

  const hasStructuredMarker = Boolean(
    declaredTitle ||
    declaredCalories !== undefined ||
    declaredServingSize !== undefined ||
    hasBreakdownHeader ||
    hadBulletedOrNumberedItem
  );

  if (!hasStructuredMarker) {
    return null;
  }

  // Never drop an unreadable item line from a multi-item list
  // If one item line in a list cannot be read, the result must not be staged on the device:
  // grade it so that routing sends the whole text to the AI (Auto) or to Quick Log,
  // and the reason names the line (truncate to fit the existing 60-char hint).
  if (items.length > 0 && skippedLines.length > 0) {
    const firstLine = skippedLines[0].trim().replace(/\r?\n/g, ' ');
    const prefix = 'Unreadable line: ';
    const maxLen = 60;
    const available = maxLen - prefix.length;
    const truncated =
      firstLine.length > available ? `${firstLine.slice(0, available - 3)}...` : firstLine;
    return {
      confidence: 'none',
      reason: `${prefix}${truncated}`,
      skippedLines,
      modifiers: [],
    };
  }

  // Multi-item requires:
  // (a) >= 2 items, OR
  // (b) 1 item with explicit declaredTitle / food header and portion/items syntax
  if (items.length === 0) {
    return null;
  }
  if (items.length === 1 && !declaredTitle) {
    return null;
  }

  const sumCal = roundToOneDecimal(items.reduce((total, it) => total + it.calories, 0));
  const sumP = roundToOneDecimal(items.reduce((total, it) => total + it.protein, 0));
  const sumC = roundToOneDecimal(items.reduce((total, it) => total + it.carbs, 0));
  const sumF = roundToOneDecimal(items.reduce((total, it) => total + it.fat, 0));
  const sumFib = roundToOneDecimal(items.reduce((total, it) => total + it.fiber, 0));

  // Totals vs items:
  // within 5% or 30 kcal (whichever is larger) items win silently;
  // beyond that grade lenient with hint like 'Items add up to 850, total says 650'
  let isLenient = false;
  let hintText: string | undefined;

  const anyItemHasRange = items.some((it) => it.isRange);
  if (anyItemHasRange) {
    isLenient = true;
    hintText = 'Range: used the middle';
  }

  if (declaredCalories !== undefined) {
    const diff = Math.abs(declaredCalories - sumCal);
    const maxTolerance = Math.max(30, 0.05 * sumCal);
    if (diff > maxTolerance) {
      isLenient = true;
      hintText = `Items add up to ${sumCal}, total says ${declaredCalories}`;
    }
  }

  const finalCal = sumCal;
  const finalP = sumP;
  const finalC = sumC;
  const finalF = sumF;
  const finalFib = sumFib;

  const mealTitle = declaredTitle || items.map((it) => it.name).join(', ');
  const explanation =
    items.map((it) => `${it.calories} kcal (${it.name})`).join(' + ') + ` = ${finalCal} kcal`;

  const meal: ParsedNutritionMeal = {
    name: mealTitle,
    servingSize: declaredServingSize,
    servingUnit: declaredServingUnit,
    calories: finalCal,
    protein: finalP,
    carbs: finalC,
    fat: finalF,
    fiber: finalFib,
    items,
    explanation,
  };

  const multiFoundMacros: MacroKind[] = ['calories', 'protein', 'carbs', 'fat'];
  if (sumFib > 0) multiFoundMacros.push('fiber');

  return {
    confidence: isLenient ? 'lenient' : 'exact',
    meal,
    hint: hintText,
    skippedLines,
    modifiers: hintText ? [hintText] : [],
    foundMacros: multiFoundMacros,
  };
}

/**
 * Extracts the content of the last ```yourbody or ```yourbody-v1 fenced block.
 * Returns null if no matching fenced block is found.
 */
export function extractYourbodyFencedBlock(text: string): string | null {
  const fenceRegex =
    /^[ \t]*(?:`{3,}|~{3,})[ \t]*(?:yourbody-v1|yourbody)(?=[ \t\r\n]|$)[^\r\n]*\r?\n([\s\S]*?)\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/gim;
  let match: RegExpExecArray | null;
  let lastBlock: string | null = null;
  while ((match = fenceRegex.exec(text)) !== null) {
    lastBlock = match[1];
  }
  return lastBlock;
}

/**
 * Checks whether the input represents multiple distinct meals.
 */
function isMultiMealPaste(lines: string[]): boolean {
  if (hasMultipleMealLabels(lines)) return true;

  const mealHeaderRegex =
    /^\s*(?:breakfast|lunch|dinner|snack|supper|brunch|meal\s*\d+)[:\s]*$/i;
  const mealHeaderCount = lines.filter((l) => mealHeaderRegex.test(l)).length;
  if (mealHeaderCount >= 2) return true;

  // Check meal headers with inline colons followed by lines containing calories
  let mealCountWithCals = 0;
  for (let i = 0; i < lines.length; i++) {
    if (mealHeaderRegex.test(lines[i])) {
      const rest = lines.slice(i + 1, i + 8);
      if (rest.some((l) => /(?:calories?|kcal|cals?|energy)\b/i.test(l))) {
        mealCountWithCals++;
      }
    }
  }
  return mealCountWithCals >= 2;
}

function isLeadInLine(rawLine: string, cleaned: string): boolean {
  const stripped = rawLine.trim().replace(/[*_~`]+$/, '').trim();
  const endsWithColon = stripped.endsWith(':');
  if (!endsWithColon) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 5) {
    return true;
  }
  if (
    /\b(?:breakdown|estimate|estimates|estimated|nutrition(?:al)?(?:\s+(?:info|facts|breakdown|values?))?|here\s+is|here's|sure|details)\b/i.test(
      cleaned
    )
  ) {
    return true;
  }
  return false;
}

function isMacroOrServingLine(rawLine: string): boolean {
  const cleaned = cleanLine(rawLine);
  if (!cleaned) {
    return false;
  }
  if (isHeaderNoise(cleaned) || isIgnorableSubRow(cleaned)) {
    return false;
  }
  if (tryParseServingOrWeightLine(cleaned).matched) {
    return true;
  }

  let lineToParse = cleaned;
  const foodPrefixMatch = cleaned.match(
    /^((?:(?:\d+(?:[.,]\d+)?)\s*(?:oz|g|ml|lbs?|cups?|pieces?|slices?|servings?|scoops?)\s+)?[a-zA-Z\s&+,;/]{2,40}):\s*(.+)$/i
  );
  if (foodPrefixMatch) {
    const candidatePrefix = foodPrefixMatch[1].trim();
    const isServingPrefix = /^(?:\d+(?:[.,]\d+)?\s*(?:oz|g|ml|lbs?|cups?|pieces?|slices?|servings?|scoops?)\s+)[a-zA-Z]/i.test(candidatePrefix);
    if (
      !/^(?:total\s+)?(?:calories?|cal|cals?|energy|protein|prot|fat|total\s+fat|carbs?|carbohydrates?|total\s+carbs?|total\s+carbohydrates?|serving|servings|per|fib|fiber|fibre|dietary\s+fiber|total\s+fiber|consumed\s+weight|net\s+weight|weight|subtotal|sum|overall|meal\s+total)$/i.test(
        candidatePrefix
      ) &&
      (!/\d/.test(candidatePrefix) || isServingPrefix)
    ) {
      lineToParse = foodPrefixMatch[2].trim();
    }
  }

  const segments = splitLineIntoSegments(lineToParse);
  if (segments.length === 0) {
    return false;
  }
  for (const segment of segments) {
    if (!tryMatchMacroToken(segment)) {
      return false;
    }
  }
  return true;
}

export function parseNutritionText(text: string): NutritionParseResult {
  const fencedBlock = extractYourbodyFencedBlock(text);
  const effectiveText = fencedBlock !== null ? fencedBlock : text;

  const trimmedInput = effectiveText.trim();
  if (!trimmedInput) {
    return {
      confidence: 'none',
      reason: 'EMPTY_INPUT',
      skippedLines: [],
      modifiers: [],
    };
  }

  const rawLines = trimmedInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return {
      confidence: 'none',
      reason: 'EMPTY_INPUT',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Multi-meal pastes stay rejected with the reason
  // 'Looks like more than one meal: log them one at a time'
  if (isMultiMealPaste(rawLines)) {
    return {
      confidence: 'none',
      reason: 'Looks like more than one meal: log them one at a time',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Try parsing as structured multi-item breakdown block
  const multiItemResult = tryParseMultiItemBlock(rawLines);
  if (multiItemResult) {
    return multiItemResult;
  }

  // Detect markdown table or multiple foods table
  const isTable = rawLines.some(
    (line) =>
      /^\s*\|\s*food\b/i.test(line) ||
      /\|\s*food\s*\|/i.test(line) ||
      /^\s*\|\s*item\b/i.test(line) ||
      /\|\s*item\s*\|/i.test(line)
  );
  if (isTable) {
    const tableResult = tryParseMarkdownTable(rawLines);
    if (tableResult) {
      return tableResult;
    }
    return {
      confidence: 'none',
      reason: 'MULTIPLE_FOODS',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Check if input has completely zero nutrition macro indicators (pure non-nutrition prose / lists)
  const hasAnyMacroKeyword =
    /(?:calories?|kcal|cals?|energy|protein|prot|\bp\d|\d+p\b|carbs?|carbohydrates?|\bc\d|\d+c\b|fat|\bf\d|\d+f\b)/i.test(
      trimmedInput
    );
  if (!hasAnyMacroKeyword) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Detect pure conversational prose with meal details
  if (
    /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+for\s+(?:breakfast|lunch|dinner|snack)|today\s+i|recipe\s+for|ingredients:?)\b/i.test(
      trimmedInput
    ) &&
    !/(?:calories?[:=\s—–]+\d+|energy[:=\s—–]+\d+|\d+\s*kcal)/i.test(trimmedInput)
  ) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines: [],
      modifiers: [],
    };
  }

  let mealName: string | undefined = undefined;

  let perBasisServing: { size: number; unit: string; label: string } | undefined = undefined;
  let standardServing: { size: number; unit: string } | undefined = undefined;
  let consumedWeight: { size: number; unit: string } | undefined = undefined;

  let calories: number | undefined = undefined;
  let protein: number | undefined = undefined;
  let carbs: number | undefined = undefined;
  let fat: number | undefined = undefined;
  let fiber: number | undefined = undefined;

  let hadKjWithoutKcal = false;
  let totalMacroMatchesCount = 0;
  let hadAmbiguousNumber = false;
  let hadRange = false;

  const skippedLines: string[] = [];
  const modifiers: string[] = [];

  let firstMacroLineIndex = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (isMacroOrServingLine(rawLines[i])) {
      firstMacroLineIndex = i;
      break;
    }
  }

  let candidateMealNameIndex = -1;
  if (firstMacroLineIndex === 1) {
    candidateMealNameIndex = 0;
  } else if (firstMacroLineIndex > 1) {
    for (let i = firstMacroLineIndex - 1; i >= 0; i--) {
      const rawCandidate = rawLines[i];
      const cleanCandidate = cleanLine(rawCandidate);
      if (!cleanCandidate) {
        continue;
      }
      if (isHeaderNoise(cleanCandidate) || isIgnorableSubRow(cleanCandidate)) {
        continue;
      }
      if (tryMatchModifierLine(cleanCandidate) !== null) {
        continue;
      }
      if (tryParseServingOrWeightLine(cleanCandidate).matched) {
        continue;
      }
      if (isLeadInLine(rawCandidate, cleanCandidate)) {
        continue;
      }
      if (/\d/.test(cleanCandidate)) {
        continue;
      }
      if (cleanCandidate.length > 60) {
        continue;
      }

      candidateMealNameIndex = i;
      break;
    }
  } else if (firstMacroLineIndex === -1) {
    candidateMealNameIndex = 0;
  }

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const originalLine = rawLines[lineIndex];
    let cleaned = cleanLine(originalLine);

    if (!cleaned) {
      continue;
    }

    // Check Header Noise
    if (isHeaderNoise(cleaned)) {
      continue;
    }

    // Check Ignorable Sub-rows
    if (isIgnorableSubRow(cleaned)) {
      continue;
    }

    // Check standalone modifier lines (e.g. "ate half", "x2", "two of")
    const standaloneModifier = tryMatchModifierLine(cleaned);
    if (standaloneModifier) {
      if (!modifiers.includes(standaloneModifier)) {
        modifiers.push(standaloneModifier);
      }
      continue;
    }

    // Check inline modifier extraction in parentheses
    const inlineResult = extractInlineModifier(cleaned);
    if (inlineResult.modifier && !modifiers.includes(inlineResult.modifier)) {
      modifiers.push(inlineResult.modifier);
    }
    cleaned = inlineResult.cleanedLine;

    // Check Serving / Weight Line
    const servingMatch = tryParseServingOrWeightLine(cleaned);
    if (servingMatch.matched && servingMatch.size !== undefined && servingMatch.unit !== undefined) {
      if (servingMatch.ambiguous) hadAmbiguousNumber = true;
      if (servingMatch.isRange) hadRange = true;

      if (servingMatch.source === 'consumed_weight') {
        consumedWeight = { size: servingMatch.size, unit: servingMatch.unit };
      } else if (servingMatch.source === 'per_basis') {
        perBasisServing = {
          size: servingMatch.size,
          unit: servingMatch.unit,
          label: servingMatch.basisLabel || 'per serving',
        };
      } else {
        standardServing = { size: servingMatch.size, unit: servingMatch.unit };
      }
      continue;
    }

    // Check if line has a food name prefix like "Chicken breast: 200 kcal, 30g protein..."
    // or portion + food name like "8 oz Grilled Sirloin Steak: 48g protein..."
    let lineToParse = cleaned;
    const foodPrefixMatch = cleaned.match(/^((?:(?:\d+(?:[.,]\d+)?)\s*(?:oz|g|ml|lbs?|cups?|pieces?|slices?|servings?|scoops?)\s+)?[a-zA-Z\s&+,;\/]{2,40}):\s*(.+)$/i);
    if (foodPrefixMatch) {
      const candidatePrefix = foodPrefixMatch[1].trim();
      const restOfLine = foodPrefixMatch[2].trim();
      const isServingPrefix = /^(?:\d+(?:[.,]\d+)?\s*(?:oz|g|ml|lbs?|cups?|pieces?|slices?|servings?|scoops?)\s+)[a-zA-Z]/i.test(candidatePrefix);
      if (
        !/^(?:total\s+)?(?:calories?|cal|cals?|energy|protein|prot|fat|total\s+fat|carbs?|carbohydrates?|total\s+carbs?|total\s+carbohydrates?|serving|servings|per|fib|fiber|fibre|dietary\s+fiber|total\s+fiber|consumed\s+weight|net\s+weight|weight|subtotal|sum|overall|meal\s+total)$/i.test(
          candidatePrefix
        ) &&
        (!/\d/.test(candidatePrefix) || isServingPrefix)
      ) {
        // Conjunctions/list markers in food prefix reject as multiple items
        if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(candidatePrefix)) {
          return {
            confidence: 'none',
            reason: 'NAME_MULTIPLE_ITEMS',
            skippedLines: [originalLine],
            modifiers,
          };
        }
        const cleanFoodName = candidatePrefix.replace(/^(?:\d+(?:[.,]\d+)?\s*(?:oz|g|ml|lbs?|cups?|pieces?|slices?|servings?|scoops?)\s+)/i, '').trim();
        if (isServingPrefix && standardServing === undefined) {
          const portionMatch = candidatePrefix.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\s+/);
          if (portionMatch) {
            const sizeVal = parseLocaleNumber(portionMatch[1]).value;
            if (sizeVal !== null) {
              standardServing = { size: sizeVal, unit: normalizeUnit(portionMatch[2]) };
            }
          }
        }
        if (mealName === undefined) {
          mealName = cleanFoodName;
          lineToParse = restOfLine;
        } else if (mealName !== undefined && mealName !== cleanFoodName && mealName !== candidatePrefix) {
          // If restOfLine contains macro/energy keywords, this is a distinct food item
          const restHasNutrition =
            /(?:calories?|cal|energy|protein|prot|fat|carbs?|carbohydrates?|\d+\s*kcal|\bp\d|\bc\d|\bf\d)\b/i.test(
              restOfLine
            );
          if (restHasNutrition) {
            return {
              confidence: 'none',
              reason: 'SECOND_CALORIES_LINE',
              skippedLines: [originalLine],
              modifiers,
            };
          }
        }
      }
    }

    // Try parsing as Macro line / Compact segments
    const segments = splitLineIntoSegments(lineToParse);
    let allSegmentsMatched = true;
    const parsedTokens: ExtractedMacroToken[] = [];

    for (const segment of segments) {
      const match = tryMatchMacroToken(segment);
      if (!match) {
        allSegmentsMatched = false;
        break;
      }
      parsedTokens.push(match);
    }

    if (allSegmentsMatched && parsedTokens.length > 0) {
      let hadInvalidUnit = false;
      let hadOutOfRange = false;
      let hadDuplicateMacro = false;
      let hadSecondCalories = false;

      for (const token of parsedTokens) {
        if (token.kind === 'ignorable') {
          continue;
        }

        if (token.invalidUnit) {
          hadInvalidUnit = true;
          break;
        }

        if (token.kind === 'kj_only') {
          hadKjWithoutKcal = true;
          continue;
        }

        if (token.isRange) {
          hadRange = true;
        }
        if (token.ambiguous) {
          hadAmbiguousNumber = true;
        }

        totalMacroMatchesCount++;

        // Value Range validation
        if (token.kind === 'calories') {
          if (token.value < 0 || token.value > 5000) {
            hadOutOfRange = true;
            break;
          }
          if (calories !== undefined) {
            hadSecondCalories = true;
            break;
          }
          calories = token.value;
        } else if (token.kind === 'protein') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (protein !== undefined) {
            if (Math.abs(protein - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          protein = token.value;
        } else if (token.kind === 'carbs') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (carbs !== undefined) {
            if (Math.abs(carbs - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          carbs = token.value;
        } else if (token.kind === 'fat') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (fat !== undefined) {
            if (Math.abs(fat - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          fat = token.value;
        } else if (token.kind === 'fiber') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (fiber !== undefined) {
            if (Math.abs(fiber - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          fiber = token.value;
        }
      }

      if (hadInvalidUnit) {
        return {
          confidence: 'none',
          reason: 'INVALID_MACRO_UNIT',
          skippedLines,
          modifiers,
        };
      }
      if (hadOutOfRange) {
        return {
          confidence: 'none',
          reason: 'VALUE_OUT_OF_RANGE',
          skippedLines,
          modifiers,
        };
      }
      if (hadSecondCalories) {
        return {
          confidence: 'none',
          reason: 'SECOND_CALORIES_LINE',
          skippedLines,
          modifiers,
        };
      }
      if (hadDuplicateMacro) {
        return {
          confidence: 'none',
          reason: 'DUPLICATE_MACRO',
          skippedLines,
          modifiers,
        };
      }

      continue;
    }

    // Check if this line is the candidate meal NAME line
    if (lineIndex === candidateMealNameIndex) {
      if (
        /\b(?:i\s+ran|i\s+walked|i\s+worked\s+out|burned\s+\d+|for\s+dinner\s+i|today\s+i\s+ate)\b/i.test(
          cleaned
        )
      ) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      const hasMacroValuesInLine =
        /(?:calories?|cal|kcal)\s*[:=\s—–]+\d+|\d+\s*kcal|protein\s*[:=\s—–]+\d+|\d+\s*g?\s*protein|carbs?\s*[:=\s—–]+\d+|\d+\s*g?\s*carbs?|fat\s*[:=\s—–]+\d+|\d+\s*g?\s*fat/i.test(
          cleaned
        ) || /\b(?:p\d|c\d|f\d)\b/i.test(cleaned);

      if (hasMacroValuesInLine) {
        return {
          confidence: 'none',
          reason: 'UNEXPLAINED_CONTENT',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      const subsequentLinesHaveMacros = rawLines
        .slice(lineIndex + 1)
        .some((subsequentLine) =>
          /(?:calories?|cal|kcal|energy|protein|prot|fat|carbs?|carbohydrates?)\b/i.test(subsequentLine)
        );

      if (/\d/.test(cleaned)) {
        if (subsequentLinesHaveMacros) {
          return {
            confidence: 'none',
            reason: 'NAME_CONTAINS_DIGITS',
            skippedLines: [originalLine],
            modifiers,
          };
        }
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (cleaned.length > 60) {
        return {
          confidence: 'none',
          reason: 'UNEXPLAINED_CONTENT',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (
        /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+i|for\s+(?:breakfast|lunch|dinner|snack)|recipe\s+for|we\s+had)\b/i.test(
          cleaned
        )
      ) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (rawLines.length === 1) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(cleaned)) {
        return {
          confidence: 'none',
          reason: 'NAME_MULTIPLE_ITEMS',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      mealName = cleaned;
      continue;
    }

    // Line could not be parsed: mark as skipped line
    skippedLines.push(originalLine);
  }

  // Resolve weights and weight modifiers
  let finalServingSize: number | undefined = undefined;
  let finalServingUnit: string | undefined = undefined;

  if (consumedWeight !== undefined) {
    finalServingSize = consumedWeight.size;
    finalServingUnit = consumedWeight.unit;
  } else if (standardServing !== undefined) {
    finalServingSize = standardServing.size;
    finalServingUnit = standardServing.unit;
  } else if (perBasisServing !== undefined) {
    finalServingSize = perBasisServing.size;
    finalServingUnit = perBasisServing.unit;
  }

  // Check for two different weights (e.g. per 100g label + consumed weight)
  if (perBasisServing !== undefined && consumedWeight !== undefined) {
    if (
      perBasisServing.size !== consumedWeight.size ||
      perBasisServing.unit !== consumedWeight.unit
    ) {
      if (!modifiers.includes(perBasisServing.label)) {
        modifiers.push(perBasisServing.label);
      }
    }
  } else if (standardServing !== undefined && consumedWeight !== undefined) {
    if (
      standardServing.size !== consumedWeight.size ||
      standardServing.unit !== consumedWeight.unit
    ) {
      if (!modifiers.includes('per serving')) {
        modifiers.push('per serving');
      }
    }
  }

  // If kJ was present without any kcal
  if (calories === undefined && hadKjWithoutKcal) {
    return {
      confidence: 'none',
      reason: 'KJ_WITHOUT_KCAL',
      skippedLines,
      modifiers,
    };
  }

  // If no macros were found at all
  if (totalMacroMatchesCount === 0) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines,
      modifiers,
    };
  }

  // Check partial vs full macros
  const coreMacrosCount = [
    calories !== undefined,
    protein !== undefined,
    carbs !== undefined,
    fat !== undefined,
  ].filter(Boolean).length;

  const foundMacros: MacroKind[] = [];
  if (calories !== undefined) foundMacros.push('calories');
  if (protein !== undefined) foundMacros.push('protein');
  if (carbs !== undefined) foundMacros.push('carbs');
  if (fat !== undefined) foundMacros.push('fat');
  if (fiber !== undefined) foundMacros.push('fiber');

  if (coreMacrosCount < 4) {
    const partialMeal: ParsedNutritionMeal = {
      name: mealName,
      servingSize: finalServingSize !== undefined ? roundToOneDecimal(finalServingSize) : undefined,
      servingUnit: finalServingUnit,
      calories: calories !== undefined ? roundToOneDecimal(calories) : 0,
      protein: protein !== undefined ? roundToOneDecimal(protein) : 0,
      carbs: carbs !== undefined ? roundToOneDecimal(carbs) : 0,
      fat: fat !== undefined ? roundToOneDecimal(fat) : 0,
      fiber: fiber !== undefined ? roundToOneDecimal(fiber) : undefined,
    };
    return {
      confidence: 'partial',
      meal: partialMeal,
      reason: 'MISSING_MACRO',
      skippedLines,
      modifiers,
      foundMacros,
    };
  }

  // Kcal Consistency Check: |4P + 4C + 9F - kcal| <= max(60, 25% * kcal)
  const expectedKcal = 4 * protein! + 4 * carbs! + 9 * fat!;
  const kcalDiscrepancy = Math.abs(expectedKcal - calories!);
  const maxAllowedDiscrepancy = Math.max(60, 0.25 * calories!);
  if (kcalDiscrepancy > maxAllowedDiscrepancy) {
    return {
      confidence: 'none',
      reason: 'KCAL_INCONSISTENT',
      skippedLines,
      modifiers,
      foundMacros,
    };
  }

  const meal: ParsedNutritionMeal = {
    name: mealName,
    servingSize: finalServingSize !== undefined ? roundToOneDecimal(finalServingSize) : undefined,
    servingUnit: finalServingUnit,
    calories: roundToOneDecimal(calories!),
    protein: roundToOneDecimal(protein!),
    carbs: roundToOneDecimal(carbs!),
    fat: roundToOneDecimal(fat!),
    fiber: fiber !== undefined ? roundToOneDecimal(fiber) : undefined,
  };

  let hint: string | undefined;
  if (hadRange) {
    hint = 'Range: used the middle';
    if (!modifiers.includes(hint)) {
      modifiers.push(hint);
    }
  }

  const isLenient =
    skippedLines.length > 0 || modifiers.length > 0 || hadAmbiguousNumber || hadRange;

  return {
    confidence: isLenient ? 'lenient' : 'exact',
    meal,
    reason: skippedLines.length > 0 ? 'UNEXPLAINED_CONTENT' : undefined,
    hint,
    skippedLines,
    modifiers,
    foundMacros,
  };
}
